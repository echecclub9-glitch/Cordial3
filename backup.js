// Cordial — sauvegarde et restauration (base SQLite + fichiers envoyés), sans dépendance externe.
// Format d'archive : tar standard contenant « cordial.db » et « uploads/<id> ».
const fs = require("fs");
const path = require("path");
const { once } = require("events");
const { DatabaseSync } = require("node:sqlite");

const UP_RE = /^[0-9a-f]{32}$/;
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");
const SNAP_RE = /^(auto|manuel)-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;
const REQUIRED_TABLES = ["users", "servers", "channels", "messages", "members"];

const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()); };

/* ---------- tar ---------- */
function tarHeader(name, size) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8"); h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124); h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136);
  h.write("        ", 148); h.write("0", 156); h.write("ustar\0", 257); h.write("00", 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
async function put(out, buf) { if (!out.write(buf)) await once(out, "drain"); }
// entries : [{ name, file }] — un fichier disparu entre-temps est simplement ignoré
async function writeTar(entries, out) {
  for (const e of entries) {
    let fh; try { fh = await fs.promises.open(e.file, "r"); } catch (err) { continue; }
    try {
      const size = (await fh.stat()).size;
      await put(out, tarHeader(e.name, size));
      const buf = Buffer.alloc(1 << 20); let left = size;
      while (left > 0) { const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, left), null); if (!bytesRead) throw new Error("fichier tronqué"); await put(out, Buffer.from(buf.subarray(0, bytesRead))); left -= bytesRead; }
      if (size % 512) await put(out, Buffer.alloc(512 - (size % 512)));
    } finally { await fh.close(); }
  }
  await put(out, Buffer.alloc(1024));
}
function snapshot(db, dest) { db.exec("VACUUM INTO '" + dest.replace(/'/g, "''") + "'"); }

// Liste complète d'une sauvegarde : une copie cohérente de la base, puis les fichiers
function archiveEntries(db, uploadDir, tmpDb) {
  snapshot(db, tmpDb);
  const entries = [{ name: "cordial.db", file: tmpDb }];
  for (const n of fs.readdirSync(uploadDir)) if (UP_RE.test(n)) entries.push({ name: "uploads/" + n, file: path.join(uploadDir, n) });
  return entries;
}

/* ---------- Restauration : l'archive est vérifiée puis préparée, et appliquée au prochain démarrage ---------- */
function copyRange(fd, offset, size, dest) {
  const o = fs.openSync(dest, "w"), buf = Buffer.alloc(1 << 20);
  try { let pos = 0; while (pos < size) { const n = fs.readSync(fd, buf, 0, Math.min(buf.length, size - pos), offset + pos); if (!n) throw new Error("archive tronquée"); fs.writeSync(o, buf, 0, n); pos += n; } } finally { fs.closeSync(o); }
}
function checkDb(file) {
  let d; try {
    d = new DatabaseSync(file);
    const ok = d.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]);
    if (ok.length !== 1 || ok[0] !== "ok") throw new Error("base endommagée");
    const have = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    for (const t of REQUIRED_TABLES) if (!have.has(t)) throw new Error("ce fichier n'est pas une base Cordial (table « " + t + " » absente)");
  } finally { try { d && d.close(); } catch (e) { /* déjà fermée */ } }
}
// Prépare dbPath + ".restore" à partir d'un fichier : archive tar ou base seule. Lève une Error lisible si invalide.
function stageRestore(src, dbPath, { maxBytes }) {
  const stage = dbPath + ".restore";
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(path.join(stage, "uploads"), { recursive: true });
  try {
    const fd = fs.openSync(src, "r");
    try {
      const head = Buffer.alloc(512), got = fs.readSync(fd, head, 0, 512, 0);
      if (got >= SQLITE_MAGIC.length && head.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) copyRange(fd, 0, fs.fstatSync(fd).size, path.join(stage, "cordial.db"));
      else if (got === 512 && head.toString("latin1", 257, 262) === "ustar") {
        let off = 0, total = fs.fstatSync(fd).size, files = 0, sawDb = false; const hdr = Buffer.alloc(512);
        while (off + 512 <= total) {
          fs.readSync(fd, hdr, 0, 512, off);
          if (hdr.every((b) => b === 0)) break;
          let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : hdr[i];
          if (sum !== parseInt(hdr.toString("ascii", 148, 154), 8)) throw new Error("archive illisible (en-tête invalide)");
          const name = hdr.toString("utf8", 0, 100).replace(/\0.*$/s, ""), size = parseInt(hdr.toString("ascii", 124, 135).trim() || "0", 8), type = String.fromCharCode(hdr[156] || 48);
          off += 512;
          if (!Number.isFinite(size) || size < 0 || off + size > total) throw new Error("archive tronquée");
          if (type === "0") {
            if (name === "cordial.db") { copyRange(fd, off, size, path.join(stage, "cordial.db")); sawDb = true; }
            else if (/^uploads\/[0-9a-f]{32}$/.test(name)) { copyRange(fd, off, size, path.join(stage, name)); files++; }
            else throw new Error("fichier inattendu dans l'archive : " + name.slice(0, 60));
          } else if (type !== "5") throw new Error("type d'entrée non accepté dans l'archive");
          off += Math.ceil(size / 512) * 512;
        }
        if (!sawDb) throw new Error("l'archive ne contient pas de base « cordial.db »");
      } else throw new Error("format non reconnu : fournissez une archive .tar Cordial ou un fichier .db");
    } finally { fs.closeSync(fd); }
    checkDb(path.join(stage, "cordial.db"));
    for (const x of ["-wal", "-shm"]) fs.rmSync(path.join(stage, "cordial.db" + x), { force: true });
    fs.writeFileSync(path.join(stage, "READY"), String(Date.now()));
    return { uploads: fs.readdirSync(path.join(stage, "uploads")).length };
  } catch (e) { fs.rmSync(stage, { recursive: true, force: true }); throw e; }
}
// À appeler AVANT d'ouvrir la base : applique une restauration préparée. L'ancienne base est conservée (« .before-restore »).
function applyPendingRestore(dbPath, uploadDir) {
  const stage = dbPath + ".restore";
  if (!fs.existsSync(path.join(stage, "READY"))) { fs.rmSync(stage, { recursive: true, force: true }); return false; }
  if (fs.existsSync(dbPath)) fs.renameSync(dbPath, dbPath + ".before-restore");
  for (const x of ["-wal", "-shm"]) fs.rmSync(dbPath + x, { force: true });
  fs.copyFileSync(path.join(stage, "cordial.db"), dbPath);
  fs.mkdirSync(uploadDir, { recursive: true });
  const up = path.join(stage, "uploads");
  for (const n of fs.readdirSync(up)) if (UP_RE.test(n)) fs.copyFileSync(path.join(up, n), path.join(uploadDir, n));
  fs.rmSync(stage, { recursive: true, force: true });
  return true;
}

/* ---------- Instantanés de la base ---------- */
function listSnapshots(dir) {
  try { return fs.readdirSync(dir).filter((n) => SNAP_RE.test(n)).map((n) => { const s = fs.statSync(path.join(dir, n)); return { name: n, size: s.size, ts: s.mtimeMs }; }).sort((a, b) => b.ts - a.ts); } catch (e) { return []; }
}
function takeSnapshot(db, dir, kind) {
  fs.mkdirSync(dir, { recursive: true });
  const name = kind + "-" + stamp() + ".db", file = path.join(dir, name);
  if (fs.existsSync(file)) fs.rmSync(file);
  snapshot(db, file); return name;
}
// Un instantané automatique par jour, les 7 plus récents sont conservés
function startAutoBackups(db, dir, { keep = 7, everyMs = 22 * 3600e3 } = {}) {
  const run = () => {
    try {
      const auto = listSnapshots(dir).filter((s) => s.name.startsWith("auto-"));
      if (auto[0] && Date.now() - auto[0].ts < everyMs) return;
      takeSnapshot(db, dir, "auto");
      listSnapshots(dir).filter((s) => s.name.startsWith("auto-")).slice(keep).forEach((s) => fs.rmSync(path.join(dir, s.name), { force: true }));
    } catch (e) { console.error("Sauvegarde automatique impossible :", e.message); }
  };
  setTimeout(run, 60e3).unref(); setInterval(run, 3600e3).unref();
}

module.exports = { writeTar, archiveEntries, snapshot, stageRestore, applyPendingRestore, listSnapshots, takeSnapshot, startAutoBackups, SNAP_RE, stamp };
