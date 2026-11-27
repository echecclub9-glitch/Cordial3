// Cordial — serveur de chat temps réel (Express + Socket.IO + SQLite intégré à Node)
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { DatabaseSync } = require("node:sqlite");
const webpush = require("web-push");

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "cordial.db");
const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.DB_PATH ? DB_PATH + "-uploads" : path.join(__dirname, "uploads"));
const SESSION_DAYS = 30;
const MAX_MSG = 2000;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_VOICE = 6;
const SLOW_MAX = 21600;
const COLORS = 8;
// Pseudos réservés à l'administration (séparés par des virgules). Le compte correspondant est administrateur.
const ADMIN_NAMES = (process.env.ADMIN_USERS || "artachi").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
// Code exigé pour créer un compte portant un pseudo réservé (empêche qu'un inconnu prenne le pseudo avant l'admin)
const SETUP_CODE = process.env.ADMIN_SETUP_CODE || crypto.randomBytes(4).toString("hex").toUpperCase();
let ICE = [{ urls: "stun:stun.l.google.com:19302" }];
try { if (process.env.ICE_SERVERS) ICE = JSON.parse(process.env.ICE_SERVERS); } catch (e) { console.error("ICE_SERVERS invalide, STUN public utilisé."); }

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const backup = require("./backup");
const BACKUP_DIR = process.env.BACKUP_DIR || (process.env.DB_PATH ? DB_PATH + "-backups" : path.join(__dirname, "backups"));
const BACKUP_MAX = (Number(process.env.BACKUP_MAX_MB) || 1024) * 1048576;
// Une restauration demandée depuis le panneau admin est appliquée ici, avant l'ouverture de la base
if (backup.applyPendingRestore(DB_PATH, UPLOAD_DIR)) console.log("Sauvegarde restaurée (l'ancienne base est conservée dans « " + path.basename(DB_PATH) + ".before-restore »).");

/* ---------- Base de données ---------- */
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    salt TEXT NOT NULL, hash TEXT NOT NULL, color INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'on', created INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, abbr TEXT NOT NULL, code TEXT NOT NULL UNIQUE, owner_id INTEGER
  );
  CREATE TABLE IF NOT EXISTS members (
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY, server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#99aab5', position INTEGER NOT NULL DEFAULT 1, perms INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS member_roles (
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS friends (
    a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requester INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL, PRIMARY KEY (a, b)
  );
  CREATE TABLE IF NOT EXISTS blocks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created INTEGER NOT NULL, PRIMARY KEY (user_id, blocked_id)
  );
  CREATE TABLE IF NOT EXISTS notif_mutes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, target_id INTEGER NOT NULL, until INTEGER,
    PRIMARY KEY (user_id, kind, target_id)
  );
  CREATE TABLE IF NOT EXISTS categories (
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (server_id, name)
  );
  CREATE TABLE IF NOT EXISTS channel_roles (
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, role_id)
  );
  CREATE TABLE IF NOT EXISTS bans (
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    until INTEGER, reason TEXT NOT NULL DEFAULT '', by_id INTEGER, ts INTEGER NOT NULL, PRIMARY KEY (server_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS mutes (
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    until INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', by_id INTEGER, ts INTEGER NOT NULL, PRIMARY KEY (server_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS sanctions (
    id INTEGER PRIMARY KEY, server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', until INTEGER, by_id INTEGER, ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sanctions_srv ON sanctions (server_id, id);
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY, server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Salons',
    kind TEXT NOT NULL DEFAULT 'text', slowmode INTEGER NOT NULL DEFAULT 0, readonly INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL, ts INTEGER NOT NULL,
    edited INTEGER, pinned INTEGER NOT NULL DEFAULT 0, poll TEXT, reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_msg_channel ON messages(channel_id, id);
  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL, PRIMARY KEY (message_id, user_id, emoji)
  );
  CREATE TABLE IF NOT EXISTS admin_log (
    id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, admin_id INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, ts INTEGER NOT NULL,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS dm_members (
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY, message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, author_name TEXT NOT NULL,
    text TEXT NOT NULL, place TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', UNIQUE (message_id, reporter_id)
  );
  CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
// Bases créées avec une version précédente
for (const sql of [
  "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'", "ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'", "ALTER TABLE channels ADD COLUMN slowmode INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE channels ADD COLUMN readonly INTEGER NOT NULL DEFAULT 0", "ALTER TABLE messages ADD COLUMN edited INTEGER",
  "ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0", "ALTER TABLE messages ADD COLUMN poll TEXT",
  "ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL",
  "ALTER TABLE servers ADD COLUMN partner INTEGER NOT NULL DEFAULT 0", "ALTER TABLE servers ADD COLUMN partner_logo TEXT", "ALTER TABLE messages ADD COLUMN mall INTEGER NOT NULL DEFAULT 0", "ALTER TABLE roles ADD COLUMN hoist INTEGER NOT NULL DEFAULT 0", "ALTER TABLE servers ADD COLUMN icon TEXT", "ALTER TABLE servers ADD COLUMN banner TEXT", "ALTER TABLE users ADD COLUMN avatar TEXT", "ALTER TABLE users ADD COLUMN banner TEXT",
  "ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''", "ALTER TABLE users ADD COLUMN custom TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE files ADD COLUMN purpose TEXT",
  "ALTER TABLE channels ADD COLUMN private INTEGER NOT NULL DEFAULT 0",
]) { try { db.exec(sql); } catch (e) { /* colonne déjà présente */ } }
db.prepare("UPDATE users SET role = 'admin' WHERE lower(name) IN (" + ADMIN_NAMES.map(() => "?").join(",") + ")").run(...ADMIN_NAMES);

const MSG_SELECT = `SELECT m.id, m.channel_id, m.text, m.ts, m.edited, m.pinned, m.poll, m.reply_to, m.mall,
    u.id AS uid, u.name, u.color, u.role, u.avatar, u.custom, r.text AS r_text, ru.name AS r_name, ru.color AS r_color,
    f.id AS f_id, f.name AS f_name, f.mime AS f_mime, f.size AS f_size,
    (SELECT server_id FROM channels WHERE id = m.channel_id) AS sid
  FROM messages m JOIN users u ON u.id = m.user_id
  LEFT JOIN messages r ON r.id = m.reply_to LEFT JOIN users ru ON ru.id = r.user_id
  LEFT JOIN files f ON f.message_id = m.id`;

const q = {
  userByName: db.prepare("SELECT * FROM users WHERE name = ?"),
  userById: db.prepare("SELECT * FROM users WHERE id = ?"),
  insUser: db.prepare("INSERT INTO users (name, salt, hash, color, created, role) VALUES (?, ?, ?, ?, ?, ?)"),
  setStatus: db.prepare("UPDATE users SET status = ? WHERE id = ?"),
  insSession: db.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)"),
  session: db.prepare("SELECT user_id FROM sessions WHERE token = ? AND expires > ?"),
  delSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  purgeSessions: db.prepare("DELETE FROM sessions WHERE expires <= ?"),
  serversOf: db.prepare("SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY s.id"),
  serverById: db.prepare("SELECT * FROM servers WHERE id = ?"),
  serverByCode: db.prepare("SELECT * FROM servers WHERE code = ?"),
  insServer: db.prepare("INSERT INTO servers (name, abbr, code, owner_id) VALUES (?, ?, ?, ?)"),
  join: db.prepare("INSERT OR IGNORE INTO members (server_id, user_id) VALUES (?, ?)"),
  isMember: db.prepare("SELECT 1 AS ok FROM members WHERE server_id = ? AND user_id = ?"),
  nmActive: db.prepare("SELECT 1 FROM notif_mutes WHERE user_id = ? AND kind = ? AND target_id = ? AND (until IS NULL OR until > ?)"),
  nmList: db.prepare("SELECT kind, target_id AS id, until FROM notif_mutes WHERE user_id = ? AND (until IS NULL OR until > ?)"),
  nmSet: db.prepare("INSERT OR REPLACE INTO notif_mutes (user_id, kind, target_id, until) VALUES (?, ?, ?, ?)"),
  nmDel: db.prepare("DELETE FROM notif_mutes WHERE user_id = ? AND kind = ? AND target_id = ?"),
  roleMembers: db.prepare("SELECT user_id FROM member_roles WHERE role_id = ?"),
  chRoles: db.prepare("SELECT role_id FROM channel_roles WHERE channel_id = ?"),
  canSeeByRole: db.prepare("SELECT 1 FROM channel_roles cr JOIN member_roles mr ON mr.role_id = cr.role_id WHERE cr.channel_id = ? AND mr.user_id = ? LIMIT 1"),
  getBan: db.prepare("SELECT * FROM bans WHERE server_id = ? AND user_id = ?"),
  getMute: db.prepare("SELECT * FROM mutes WHERE server_id = ? AND user_id = ?"),
  setBan: db.prepare("INSERT OR REPLACE INTO bans (server_id, user_id, until, reason, by_id, ts) VALUES (?, ?, ?, ?, ?, ?)"),
  setMute: db.prepare("INSERT OR REPLACE INTO mutes (server_id, user_id, until, reason, by_id, ts) VALUES (?, ?, ?, ?, ?, ?)"),
  insSanction: db.prepare("INSERT INTO sanctions (server_id, user_id, type, reason, until, by_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  rolesOf: db.prepare("SELECT r.*, (SELECT COUNT(*) FROM member_roles mr WHERE mr.role_id = r.id) AS count FROM roles r WHERE r.server_id = ? ORDER BY r.position DESC, r.id"),
  roleById: db.prepare("SELECT * FROM roles WHERE id = ?"),
  userRoles: db.prepare("SELECT r.* FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.server_id = ? AND mr.user_id = ? ORDER BY r.position DESC, r.id"),
  allMemberRoles: db.prepare("SELECT user_id, role_id FROM member_roles WHERE server_id = ?"),
  maxPos: db.prepare("SELECT COALESCE(MAX(position), 0) AS n FROM roles WHERE server_id = ?"),
  membersOf: db.prepare("SELECT u.id, u.name, u.color, u.status, u.role, u.avatar, u.custom FROM users u JOIN members m ON m.user_id = u.id WHERE m.server_id = ? ORDER BY u.name COLLATE NOCASE"),
  channelsOf: db.prepare("SELECT * FROM channels WHERE server_id = ? ORDER BY id"),
  channel: db.prepare("SELECT * FROM channels WHERE id = ?"),
  insChannel: db.prepare("INSERT INTO channels (server_id, name, topic, category, kind) VALUES (?, ?, ?, ?, ?)"),
  updChannel: db.prepare("UPDATE channels SET topic = ?, slowmode = ?, readonly = ? WHERE id = ?"),
  delChannel: db.prepare("DELETE FROM channels WHERE id = ?"),
  countTextChannels: db.prepare("SELECT COUNT(*) AS n FROM channels WHERE server_id = ? AND kind = 'text'"),
  history: db.prepare(MSG_SELECT + " WHERE m.channel_id = ? AND (? IS NULL OR m.id < ?) ORDER BY m.id DESC LIMIT 60"),
  search: db.prepare(MSG_SELECT + " WHERE m.channel_id = ? AND m.text LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 50"),
  pins: db.prepare(MSG_SELECT + " WHERE m.channel_id = ? AND m.pinned = 1 ORDER BY m.id DESC LIMIT 50"),
  message: db.prepare(MSG_SELECT + " WHERE m.id = ?"),
  insMessage: db.prepare("INSERT INTO messages (channel_id, user_id, text, ts, reply_to, poll, mall) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  delMessage: db.prepare("DELETE FROM messages WHERE id = ?"),
  setText: db.prepare("UPDATE messages SET text = ?, edited = ? WHERE id = ?"),
  setPinned: db.prepare("UPDATE messages SET pinned = ? WHERE id = ?"),
  reactionsFor: db.prepare("SELECT r.emoji, u.name FROM reactions r JOIN users u ON u.id = r.user_id WHERE r.message_id = ? ORDER BY r.rowid"),
  hasReaction: db.prepare("SELECT 1 AS ok FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"),
  countEmojis: db.prepare("SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id = ?"),
  insReaction: db.prepare("INSERT INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)"),
  delReaction: db.prepare("DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"),
  insFile: db.prepare("INSERT INTO files (id, user_id, name, mime, size, ts) VALUES (?, ?, ?, ?, ?, ?)"),
  fileById: db.prepare("SELECT * FROM files WHERE id = ?"),
  filesOfMessage: db.prepare("SELECT id FROM files WHERE message_id = ?"),
  attachFile: db.prepare("UPDATE files SET message_id = ? WHERE id = ?"),
  dmUsers: db.prepare("SELECT user_id FROM dm_members WHERE channel_id = ?"),
  isDmMember: db.prepare("SELECT 1 AS ok FROM dm_members WHERE channel_id = ? AND user_id = ?"),
  findDm: db.prepare("SELECT c.id FROM channels c JOIN dm_members a ON a.channel_id = c.id AND a.user_id = ? JOIN dm_members b ON b.channel_id = c.id AND b.user_id = ? WHERE c.kind = 'dm'"),
  insDmMember: db.prepare("INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)"),
  dmsOf: db.prepare(`SELECT c.id, o.id AS oid, o.name, o.color, o.role, o.status, o.avatar, o.custom FROM dm_members me
    JOIN channels c ON c.id = me.channel_id AND c.kind = 'dm' JOIN dm_members om ON om.channel_id = c.id AND om.user_id != me.user_id
    JOIN users o ON o.id = om.user_id WHERE me.user_id = ? ORDER BY c.id`),
  shareServer: db.prepare("SELECT 1 AS ok FROM members x JOIN members y ON y.server_id = x.server_id AND y.user_id = ? WHERE x.user_id = ? LIMIT 1"),
  insReport: db.prepare("INSERT INTO reports (message_id, reporter_id, author_id, author_name, text, place, reason, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
  hasReport: db.prepare("SELECT 1 AS ok FROM reports WHERE message_id = ? AND (reporter_id = ? OR ? = 0)"),
  reportOfMessage: db.prepare("SELECT 1 AS ok FROM reports WHERE message_id = ? LIMIT 1"),
  upsertSub: db.prepare("INSERT INTO push_subs (endpoint, user_id, data) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, data = excluded.data"),
  delSub: db.prepare("DELETE FROM push_subs WHERE endpoint = ?"),
  subsOf: db.prepare("SELECT endpoint, data FROM push_subs WHERE user_id = ?"),
  getSetting: db.prepare("SELECT value FROM settings WHERE key = ?"),
  setSetting: db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
};

function tx(fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}
function newCode() { return crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6); }
function abbr(name) {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}
function clean(v, n) { return String(v == null ? "" : v).trim().slice(0, n); }

/* ---------- Données de base : serveur par défaut, serveur caché des MP, robot ---------- */
function ensureDefaultServer() {
  const row = db.prepare("SELECT id FROM servers WHERE name != '__dm__' ORDER BY id LIMIT 1").get();
  if (row) {
    if (!db.prepare("SELECT 1 FROM channels WHERE server_id = ? AND kind = 'voice'").get(row.id)) q.insChannel.run(row.id, "salon-vocal", "Discutez à la voix", "Vocal", "voice");
    return row.id;
  }
  return tx(() => {
    const id = Number(q.insServer.run("Communauté", "Co", newCode(), null).lastInsertRowid);
    [["bienvenue", "Les règles et les nouveautés du serveur", "Accueil", "text"], ["général", "Le salon pour parler de tout et de rien", "Discussions", "text"],
     ["off-topic", "Mèmes, musique et bonne humeur", "Discussions", "text"], ["aide", "Une question ? Posez-la ici", "Discussions", "text"],
     ["salon-vocal", "Discutez à la voix", "Vocal", "voice"]].forEach(([n, t, c, k]) => q.insChannel.run(id, n, t, c, k));
    return id;
  });
}
const DEFAULT_SERVER = ensureDefaultServer();
// Les messages privés sont des salons de type "dm" rattachés à ce serveur caché, dont personne n'est membre
const DM_SERVER = (() => {
  const r = db.prepare("SELECT id FROM servers WHERE name = '__dm__'").get();
  return r ? r.id : Number(q.insServer.run("__dm__", "DM", newCode(), null).lastInsertRowid);
})();
const BOT = (() => {
  let b = db.prepare("SELECT * FROM users WHERE role = 'bot'").get();
  if (!b) {
    const salt = crypto.randomBytes(16).toString("hex"), name = q.userByName.get("Cordibot") ? "Cordibot-" + newCode() : "Cordibot";
    const id = Number(q.insUser.run(name, salt, crypto.randomBytes(64).toString("hex"), 0, Date.now(), "bot").lastInsertRowid);
    b = q.userById.get(id);
  }
  q.join.run(DEFAULT_SERVER, b.id);
  return b;
})();

/* ---------- Authentification ---------- */
function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString("hex"); }
function checkPassword(pw, user) {
  const a = Buffer.from(hashPassword(pw, user.salt), "hex"), b = Buffer.from(user.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function makeSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  q.insSession.run(token, userId, Date.now() + SESSION_DAYS * 864e5);
  return token;
}
const NAME_RE = /^[\p{L}\p{N}_-]{2,20}$/u;
function sameSecret(a, b) {
  const x = crypto.createHash("sha256").update(a).digest(), y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}
function authBearer(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const row = m && q.session.get(m[1], Date.now());
  const u = row && q.userById.get(row.user_id);
  return u && !u.banned && u.role !== "bot" ? u : null;
}
// Limites simples en mémoire : tentatives de connexion par IP, envois de fichiers par utilisateur
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(), list = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now); attempts.set(ip, list);
  return list.length > 15;
}
function hit(map, key, windowMs, max) {
  const now = Date.now(), list = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { map.set(key, list); return true; }
  list.push(now); map.set(key, list); return false;
}
const friendHits = new Map(), profileHits = new Map(), uploadHits = new Map(), reportHits = new Map(), searchHits = new Map();

const app = express();
app.disable("x-powered-by");
// Derrière un reverse proxy (Nginx, Caddy…), mettre TRUST_PROXY=1 pour que la limite de tentatives se base sur la vraie IP du visiteur
app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));
app.use(express.json({ limit: "8kb" }));
// "/" = page d'installation, "/app" = le chat (app.html), le service worker n'est jamais mis en cache
app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  setHeaders(res, file) { if (file.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache"); },
}));

app.post("/api/register", (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: "Trop de tentatives, réessayez dans une minute." });
  const name = String(req.body.name || "").trim(), pw = String(req.body.password || "");
  if (!NAME_RE.test(name)) return res.status(400).json({ error: "Pseudo : 2 à 20 caractères (lettres, chiffres, _ ou -)." });
  if (pw.length < 6 || pw.length > 100) return res.status(400).json({ error: "Le mot de passe doit faire au moins 6 caractères." });
  if (q.userByName.get(name)) return res.status(409).json({ error: "Ce pseudo est déjà pris." });
  const reserved = ADMIN_NAMES.includes(name.toLowerCase());
  if (reserved && !sameSecret(String(req.body.setupCode || "").trim().toUpperCase(), SETUP_CODE)) {
    return res.status(403).json({ needCode: true, error: "Ce pseudo est réservé à l'administration. Saisissez le code de création du compte." });
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const color = crypto.randomInt(COLORS);
  const user = tx(() => {
    const id = Number(q.insUser.run(name, salt, hashPassword(pw, salt), color, Date.now(), reserved ? "admin" : "user").lastInsertRowid);
    q.join.run(DEFAULT_SERVER, id);
    return q.userById.get(id);
  });
  res.json({ token: makeSession(user.id) });
});

app.post("/api/login", (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: "Trop de tentatives, réessayez dans une minute." });
  const user = q.userByName.get(String(req.body.name || "").trim());
  if (!user || user.role === "bot" || !checkPassword(String(req.body.password || ""), user)) return res.status(401).json({ error: "Pseudo ou mot de passe incorrect." });
  if (user.banned) return res.status(403).json({ error: "Ce compte a été suspendu par l'administration." });
  res.json({ token: makeSession(user.id) });
});

/* ---------- Compte : mot de passe et autres appareils ---------- */
const passHits = new Map();
const cutOtherDevices = async (userId, keepToken) => {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").run(userId, keepToken);
  for (const s of await io.in("user:" + userId).fetchSockets()) if (s.handshake.auth && s.handshake.auth.token !== keepToken) s.disconnect(true);
};
const bearerToken = (req) => { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ""); return m ? m[1] : ""; };
app.post("/api/password", async (req, res) => {
  const user = authBearer(req); if (!user) return res.status(401).json({ error: "Connexion requise." });
  if (hit(passHits, user.id, 60000, 5)) return res.status(429).json({ error: "Trop d'essais, patientez une minute." });
  const cur = String((req.body || {}).current || ""), next = String((req.body || {}).next || "");
  if (!checkPassword(cur, user)) return res.status(403).json({ error: "Mot de passe actuel incorrect." });
  if (next.length < 6 || next.length > 100) return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 6 caractères." });
  if (next === cur) return res.status(400).json({ error: "Choisissez un mot de passe différent de l'actuel." });
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").run(salt, hashPassword(next, salt), user.id);
  await cutOtherDevices(user.id, bearerToken(req)); res.json({ ok: true });
});
app.post("/api/sessions/revoke-others", async (req, res) => {
  const user = authBearer(req); if (!user) return res.status(401).json({ error: "Connexion requise." });
  await cutOtherDevices(user.id, bearerToken(req)); res.json({ ok: true });
});
app.post("/api/logout", (req, res) => { q.delSession.run(String(req.body.token || "")); res.json({ ok: true }); });

/* ---------- Fichiers joints ---------- */
// Types acceptés : l'extension et le contenu réel (signature) doivent correspondre. Aucun HTML, SVG ou script.
const startsWith = (b, ...sig) => sig.every((x, i) => x === null || b[i] === x);
const at = (b, off, str) => b.length >= off + str.length && b.subarray(off, off + str.length).toString("latin1") === str;
const FILE_TYPES = {
  png: { mime: "image/png", inline: true, ok: (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47) },
  jpg: { mime: "image/jpeg", inline: true, ok: (b) => startsWith(b, 0xff, 0xd8, 0xff) },
  jpeg: { mime: "image/jpeg", inline: true, ok: (b) => startsWith(b, 0xff, 0xd8, 0xff) },
  gif: { mime: "image/gif", inline: true, ok: (b) => at(b, 0, "GIF8") },
  webp: { mime: "image/webp", inline: true, ok: (b) => at(b, 0, "RIFF") && at(b, 8, "WEBP") },
  mp3: { mime: "audio/mpeg", inline: true, ok: (b) => at(b, 0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  ogg: { mime: "audio/ogg", inline: true, ok: (b) => at(b, 0, "OggS") },
  wav: { mime: "audio/wav", inline: true, ok: (b) => at(b, 0, "RIFF") && at(b, 8, "WAVE") },
  mp4: { mime: "video/mp4", inline: true, ok: (b) => at(b, 4, "ftyp") },
  weba: { mime: "audio/webm", inline: true, ok: (b) => startsWith(b, 0x1a, 0x45, 0xdf, 0xa3) }, // messages vocaux (Chrome, Edge, Firefox)
  m4a: { mime: "audio/mp4", inline: true, ok: (b) => at(b, 4, "ftyp") }, // messages vocaux (Safari)
  webm: { mime: "video/webm", inline: true, ok: (b) => startsWith(b, 0x1a, 0x45, 0xdf, 0xa3) },
  pdf: { mime: "application/pdf", inline: false, ok: (b) => at(b, 0, "%PDF") },
  zip: { mime: "application/zip", inline: false, ok: (b) => at(b, 0, "PK\x03\x04") },
  txt: { mime: "text/plain; charset=utf-8", inline: false, ok: (b) => !b.subarray(0, 4096).includes(0) },
};

app.post("/api/upload", express.raw({ type: () => true, limit: MAX_FILE }), (req, res) => {
  const user = authBearer(req);
  if (!user) return res.status(401).json({ error: "Connexion requise." });
  if (hit(uploadHits, user.id, 60000, 10)) return res.status(429).json({ error: "Trop d'envois de fichiers, patientez un instant." });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Fichier vide." });
  let name = "fichier";
  try { name = decodeURIComponent(String(req.headers["x-filename"] || "fichier")); } catch (e) { /* nom conservé par défaut */ }
  name = path.basename(name.replace(/\\/g, "/")).replace(/[\x00-\x1f]/g, "").trim().slice(-100) || "fichier";
  const ext = (name.split(".").pop() || "").toLowerCase(), type = FILE_TYPES[ext];
  if (!type) return res.status(415).json({ error: "Type de fichier non accepté (images, audio, vidéo, PDF, ZIP, texte)." });
  if (!type.ok(buf)) return res.status(415).json({ error: "Le contenu du fichier ne correspond pas à son extension." });
  const id = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
  q.insFile.run(id, user.id, name, type.mime, buf.length, Date.now());
  res.json({ id, name, size: buf.length, mime: type.mime });
});

/* ---------- Profil : photo et bannière ---------- */
const IMG_EXT = ["png", "jpg", "gif", "webp"], IMG_MAX = { avatar: 1024 * 1024, banner: 3 * 1024 * 1024 };
function dropProfileImage(fileId) {
  if (!fileId) return;
  fs.unlink(path.join(UPLOAD_DIR, fileId), () => {}); db.prepare("DELETE FROM files WHERE id = ? AND purpose IS NOT NULL").run(fileId);
}
function setProfileImage(user, kind, buf) {
  let ext = null;
  if (buf) { ext = IMG_EXT.find((e) => FILE_TYPES[e].ok(buf)); if (!ext) return null; }
  const col = kind === "avatar" ? "avatar" : "banner", old = q.userById.get(user.id)[col];
  let id = null;
  if (buf) {
    id = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
    db.prepare("INSERT INTO files (id, user_id, name, mime, size, ts, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, user.id, kind + "." + ext, FILE_TYPES[ext].mime, buf.length, Date.now(), kind);
  }
  db.prepare("UPDATE users SET " + col + " = ? WHERE id = ?").run(id, user.id);
  dropProfileImage(old);
  return true;
}
app.post("/api/profile/image", express.raw({ type: () => true, limit: IMG_MAX.banner }), (req, res) => {
  const user = authBearer(req); if (!user) return res.status(401).json({ error: "Connexion requise." });
  const kind = req.query.kind;
  if (kind !== "avatar" && kind !== "banner") return res.status(400).json({ error: "Type d'image invalide." });
  if (hit(profileHits, user.id, 60000, 12)) return res.status(429).json({ error: "Trop de changements, patientez un instant." });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Image vide." });
  if (buf.length > IMG_MAX[kind]) return res.status(413).json({ error: "Image trop lourde (" + (IMG_MAX[kind] / 1048576) + " Mo maximum)." });
  if (!setProfileImage(user, kind, buf)) return res.status(415).json({ error: "Format non accepté (PNG, JPG, GIF ou WebP)." });
  broadcastProfile(q.userById.get(user.id)); res.json({ ok: true, profile: fullProfile(q.userById.get(user.id)) });
});
app.delete("/api/profile/image", (req, res) => {
  const user = authBearer(req); if (!user) return res.status(401).json({ error: "Connexion requise." });
  const kind = req.query.kind;
  if (kind !== "avatar" && kind !== "banner") return res.status(400).json({ error: "Type d'image invalide." });
  setProfileImage(user, kind, null); broadcastProfile(q.userById.get(user.id)); res.json({ ok: true });
});

/* ---------- Image et bannière d'un serveur : propriétaire ou équipe du site ---------- */
const SRV_IMG = { icon: 1024 * 1024, banner: 3 * 1024 * 1024 };
function serverImageTarget(req, res) {
  const user = authBearer(req); if (!user) { res.status(401).json({ error: "Connexion requise." }); return null; }
  const s = q.serverById.get(Number(req.params.id)), kind = req.query.kind;
  if (!s || s.id === DM_SERVER || (!q.isMember.get(s.id, user.id) && !isStaff(user))) { res.status(404).json({ error: "Serveur introuvable." }); return null; }
  if (s.owner_id !== user.id && !isStaff(user)) { res.status(403).json({ error: "Seul le propriétaire peut modifier les images du serveur." }); return null; }
  if (kind !== "icon" && kind !== "banner") { res.status(400).json({ error: "Type d'image invalide." }); return null; }
  if (hit(profileHits, user.id, 60000, 12)) { res.status(429).json({ error: "Trop de changements, patientez un instant." }); return null; }
  return { user, s, kind };
}
function setServerImage(s, kind, buf, userId) {
  let id = null;
  if (buf) {
    const ext = IMG_EXT.find((e) => FILE_TYPES[e].ok(buf)); if (!ext) return false;
    id = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
    db.prepare("INSERT INTO files (id, user_id, name, mime, size, ts, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, userId, "srv" + kind + "." + ext, FILE_TYPES[ext].mime, buf.length, Date.now(), "srv" + kind);
  }
  db.prepare("UPDATE servers SET " + kind + " = ? WHERE id = ?").run(id, s.id); dropProfileImage(s[kind]);
  io.to("srv:" + s.id).emit("serverUpdated", partnerPublic(q.serverById.get(s.id)));
  return true;
}
app.post("/api/servers/:id/image", express.raw({ type: () => true, limit: SRV_IMG.banner }), (req, res) => {
  const t = serverImageTarget(req, res); if (!t) return;
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Image vide." });
  if (buf.length > SRV_IMG[t.kind]) return res.status(413).json({ error: "Image trop lourde (" + (SRV_IMG[t.kind] / 1048576) + " Mo maximum)." });
  if (!setServerImage(t.s, t.kind, buf, t.user.id)) return res.status(415).json({ error: "Format non accepté (PNG, JPG, GIF ou WebP)." });
  res.json({ ok: true });
});
app.delete("/api/servers/:id/image", (req, res) => {
  const t = serverImageTarget(req, res); if (!t) return;
  setServerImage(t.s, t.kind, null, t.user.id); res.json({ ok: true });
});

// L'identifiant (32 caractères aléatoires) sert de lien secret : il n'est connu que de ceux qui voient le message.
app.get("/files/:id", (req, res) => {
  const f = /^[0-9a-f]{32}$/.test(req.params.id) && q.fileById.get(req.params.id);
  if (!f) return res.status(404).end();
  const type = FILE_TYPES[(f.name.split(".").pop() || "").toLowerCase()];
  const inline = type && type.inline && !req.query.dl;
  res.sendFile(path.join(UPLOAD_DIR, f.id), {
    dotfiles: "allow",
    headers: {
      "Content-Type": f.mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Disposition": (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(f.name),
    },
  }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// Suppression complète d'un serveur : fichiers, vocal en cours, salles temps réel, images
function destroyServer(s) {
  const room = "srv:" + s.id;
  db.prepare("SELECT m.id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.server_id = ?").all(s.id).forEach((m) => removeFiles(m.id));
  q.channelsOf.all(s.id).forEach((c) => { voiceRooms.delete(c.id); io.in("voice:" + c.id).emit("voiceEnded", { channelId: c.id }); io.in("voice:" + c.id).socketsLeave("voice:" + c.id); });
  io.to(room).emit("serverDeleted", { serverId: s.id }); io.in(room).socketsLeave(room);
  db.prepare("DELETE FROM servers WHERE id = ?").run(s.id); [s.partner_logo, s.icon, s.banner].forEach(dropProfileImage);
}
function removeFiles(messageId) {
  q.filesOfMessage.all(messageId).forEach((f) => fs.unlink(path.join(UPLOAD_DIR, f.id), () => {}));
}
// Si le message est supprimé par quelqu'un d'autre que son auteur (modération), ses signalements sont classés
function deleteMessageRow(id, byOther) {
  if (byOther) db.prepare("UPDATE reports SET status = 'done' WHERE message_id = ?").run(id);
  removeFiles(id); q.delMessage.run(id);
}

// Ménage : fichiers jamais joints à un message, ou dont le message n'existe plus
function janitor() {
  try {
    db.prepare("SELECT id FROM files WHERE message_id IS NULL AND purpose IS NULL AND ts < ?").all(Date.now() - 3600e3).forEach((f) => {
      fs.unlink(path.join(UPLOAD_DIR, f.id), () => {}); db.prepare("DELETE FROM files WHERE id = ?").run(f.id);
    });
    const known = new Set(db.prepare("SELECT id FROM files").all().map((f) => f.id));
    fs.readdirSync(UPLOAD_DIR).forEach((n) => { if (/^[0-9a-f]{32}$/.test(n) && !known.has(n)) fs.unlink(path.join(UPLOAD_DIR, n), () => {}); });
    for (const m of [attempts, profileHits, uploadHits, reportHits, searchHits]) for (const [k, l] of m) if (!l.some((t) => Date.now() - t < 3600e3)) m.delete(k);
    q.purgeSessions.run(Date.now());
  } catch (e) { console.error("Ménage :", e.message); }
}
janitor(); setInterval(janitor, 3600e3).unref();

/* ---------- Notifications push ---------- */
let VAPID = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
if (!VAPID.publicKey || !VAPID.privateKey) {
  const pub = q.getSetting.get("vapid_public"), priv = q.getSetting.get("vapid_private");
  if (pub && priv) VAPID = { publicKey: pub.value, privateKey: priv.value };
  else { VAPID = webpush.generateVAPIDKeys(); q.setSetting.run("vapid_public", VAPID.publicKey); q.setSetting.run("vapid_private", VAPID.privateKey); }
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@localhost.invalid", VAPID.publicKey, VAPID.privateKey);

// Liens de téléchargement des applications de bureau : GITHUB_REPO=compte/depot pointe vers la dernière « release » (noms de fichiers fixes)
app.get("/api/config", (req, res) => {
  const repo = /^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPO || "") ? process.env.GITHUB_REPO : null, base = repo ? "https://github.com/" + repo + "/releases/latest/download/" : null;
  const downloads = base ? { windows: base + "Cordial-Setup.exe", mac: base + "Cordial.dmg", linux: base + "Cordial.AppImage" } : {};
  if (process.env.DESKTOP_DOWNLOAD_URL) downloads.windows = process.env.DESKTOP_DOWNLOAD_URL;
  res.json({ app: "cordial", desktopUrl: downloads.windows || null, downloads });
});
app.get("/api/push/key", (req, res) => res.json({ key: VAPID.publicKey }));
app.post("/api/push/subscribe", (req, res) => {
  const user = authBearer(req), s = req.body && req.body.subscription;
  if (!user) return res.status(401).json({ error: "Connexion requise." });
  if (!s || typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || !s.keys || !s.keys.p256dh || !s.keys.auth) return res.status(400).json({ error: "Abonnement invalide." });
  q.upsertSub.run(s.endpoint, user.id, JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) } }));
  res.json({ ok: true });
});
app.post("/api/push/unsubscribe", (req, res) => {
  const user = authBearer(req); if (!user) return res.status(401).json({ error: "Connexion requise." });
  q.delSub.run(String((req.body && req.body.endpoint) || "")); res.json({ ok: true });
});
function sendPush(userId, payload) {
  q.subsOf.all(userId).forEach((s) => {
    webpush.sendNotification(JSON.parse(s.data), JSON.stringify(payload), { TTL: 3600 }).catch((err) => {
      if (err.statusCode === 404 || err.statusCode === 410) q.delSub.run(s.endpoint);
    });
  });
}

/* ---------- Temps réel ---------- */
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const online = new Map(); // userId -> Map(socket.id -> { visible })
const voiceRooms = new Map(); // channelId -> Map(socket.id -> { user, muted })
const lastSent = new Map(); // "userId:channelId" -> horodatage du dernier message (mode lent)

const isOnline = (id) => online.has(id);
const isStaff = (u) => u.role === "admin" || u.role === "mod";
/* --- Amis et blocage --- */
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const friendRow = (x, y) => { const [a, b] = pair(x, y); return db.prepare("SELECT * FROM friends WHERE a = ? AND b = ?").get(a, b); };
const isBlocking = (by, target) => !!db.prepare("SELECT 1 AS ok FROM blocks WHERE user_id = ? AND blocked_id = ?").get(by, target);
const blockedEither = (x, y) => isBlocking(x, y) || isBlocking(y, x);
const areFriends = (x, y) => { const r = friendRow(x, y); return !!r && r.status === "accepted"; };
function friendPub(id) { const o = q.userById.get(id); return o ? { id: o.id, name: o.name, color: o.color, role: o.role, avatar: o.avatar || null, custom: o.custom || "", status: shownStatus(o) } : null; }
function socialOf(uid) {
  const out = { friends: [], incoming: [], outgoing: [], blocked: [] };
  db.prepare("SELECT * FROM friends WHERE a = ? OR b = ?").all(uid, uid).forEach((r) => {
    const p = friendPub(r.a === uid ? r.b : r.a); if (!p) return;
    if (r.status === "accepted") out.friends.push(p); else if (r.requester === uid) out.outgoing.push(p); else out.incoming.push(p);
  });
  db.prepare("SELECT blocked_id FROM blocks WHERE user_id = ? ORDER BY created DESC").all(uid).forEach((r) => { const p = friendPub(r.blocked_id); if (p) out.blocked.push(p); });
  out.friends.sort((x, y) => x.name.localeCompare(y.name, "fr"));
  return out;
}
const pushSocial = (...ids) => ids.forEach((id) => io.to("user:" + id).emit("social", socialOf(id)));
function shownStatus(u) {
  if (u.role === "bot") return "on";
  if (!isOnline(u.id) || u.status === "invisible") return "off";
  return u.status;
}
function pub(u) { return { id: u.id, name: u.name, color: u.color, role: u.role, avatar: u.avatar || null, custom: u.custom || "" }; }
// Un salon privé n'est visible que par les rôles choisis, et par ceux qui gèrent les salons (propriétaire, équipe du site, droit « Gérer les salons »)
function canSee(user, c) {
  if (!c.private) return true;
  return can(user, c.server_id, P.CHANNELS) || !!q.canSeeByRole.get(c.id, user.id);
}
function chView(c, viewer) {
  const v = { id: c.id, name: c.name, topic: c.topic, category: c.category, kind: c.kind, slowmode: c.slowmode, readonly: !!c.readonly, private: !!c.private };
  if (c.private && viewer && can(viewer, c.server_id, P.CHANNELS)) v.roleIds = q.chRoles.all(c.id).map((r) => r.role_id);
  if (c.kind === "voice") v.voice = rosterOf(c.id);
  return v;
}
// Catégories d'un serveur : celles créées explicitement (même vides) + celles des salons existants
function catsOf(sid) {
  const out = db.prepare("SELECT name FROM categories WHERE server_id = ? ORDER BY position, rowid").all(sid).map((r) => r.name);
  q.channelsOf.all(sid).forEach((c) => { if (out.indexOf(c.category) < 0) out.push(c.category); });
  return out;
}
const CAT_MAX = 20;
// Écrit l'ordre actuel (catégories par défaut comprises) dans la table, pour que chacune ait une position stable
function materializeCats(sid) {
  const have = catsOf(sid), saved = db.prepare("SELECT name FROM categories WHERE server_id = ?").all(sid).length;
  if (saved === have.length) return;
  db.prepare("DELETE FROM categories WHERE server_id = ?").run(sid);
  have.forEach((n, i) => db.prepare("INSERT INTO categories (server_id, name, position) VALUES (?,?,?)").run(sid, n, i + 1));
}
const visibleChannels = (sid, user) => q.channelsOf.all(sid).filter((c) => canSee(user, c)).map((c) => chView(c, user));
function serverView(s, user) {
  return { id: s.id, name: s.name, abbr: s.abbr, code: s.code, owner: s.owner_id, partner: !!s.partner, logo: s.partner ? s.partner_logo : null, icon: s.icon, banner: s.banner, isDefault: s.id === DEFAULT_SERVER, channels: visibleChannels(s.id, user), categories: catsOf(s.id) };
}
function rosterOf(channelId) {
  const room = voiceRooms.get(channelId);
  return room ? [...room.values()].map((p) => ({ ...p.user, muted: p.muted, screen: !!p.screen, cam: !!p.cam })) : [];
}
function broadcastRoster(c) {
  io.to(roomsOf(c)).emit("voiceRoster", { serverId: c.server_id, channelId: c.id, users: rosterOf(c.id), dm: c.kind === "dm" });
}
const callHits = new Map();
const peerOfDm = (c, uid) => { const r = q.dmUsers.all(c.id).find((x) => x.user_id !== uid); return r ? r.user_id : null; };
const MAX_SCREENS = 2;
const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
function msgView(m) {
  const rx = {};
  q.reactionsFor.all(m.id).forEach((r) => (rx[r.emoji] ||= []).push(r.name));
  const v = {
    id: m.id, channelId: m.channel_id, text: m.text, ts: m.ts, edited: m.edited || null, pinned: !!m.pinned, mentionAll: !!m.mall,
    user: { id: m.uid, name: m.name, color: m.color, role: m.role, avatar: m.avatar || null, roleColor: roleColorOf(m.sid, m.uid) }, reactions: rx, reply: null, file: null, poll: null,
  };
  if (m.poll) {
    try {
      const opts = JSON.parse(m.poll);
      v.poll = opts.map((label, i) => ({ emoji: NUM[i], label, votes: rx[NUM[i]] || [] }));
      opts.forEach((_, i) => delete rx[NUM[i]]);
    } catch (e) { /* sondage illisible : affiché comme un message simple */ }
  }
  if (m.r_name) v.reply = { id: m.reply_to, name: m.r_name, color: m.r_color, text: (m.r_text || "").slice(0, 100) };
  if (m.f_id) v.file = { id: m.f_id, name: m.f_name, mime: m.f_mime, size: m.f_size };
  return v;
}
function canAccess(userId, channelId) {
  const c = q.channel.get(channelId);
  if (!c) return null;
  if (c.kind === "dm") return q.isDmMember.get(c.id, userId) ? c : null;
  if (!q.isMember.get(c.server_id, userId)) return null;
  if (c.private) { const u = q.userById.get(userId); if (!u || !canSee(u, c)) return null; }
  return c;
}
// Salles Socket.IO qui reçoivent les évènements d'un salon
function roomsOf(c) {
  if (c.kind === "dm") return q.dmUsers.all(c.id).map((r) => "user:" + r.user_id);
  // Salon privé : seulement les salles des personnes autorisées (rien ne passe par la salle du serveur)
  if (c.private) return q.membersOf.all(c.server_id).filter((m) => canSee(m, c)).map((m) => "user:" + m.id);
  return ["srv:" + c.server_id];
}
/* ---------- Rôles et permissions par serveur ---------- */
const P = { MESSAGES: 1, CHANNELS: 2, ROLES: 4, KICK: 8, VIP: 16, BAN: 32, MUTE: 64, EVERYONE: 128 }, P_ALL = 255, TOP_RANK = 1e9, MOD = P.KICK | P.BAN | P.MUTE;
const isOwnerOf = (user, sid) => { const sv = q.serverById.get(sid); return !!sv && sv.owner_id === user.id; };
// Propriétaire, modérateur du site ou administrateur : tous les droits. Sinon, cumul des droits des rôles reçus.
function permsOf(user, sid) {
  if (sid === DM_SERVER) return 0;
  if (isStaff(user) || isOwnerOf(user, sid)) return P_ALL;
  return q.userRoles.all(sid, user.id).reduce((n, r) => n | r.perms, 0);
}
function rankOf(user, sid) {
  if (isStaff(user) || isOwnerOf(user, sid)) return TOP_RANK;
  return q.userRoles.all(sid, user.id).reduce((n, r) => Math.max(n, r.position), 0);
}
const can = (user, sid, flag) => (permsOf(user, sid) & flag) !== 0;
function roleColorOf(sid, uid) { const r = sid && sid !== DM_SERVER ? q.userRoles.get(sid, uid) : null; return r ? r.color : null; }
// Mode lent, lecture seule, épingler et supprimer : jamais dans une conversation privée
function privileged(user, c, flag = P.MESSAGES) {
  if (c.kind === "dm") return false;
  return can(user, c.server_id, flag);
}
/* ---------- Sanctions ---------- */
const fmtDate = (t) => new Date(t).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
function activeBan(sid, uid) { const b = q.getBan.get(sid, uid); return b && (b.until === null || b.until > Date.now()) ? b : null; }
function activeMute(sid, uid) { const m = q.getMute.get(sid, uid); return m && m.until > Date.now() ? m : null; }
const canMod = (user, sid) => (permsOf(user, sid) & MOD) !== 0;
function logSanction(sid, uid, type, reason, until, byId) { q.insSanction.run(sid, uid, type, reason, until || null, byId, Date.now()); }

function fullProfile(u) {
  return { id: u.id, name: u.name, color: u.color, role: u.role, avatar: u.avatar || null, banner: u.banner || null, bio: u.bio || "", custom: u.custom || "", created: u.created, status: shownStatus(u) };
}
// Prévient toutes les personnes qui voient cet utilisateur (serveurs communs, messages privés, lui-même)
function broadcastProfile(u) {
  const rooms = q.serversOf.all(u.id).map((s) => "srv:" + s.id).concat("user:" + u.id, q.dmsOf.all(u.id).map((d) => "user:" + d.oid));
  io.to(rooms).emit("profile", fullProfile(u));
}
function broadcastPresence(u) {
  q.serversOf.all(u.id).forEach((s) => io.to("srv:" + s.id).emit("presence", { serverId: s.id, id: u.id, status: shownStatus(u) }));
}

io.use((socket, next) => {
  q.purgeSessions.run(Date.now());
  const row = q.session.get(String(socket.handshake.auth.token || ""), Date.now());
  const account = row && q.userById.get(row.user_id);
  if (!account || account.banned || account.role === "bot") return next(new Error("auth"));
  socket.userId = row.user_id;
  next();
});

function emitMessage(c, m) { io.to(roomsOf(c)).emit("message", msgView(m)); }
function insertMessage(c, userId, text, replyTo, poll, mall) {
  const id = Number(q.insMessage.run(c.id, userId, text, Date.now(), replyTo || null, poll ? JSON.stringify(poll) : null, mall ? 1 : 0).lastInsertRowid);
  return q.message.get(id);
}
function postBot(c, text, poll) { emitMessage(c, insertMessage(c, BOT.id, text, null, poll)); }

const HELP = [
  "**Commandes de Cordibot**",
  "/aide : affiche cette liste",
  "/de : lance un dé (/de 20, /de 2d6)",
  "/pile : pile ou face",
  "/choix a | b | c : tire une option au hasard",
  "/sondage Question | Option 1 | Option 2 : crée un sondage (9 options maximum)",
].join("\n");

// « @Équipe Vip » s'écrit @Équipe-Vip : on compare sans casse, espaces remplacés par des tirets
const roleKey = (name) => String(name).toLowerCase().replace(/\s+/g, "-");
const EVERYONE_RE = /(^|[^\p{L}\p{N}_-])@(everyone|tous)(?![\p{L}\p{N}_-])/iu;
const hasEveryone = (text) => EVERYONE_RE.test(text);
function mentionedIds(text, serverId, sender) {
  const ids = new Set(), tags = (text.match(/(?<![\p{L}\p{N}_.-])@[\p{L}\p{N}_-]{2,24}/gu) || []).slice(0, 8);
  let roles = null;
  tags.forEach((tag) => {
    const name = tag.slice(1), u = q.userByName.get(name);
    if (u && q.isMember.get(serverId, u.id)) ids.add(u.id);
    roles ||= q.rolesOf.all(serverId);
    roles.filter((r) => roleKey(r.name) === name.toLowerCase()).forEach((r) => q.roleMembers.all(r.id).forEach((x) => ids.add(x.user_id)));
  });
  if (sender && hasEveryone(text) && can(sender, serverId, P.EVERYONE)) q.membersOf.all(serverId).forEach((m) => ids.add(m.id));
  return ids;
}
function notifMuted(userId, c) {
  const now = Date.now();
  return !!q.nmActive.get(userId, "channel", c.id, now) || (c.kind !== "dm" && !!q.nmActive.get(userId, "server", c.server_id, now));
}
const notifMutesOf = (userId) => q.nmList.all(userId, Date.now()).map((r) => ({ kind: r.kind, id: r.id, until: r.until }));
function pushForMessage(c, user, m, text) {
  const who = new Set();
  if (c.kind === "dm") q.dmUsers.all(c.id).forEach((r) => who.add(r.user_id));
  else {
    mentionedIds(text, c.server_id, user).forEach((id) => who.add(id));
    if (m.reply_to) { const t = q.message.get(m.reply_to); if (t) who.add(t.uid); }
  }
  who.delete(user.id);
  const body = (text || (m.f_id ? "📎 " + m.f_name : "")).slice(0, 120);
  who.forEach((id) => {
    const target = q.userById.get(id);
    if (!target || target.banned || target.role === "bot" || (c.private && !canSee(target, c))) return;
    if (isBlocking(id, user.id)) return;
    // « Ne pas déranger » coupe tout ; un salon ou un serveur en sourdine ne notifie que pour une mention directe
    if (target.status === "dnd") return;
    if (notifMuted(id, c) && !text.toLowerCase().includes("@" + target.name.toLowerCase())) return;
    // Pas de notification si la personne regarde déjà l'application
    if (isOnline(id) && [...online.get(id).values()].some((s) => s.visible)) return;
    sendPush(id, { title: c.kind === "dm" ? user.name : user.name + " · #" + c.name, body, tag: "ch" + c.id, url: "/app" });
  });
}

io.on("connection", (socket) => {
  const uid = socket.userId;
  const cur = () => q.userById.get(uid);
  socket.join("user:" + uid);
  let user = cur();
  if (!online.has(uid)) online.set(uid, new Map());
  online.get(uid).set(socket.id, { visible: true });
  if (isStaff(user)) socket.join("staff");
  const servers = q.serversOf.all(uid);
  servers.forEach((s) => socket.join("srv:" + s.id));
  const dms = q.dmsOf.all(uid).map((d) => ({ id: d.id, other: { id: d.oid, name: d.name, color: d.color, role: d.role, avatar: d.avatar || null, custom: d.custom || "", status: shownStatus(d.oid ? { ...d, id: d.oid } : d) } }));
  socket.emit("ready", { me: { ...pub(user), status: user.status }, servers: servers.map((s) => serverView(s, user)), dms, ice: ICE, notifMutes: notifMutesOf(uid), social: socialOf(uid) });
  broadcastPresence(user);

  let stamps = [], voiceChan = null;
  const guard = (fn) => (arg, ack) => {
    try { fn(arg || {}, typeof ack === "function" ? ack : () => {}); }
    catch (e) { console.error(e); if (typeof ack === "function") ack({ error: "Erreur serveur." }); }
  };

  socket.on("visibility", guard(({ visible }) => { const s = online.get(uid) && online.get(uid).get(socket.id); if (s) s.visible = !!visible; }));

  socket.on("history", guard(({ channelId, before }, ack) => {
    if (!canAccess(uid, channelId)) return ack({ error: "Accès refusé." });
    const rows = q.history.all(channelId, before ?? null, before ?? null).reverse();
    ack({ messages: rows.map(msgView), more: rows.length === 60 });
  }));

  socket.on("search", guard(({ channelId, query }, ack) => {
    if (!canAccess(uid, channelId)) return ack({ error: "Accès refusé." });
    const term = clean(query, 50);
    if (term.length < 2) return ack({ error: "Saisissez au moins 2 caractères." });
    if (hit(searchHits, uid, 10000, 8)) return ack({ error: "Doucement, trop de recherches à la suite." });
    ack({ messages: q.search.all(channelId, "%" + term.replace(/[\\%_]/g, "\\$&") + "%").map(msgView) });
  }));

  socket.on("pins", guard(({ channelId }, ack) => {
    if (!canAccess(uid, channelId)) return ack({ error: "Accès refusé." });
    ack({ messages: q.pins.all(channelId).map(msgView) });
  }));

  socket.on("members", guard(({ serverId }, ack) => {
    if (!q.isMember.get(serverId, uid)) return ack({ error: "Accès refusé." });
    const s = q.serverById.get(serverId);
    const rl = {}; q.allMemberRoles.all(serverId).forEach((r) => (rl[r.user_id] ||= []).push(r.role_id));
    ack({ members: q.membersOf.all(serverId).map((u) => ({ ...pub(u), status: shownStatus(u), owner: u.id === s.owner_id, roles: rl[u.id] || [], roleColor: roleColorOf(serverId, u.id) })) });
  }));

  /* --- Messages --- */
  socket.on("send", guard(({ channelId, text, replyTo, fileId }, ack) => {
    user = cur();
    const c = canAccess(uid, channelId);
    if (!c) return ack({ error: "Accès refusé." });
    if (c.kind === "voice") return ack({ error: "Ce salon est un salon vocal." });
    if (c.kind === "dm") {
      const peer = q.dmUsers.all(c.id).map((r) => r.user_id).find((i) => i !== uid);
      if (peer && isBlocking(uid, peer)) return ack({ error: "Vous avez bloqué cette personne. Débloquez-la pour lui écrire." });
      if (peer && isBlocking(peer, uid)) return ack({ error: "Cette personne ne peut pas recevoir vos messages." });
    }
    if (c.kind !== "dm") { const mu = activeMute(c.server_id, uid); if (mu) return ack({ error: "Vous êtes en sourdine jusqu'au " + fmtDate(mu.until) + (mu.reason ? " (" + mu.reason + ")" : "") + "." }); }
    const body = clean(text, MAX_MSG), power = privileged(user, c, P.VIP);
    if (c.readonly && !power) return ack({ error: "Ce salon est en lecture seule." });
    if (c.slowmode && !power) {
      const wait = Math.ceil((c.slowmode * 1000 - (Date.now() - (lastSent.get(uid + ":" + c.id) || 0))) / 1000);
      if (wait > 0) return ack({ error: "Mode lent : encore " + wait + " s avant votre prochain message.", wait });
    }
    const now = Date.now(); stamps = stamps.filter((t) => now - t < 5000);
    if (stamps.length >= 6) return ack({ error: "Doucement ! Trop de messages envoyés." });

    // Commandes du robot (/aide, /de, /pile, /choix, /sondage) : le message tapé n'est pas publié
    const cmd = !fileId && /^\/([\p{L}0-9?]+)(?:\s+([\s\S]*))?$/u.exec(body);
    if (cmd) {
      const name = cmd[1].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(), arg = (cmd[2] || "").trim();
      const say = (t) => socket.emit("ephemeral", { channelId: c.id, text: t });
      stamps.push(now); lastSent.set(uid + ":" + c.id, now);
      if (["aide", "help", "?"].includes(name)) { say(HELP); return ack({ ok: true }); }
      if (["de", "d", "dice", "roll"].includes(name)) {
        const d = /^(?:(\d{1,2})?d)?(\d{1,4})$/i.exec(arg || "6");
        const n = d ? Number(d[1] || 1) : 0, f = d ? Number(d[2]) : 0;
        if (!d || n < 1 || n > 10 || f < 2 || f > 1000) { say("Utilisation : /de 20 ou /de 2d6 (10 dés et 1000 faces au maximum)."); return ack({ ok: true }); }
        const rolls = Array.from({ length: n }, () => crypto.randomInt(1, f + 1)), sum = rolls.reduce((a, b) => a + b, 0);
        postBot(c, "🎲 " + user.name + " lance " + (n > 1 ? n + "d" + f : "un dé à " + f + " faces") + " : " + (n > 1 ? rolls.join(" + ") + " = **" + sum + "**" : "**" + sum + "**"));
        return ack({ ok: true });
      }
      if (["pile", "face", "pileouface", "coin"].includes(name)) { postBot(c, "🪙 " + user.name + " lance une pièce : **" + (crypto.randomInt(2) ? "Pile" : "Face") + "**"); return ack({ ok: true }); }
      if (["choix", "choisis", "choose"].includes(name)) {
        const opts = arg.split("|").map((s) => clean(s, 80)).filter(Boolean);
        if (opts.length < 2) { say("Utilisation : /choix pizza | burger | salade"); return ack({ ok: true }); }
        postBot(c, "🤔 " + user.name + " hésite entre " + opts.map((o) => "« " + o + " »").join(", ") + ". Cordibot choisit : **" + opts[crypto.randomInt(opts.length)] + "**");
        return ack({ ok: true });
      }
      if (["sondage", "poll"].includes(name)) {
        const parts = arg.split("|").map((s) => clean(s, 80)).filter(Boolean), question = parts.shift() || "", opts = parts.slice(0, 9);
        if (!question || opts.length < 2) { say("Utilisation : /sondage Votre question | Option 1 | Option 2 (de 2 à 9 options)."); return ack({ ok: true }); }
        postBot(c, "📊 **" + question + "**\nSondage lancé par " + user.name, opts);
        return ack({ ok: true });
      }
      say("Commande inconnue : /" + cmd[1] + ". Tapez /aide pour la liste.");
      return ack({ ok: true });
    }

    let file = null;
    if (fileId) {
      file = q.fileById.get(String(fileId));
      if (!file || file.user_id !== uid || file.message_id) return ack({ error: "Fichier introuvable, renvoyez-le." });
    }
    if (!body && !file) return ack({ error: "Message vide." });
    let reply = null;
    if (replyTo) {
      reply = q.message.get(Number(replyTo));
      if (!reply || reply.channel_id !== c.id) return ack({ error: "Le message cité n'existe plus." });
    }
    stamps.push(now); lastSent.set(uid + ":" + c.id, now);
    const m = tx(() => { const row = insertMessage(c, uid, body, reply && reply.id, null, c.kind !== "dm" && hasEveryone(body) && can(user, c.server_id, P.EVERYONE)); if (file) q.attachFile.run(row.id, file.id); return q.message.get(row.id); });
    emitMessage(c, m);
    pushForMessage(c, user, m, body);
    ack({ ok: true });
  }));

  socket.on("edit", guard(({ id, text }, ack) => {
    const m = q.message.get(id); if (!m) return ack({ error: "Introuvable." });
    if (!canAccess(uid, m.channel_id)) return ack({ error: "Accès refusé." });
    if (m.uid !== uid || m.poll) return ack({ error: "Vous ne pouvez modifier que vos propres messages." });
    const body = clean(text, MAX_MSG);
    if (!body && !m.f_id) return ack({ error: "Message vide." });
    const edited = Date.now(); q.setText.run(body, edited, id);
    io.to(roomsOf(q.channel.get(m.channel_id))).emit("edited", { id, channelId: m.channel_id, text: body, edited });
    ack({ ok: true });
  }));

  socket.on("delete", guard(({ id }, ack) => {
    user = cur();
    const m = q.message.get(id); if (!m) return ack({ error: "Introuvable." });
    const c = canAccess(uid, m.channel_id); if (!c) return ack({ error: "Accès refusé." });
    if (m.uid !== uid && !privileged(user, c)) return ack({ error: "Vous ne pouvez pas supprimer ce message." });
    const rooms = roomsOf(c); deleteMessageRow(id, m.uid !== uid);
    io.to(rooms).emit("deleted", { id, channelId: m.channel_id });
    ack({ ok: true });
  }));

  socket.on("pin", guard(({ id, pinned }, ack) => {
    user = cur();
    const m = q.message.get(id); if (!m) return ack({ error: "Introuvable." });
    const c = canAccess(uid, m.channel_id); if (!c) return ack({ error: "Accès refusé." });
    if (!privileged(user, c) && c.kind !== "dm") return ack({ error: "Vous n'avez pas la permission d'épingler." });
    q.setPinned.run(pinned ? 1 : 0, id);
    io.to(roomsOf(c)).emit("pinned", { id, channelId: c.id, pinned: !!pinned });
    ack({ ok: true });
  }));

  socket.on("react", guard(({ id, emoji }, ack) => {
    const m = q.message.get(id); emoji = clean(emoji, 16);
    if (!m || !emoji) return ack({ error: "Introuvable." });
    const c = canAccess(uid, m.channel_id); if (!c) return ack({ error: "Accès refusé." });
    if (c.kind !== "dm" && activeMute(c.server_id, uid)) return ack({ error: "Vous êtes en sourdine : vous ne pouvez pas réagir." });
    const had = q.hasReaction.get(id, uid, emoji);
    if (had) q.delReaction.run(id, uid, emoji);
    else {
      if (q.countEmojis.get(id).n >= 20) return ack({ error: "Trop de réactions différentes sur ce message." });
      // Sondage : un seul vote par personne
      if (m.poll) { try { const opts = JSON.parse(m.poll); if (NUM.slice(0, opts.length).includes(emoji)) NUM.slice(0, opts.length).forEach((e) => q.delReaction.run(id, uid, e)); } catch (e) { /* ignoré */ } }
      q.insReaction.run(id, uid, emoji);
    }
    io.to(roomsOf(c)).emit("reactions", { id, channelId: c.id, ...(({ reactions, poll }) => ({ reactions, poll }))(msgView(q.message.get(id))) });
    ack({ ok: true });
  }));

  socket.on("report", guard(({ id, reason }, ack) => {
    const m = q.message.get(id); if (!m) return ack({ error: "Message introuvable." });
    const c = canAccess(uid, m.channel_id); if (!c) return ack({ error: "Accès refusé." });
    if (m.uid === uid) return ack({ error: "Vous ne pouvez pas signaler votre propre message." });
    if (m.role === "bot") return ack({ error: "Ce message vient du robot du serveur." });
    if (q.hasReport.get(id, uid, 1)) return ack({ error: "Vous avez déjà signalé ce message." });
    if (hit(reportHits, uid, 3600e3, 10)) return ack({ error: "Trop de signalements envoyés, réessayez plus tard." });
    const place = c.kind === "dm" ? "Message privé" : q.serverById.get(c.server_id).name + " · #" + c.name;
    q.insReport.run(id, uid, m.uid, m.name, (m.text || (m.f_id ? "[fichier : " + m.f_name + "]" : "")).slice(0, 500), place, clean(reason, 200), Date.now());
    io.to("staff").emit("reportNew", {});
    ack({ ok: true });
  }));

  socket.on("typing", guard(({ channelId }) => {
    const c = canAccess(uid, channelId); if (!c || c.kind === "voice") return;
    socket.to(roomsOf(c)).emit("typing", { channelId, name: user.name });
  }));

  socket.on("status", guard(({ status }, ack) => {
    if (!["on", "idle", "dnd", "invisible"].includes(status)) return ack({ error: "Statut invalide." });
    q.setStatus.run(status, uid); user = cur(); broadcastPresence(user); ack({ ok: true, status });
  }));

  /* --- Profil --- */
  const clean = (t, n) => String(t == null ? "" : t).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\r/g, "").trim().slice(0, n);
  socket.on("setProfile", guard(({ bio, custom }, ack) => {
    if (hit(profileHits, uid, 60000, 12)) return ack({ error: "Trop de changements, patientez un instant." });
    const b = clean(bio, 190).replace(/\n{3,}/g, "\n\n"), c = clean(custom, 60).replace(/\s+/g, " ");
    db.prepare("UPDATE users SET bio = ?, custom = ? WHERE id = ?").run(b, c, uid);
    user = cur(); broadcastProfile(user); ack({ ok: true, profile: fullProfile(user) });
  }));
  socket.on("getProfile", guard(({ userId }, ack) => {
    const t = q.userById.get(Number(userId));
    if (!t || t.banned) return ack({ error: "Profil introuvable." });
    const allowed = t.id === uid || isStaff(cur()) || t.role === "bot" || q.shareServer.get(uid, t.id) || q.findDm.get(uid, t.id) || friendRow(uid, t.id);
    if (!allowed) return ack({ error: "Profil introuvable." });
    const out = fullProfile(t);
    if (t.id !== uid && t.role !== "bot") {
      out.mutualServers = db.prepare("SELECT s.id, s.name, s.abbr, s.icon FROM servers s JOIN members x ON x.server_id = s.id AND x.user_id = ? JOIN members y ON y.server_id = s.id AND y.user_id = ? WHERE s.id != ? ORDER BY s.name COLLATE NOCASE").all(uid, t.id, DM_SERVER);
      const mine = new Set(socialOf(uid).friends.map((f) => f.id));
      out.mutualFriends = socialOf(t.id).friends.filter((f) => mine.has(f.id));
    }
    ack({ profile: out });
  }));

  /* --- Messages privés --- */
  /* --- Amis et blocage --- */
  const targetUser = (p) => {
    let t = null;
    if (p && p.userId != null) t = q.userById.get(Number(p.userId));
    else if (p && typeof p.name === "string") t = db.prepare("SELECT * FROM users WHERE name = ? COLLATE NOCASE").get(clean(p.name, 40).replace(/^@/, ""));
    return t && !t.banned ? t : null;
  };
  socket.on("social", guard((_p, ack) => ack({ social: socialOf(uid) })));
  socket.on("friendRequest", guard((p, ack) => {
    if (hit(friendHits, uid, 60000, 20)) return ack({ error: "Trop de demandes, patientez un instant." });
    const t = targetUser(p);
    if (!t) return ack({ error: "Aucun utilisateur ne porte ce pseudo." });
    if (t.id === uid) return ack({ error: "Vous ne pouvez pas vous ajouter vous-même." });
    if (t.role === "bot") return ack({ error: "Un robot ne peut pas être ajouté en ami." });
    if (isBlocking(uid, t.id)) return ack({ error: "Vous avez bloqué cette personne. Débloquez-la d'abord." });
    if (isBlocking(t.id, uid)) return ack({ error: "Impossible d'envoyer la demande à cette personne." });
    const r = friendRow(uid, t.id);
    if (r && r.status === "accepted") return ack({ error: "Vous êtes déjà amis." });
    if (r && r.requester === uid) return ack({ error: "Demande déjà envoyée." });
    if (r) { db.prepare("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?").run(r.a, r.b); pushSocial(uid, t.id); io.to("user:" + t.id).emit("friendNotice", { text: cur().name + " a accepté votre demande d'ami." }); return ack({ ok: true, accepted: true, name: t.name }); }
    const [a, b] = pair(uid, t.id);
    db.prepare("INSERT INTO friends (a, b, requester, status, created) VALUES (?,?,?,'pending',?)").run(a, b, uid, Date.now());
    pushSocial(uid, t.id); io.to("user:" + t.id).emit("friendNotice", { text: cur().name + " vous a envoyé une demande d'ami." });
    ack({ ok: true, name: t.name });
  }));
  socket.on("friendAccept", guard((p, ack) => {
    const t = targetUser(p), r = t && friendRow(uid, t.id);
    if (!r || r.status !== "pending" || r.requester === uid) return ack({ error: "Demande introuvable." });
    db.prepare("UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?").run(r.a, r.b);
    pushSocial(uid, t.id); io.to("user:" + t.id).emit("friendNotice", { text: cur().name + " a accepté votre demande d'ami." }); ack({ ok: true });
  }));
  // Refuser, annuler une demande envoyée ou retirer un ami : même geste
  socket.on("friendRemove", guard((p, ack) => {
    const t = targetUser(p) || (p && p.userId != null ? q.userById.get(Number(p.userId)) : null), r = t && friendRow(uid, t.id);
    if (!r) return ack({ error: "Introuvable." });
    db.prepare("DELETE FROM friends WHERE a = ? AND b = ?").run(r.a, r.b); pushSocial(uid, t.id); ack({ ok: true });
  }));
  socket.on("block", guard((p, ack) => {
    const t = targetUser(p); if (!t) return ack({ error: "Utilisateur introuvable." });
    if (t.id === uid) return ack({ error: "Vous ne pouvez pas vous bloquer vous-même." });
    tx(() => {
      db.prepare("INSERT OR IGNORE INTO blocks (user_id, blocked_id, created) VALUES (?,?,?)").run(uid, t.id, Date.now());
      const [a, b] = pair(uid, t.id); db.prepare("DELETE FROM friends WHERE a = ? AND b = ?").run(a, b);
    });
    pushSocial(uid, t.id); ack({ ok: true });
  }));
  socket.on("unblock", guard((p, ack) => {
    const t = p && p.userId != null ? q.userById.get(Number(p.userId)) : null; if (!t) return ack({ error: "Utilisateur introuvable." });
    db.prepare("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?").run(uid, t.id); pushSocial(uid); ack({ ok: true });
  }));
  socket.on("openDm", guard(({ userId }, ack) => {
    const other = q.userById.get(Number(userId));
    if (!other || other.banned) return ack({ error: "Utilisateur introuvable." });
    if (other.id === uid) return ack({ error: "Vous ne pouvez pas vous écrire à vous-même." });
    if (other.role === "bot") return ack({ error: "Cordibot ne répond pas aux messages privés." });
    if (isBlocking(uid, other.id)) return ack({ error: "Vous avez bloqué cette personne. Débloquez-la pour lui écrire." });
    if (isBlocking(other.id, uid)) return ack({ error: "Vous ne pouvez pas écrire à cette personne." });
    if (!q.shareServer.get(uid, other.id) && !areFriends(uid, other.id)) return ack({ error: "Vous devez partager un serveur ou être amis avec cette personne." });
    let created = false;
    const found = q.findDm.get(uid, other.id);
    const id = found ? found.id : tx(() => {
      const cid = Number(q.insChannel.run(DM_SERVER, "dm", "", "dm", "dm").lastInsertRowid);
      q.insDmMember.run(cid, uid); q.insDmMember.run(cid, other.id); created = true; return cid;
    });
    const view = (o) => ({ id, other: { id: o.id, name: o.name, color: o.color, role: o.role, avatar: o.avatar || null, custom: o.custom || "", status: shownStatus(o) } });
    if (created) io.to("user:" + other.id).emit("dmOpened", view(cur()));
    ack({ dm: view(other) });
  }));

  /* --- Serveurs et salons --- */
  // Sourdine des notifications d'un salon ou d'un serveur, pour soi seulement : minutes = durée, null = jusqu'à réactivation, off = réactiver
  socket.on("notifMute", guard(({ kind, id, minutes, off }, ack) => {
    id = Number(id);
    if (kind === "server") { const s = q.serverById.get(id); if (!s || s.id === DM_SERVER || !q.isMember.get(s.id, uid)) return ack({ error: "Serveur introuvable." }); }
    else if (kind === "channel") { if (!canAccess(uid, id)) return ack({ error: "Salon introuvable." }); }
    else return ack({ error: "Cible invalide." });
    if (off) q.nmDel.run(uid, kind, id);
    else {
      const m = minutes === null || minutes === undefined ? null : Math.floor(Number(minutes));
      if (m !== null && !(m >= 1 && m <= 60 * 24 * 365)) return ack({ error: "Durée invalide." });
      q.nmSet.run(uid, kind, id, m === null ? null : Date.now() + m * 60e3);
    }
    db.prepare("DELETE FROM notif_mutes WHERE user_id = ? AND until IS NOT NULL AND until <= ?").run(uid, Date.now());
    io.to("user:" + uid).emit("notifMutes", notifMutesOf(uid)); ack({ ok: true });
  }));

  /* Quitter, transférer, supprimer */
  socket.on("leaveServer", guard(({ serverId }, ack) => {
    const s = q.serverById.get(serverId);
    if (!s || s.id === DM_SERVER || !q.isMember.get(s.id, uid)) return ack({ error: "Serveur introuvable." });
    if (s.owner_id === uid) return ack({ error: "Vous êtes propriétaire : transférez le serveur à quelqu'un d'autre ou supprimez-le." });
    removeMember(s.id, uid);
    socket.emit("serverLeft", { serverId: s.id });
    io.in("user:" + uid).socketsLeave("srv:" + s.id);
    io.to("srv:" + s.id).emit("membersChanged", { serverId: s.id }); ack({ ok: true });
  }));
  socket.on("transferServer", guard(({ serverId, userId }, ack) => {
    const s = q.serverById.get(serverId), t = q.userById.get(Number(userId));
    if (!s || s.id === DM_SERVER || !q.isMember.get(s.id, uid)) return ack({ error: "Serveur introuvable." });
    if (s.owner_id !== uid) return ack({ error: "Seul le propriétaire peut transférer le serveur." });
    if (!t || t.id === uid || t.role === "bot" || t.banned || !q.isMember.get(s.id, t.id)) return ack({ error: "Choisissez un autre membre du serveur." });
    db.prepare("UPDATE servers SET owner_id = ? WHERE id = ?").run(t.id, s.id);
    io.to("srv:" + s.id).emit("serverUpdated", partnerPublic(q.serverById.get(s.id)));
    io.to("srv:" + s.id).emit("rolesChanged", { serverId: s.id }); io.to("srv:" + s.id).emit("membersChanged", { serverId: s.id });
    ack({ ok: true });
  }));
  socket.on("deleteServer", guard(({ serverId, name }, ack) => {
    const s = q.serverById.get(serverId);
    if (!s || s.id === DM_SERVER || !q.isMember.get(s.id, uid)) return ack({ error: "Serveur introuvable." });
    if (s.owner_id !== uid) return ack({ error: "Seul le propriétaire peut supprimer le serveur." });
    if (s.id === DEFAULT_SERVER) return ack({ error: "Le serveur par défaut ne peut pas être supprimé." });
    if (String(name || "").trim() !== s.name) return ack({ error: "Pour confirmer, tapez le nom exact du serveur." });
    destroyServer(s); ack({ ok: true });
  }));

  // Renommer : propriétaire du serveur ou équipe du site
  socket.on("renameServer", guard(({ serverId, name }, ack) => {
    user = cur();
    const s = q.serverById.get(serverId);
    if (!s || s.id === DM_SERVER || !q.isMember.get(s.id, uid)) return ack({ error: "Serveur introuvable." });
    if (s.owner_id !== uid && !isStaff(user)) return ack({ error: "Seul le propriétaire peut renommer le serveur." });
    const n = clean(name, 30); if (n.length < 2) return ack({ error: "Nom trop court (2 caractères minimum)." });
    db.prepare("UPDATE servers SET name = ?, abbr = ? WHERE id = ?").run(n, abbr(n), s.id);
    io.to("srv:" + s.id).emit("serverUpdated", partnerPublic(q.serverById.get(s.id))); ack({ ok: true });
  }));

  socket.on("createServer", guard(({ name }, ack) => {
    name = clean(name, 30); if (name.length < 2) return ack({ error: "Nom trop court (2 caractères minimum)." });
    const s = tx(() => {
      const id = Number(q.insServer.run(name, abbr(name), newCode(), uid).lastInsertRowid);
      q.insChannel.run(id, "général", "Le salon principal de " + name, "Salons", "text");
      q.insChannel.run(id, "salon-vocal", "Discutez à la voix", "Vocal", "voice");
      q.join.run(id, uid);
      return q.serverById.get(id);
    });
    socket.join("srv:" + s.id); ack({ server: serverView(s, cur()) });
  }));

  socket.on("joinServer", guard(({ code }, ack) => {
    const s = q.serverByCode.get(clean(code, 12).toUpperCase());
    if (!s || s.id === DM_SERVER) return ack({ error: "Code d'invitation invalide." });
    const ban = activeBan(s.id, uid);
    if (ban) return ack({ error: "Vous êtes banni de ce serveur " + (ban.until ? "jusqu'au " + fmtDate(ban.until) : "définitivement") + (ban.reason ? " (" + ban.reason + ")" : "") + "." });
    q.join.run(s.id, uid); socket.join("srv:" + s.id);
    io.to("srv:" + s.id).emit("membersChanged", { serverId: s.id });
    ack({ server: serverView(s, cur()) });
  }));

  /* --- Rôles --- */
  const roleView = (r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, perms: r.perms, hoist: !!r.hoist, count: r.count || 0 });
  const rolesChanged = (sid) => { io.to("srv:" + sid).emit("rolesChanged", { serverId: sid }); io.to("srv:" + sid).emit("channelsChanged", { serverId: sid }); }; // les clients rechargent aussi leurs salons : un rôle peut ouvrir ou fermer un salon privé
  const COLOR = /^#[0-9a-fA-F]{6}$/;
  // Contrôle commun : droit de gérer les rôles, et le rôle visé doit être plus bas que le sien
  function manageable(roleId, ack) {
    user = cur();
    const r = q.roleById.get(Number(roleId)); if (!r) { ack({ error: "Rôle introuvable." }); return null; }
    if (!q.isMember.get(r.server_id, uid) || !can(user, r.server_id, P.ROLES)) { ack({ error: "Vous n'avez pas la permission de gérer les rôles." }); return null; }
    if (r.position >= rankOf(user, r.server_id)) { ack({ error: "Ce rôle est au même niveau que le vôtre ou au-dessus." }); return null; }
    return r;
  }
  socket.on("roles", guard(({ serverId }, ack) => {
    if (!q.isMember.get(serverId, uid)) return ack({ error: "Accès refusé." });
    user = cur();
    const mu = activeMute(serverId, uid);
    ack({ roles: q.rolesOf.all(serverId).map(roleView), perms: permsOf(user, serverId), rank: rankOf(user, serverId), mod: canMod(user, serverId), mutedUntil: mu ? mu.until : null });
  }));
  socket.on("createRole", guard(({ serverId, name, color, perms, hoist }, ack) => {
    user = cur();
    const s = q.serverById.get(serverId);
    if (!s || s.id === DM_SERVER || !q.isMember.get(serverId, uid) || !can(user, serverId, P.ROLES)) return ack({ error: "Vous n'avez pas la permission de créer un rôle." });
    const n = clean(name, 24); if (!n) return ack({ error: "Donnez un nom au rôle." });
    if (q.rolesOf.all(serverId).length >= 25) return ack({ error: "25 rôles maximum par serveur." });
    const mine = permsOf(user, serverId);
    // Un nouveau rôle se place tout en bas de la hiérarchie (les autres montent d'un cran), donc toujours sous son créateur
    const id = tx(() => {
      db.prepare("UPDATE roles SET position = position + 1 WHERE server_id = ?").run(serverId);
      return Number(db.prepare("INSERT INTO roles (server_id, name, color, position, perms, hoist) VALUES (?, ?, ?, 1, ?, ?)").run(serverId, n, COLOR.test(color) ? color : "#99aab5", (Number(perms) || 0) & P_ALL & mine, hoist ? 1 : 0).lastInsertRowid);
    });
    rolesChanged(serverId); ack({ ok: true, id });
  }));
  socket.on("updateRole", guard(({ roleId, name, color, perms, hoist }, ack) => {
    const r = manageable(roleId, ack); if (!r) return;
    const n = name === undefined ? r.name : clean(name, 24); if (!n) return ack({ error: "Donnez un nom au rôle." });
    const mine = permsOf(user, r.server_id);
    // On ne peut pas donner un droit qu'on n'a pas soi-même, ni retirer celui qu'on n'a pas
    const wanted = perms === undefined ? r.perms : (Number(perms) || 0) & P_ALL, keep = r.perms & ~mine;
    db.prepare("UPDATE roles SET name = ?, color = ?, perms = ?, hoist = ? WHERE id = ?").run(n, COLOR.test(color) ? color : r.color, (wanted & mine) | keep, hoist === undefined ? r.hoist : hoist ? 1 : 0, r.id);
    rolesChanged(r.server_id); ack({ ok: true });
  }));
  socket.on("moveRole", guard(({ roleId, dir }, ack) => {
    const r = manageable(roleId, ack); if (!r) return;
    const list = q.rolesOf.all(r.server_id), i = list.findIndex((x) => x.id === r.id), o = list[i + (dir > 0 ? -1 : 1)];
    if (!o) return ack({ ok: true });
    if (o.position >= rankOf(user, r.server_id)) return ack({ error: "Vous ne pouvez pas dépasser votre propre niveau." });
    // Échange des niveaux ; si égaux, on décale d'un cran
    const a = r.position, b = o.position;
    tx(() => {
      if (a === b) db.prepare("UPDATE roles SET position = position + ? WHERE id = ?").run(dir > 0 ? 1 : -1, r.id);
      else { db.prepare("UPDATE roles SET position = ? WHERE id = ?").run(b, r.id); db.prepare("UPDATE roles SET position = ? WHERE id = ?").run(a, o.id); }
    });
    rolesChanged(r.server_id); ack({ ok: true });
  }));
  socket.on("deleteRole", guard(({ roleId }, ack) => {
    const r = manageable(roleId, ack); if (!r) return;
    db.prepare("DELETE FROM roles WHERE id = ?").run(r.id); rolesChanged(r.server_id); ack({ ok: true });
  }));
  socket.on("setMemberRoles", guard(({ serverId, userId, roleIds }, ack) => {
    user = cur();
    const s = q.serverById.get(serverId), t = q.userById.get(Number(userId));
    if (!s || !t || !q.isMember.get(serverId, uid) || !q.isMember.get(serverId, t.id)) return ack({ error: "Membre introuvable." });
    if (!can(user, serverId, P.ROLES)) return ack({ error: "Vous n'avez pas la permission de gérer les rôles." });
    const rank = rankOf(user, serverId);
    if (t.id !== uid && rankOf(t, serverId) >= rank) return ack({ error: "Ce membre est au même niveau que vous ou au-dessus." });
    const want = new Set((Array.isArray(roleIds) ? roleIds : []).map(Number)), have = new Set(q.userRoles.all(serverId, t.id).map((r) => r.id));
    const all = q.rolesOf.all(serverId);
    tx(() => all.forEach((r) => {
      if (r.position >= rank || want.has(r.id) === have.has(r.id)) return; // hors de portée ou inchangé
      if (want.has(r.id)) db.prepare("INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES (?, ?, ?)").run(serverId, t.id, r.id);
      else db.prepare("DELETE FROM member_roles WHERE user_id = ? AND role_id = ?").run(t.id, r.id);
    }));
    rolesChanged(serverId); ack({ ok: true });
  }));
  /* ---------- Sanctions : avertissement, sourdine, expulsion, bannissement ---------- */
  // Cible valide : membre du serveur (ou banni, pour le débannissement), de rang strictement inférieur
  function sanctionTarget(serverId, userId, flag, ack, { allowFormer = false } = {}) {
    user = cur();
    const s = q.serverById.get(serverId), t = q.userById.get(Number(userId));
    if (!s || !t || s.id === DM_SERVER || !q.isMember.get(serverId, uid)) { ack({ error: "Membre introuvable." }); return null; }
    if (!can(user, serverId, flag)) { ack({ error: "Vous n'avez pas la permission pour cette action." }); return null; }
    if (!allowFormer && !q.isMember.get(serverId, t.id)) { ack({ error: "Membre introuvable." }); return null; }
    if (t.id === uid) { ack({ error: "Vous ne pouvez pas vous sanctionner vous-même." }); return null; }
    if (t.id === s.owner_id || t.role === "admin" || (q.isMember.get(serverId, t.id) && rankOf(t, serverId) >= rankOf(user, serverId))) { ack({ error: "Ce membre est au même niveau que vous ou au-dessus." }); return null; }
    return { s, t };
  }
  const tell = (t, sid, payload) => io.to("user:" + t.id).emit("sanction", { serverId: sid, ...payload });
  const removeMember = (sid, tid) => tx(() => { db.prepare("DELETE FROM member_roles WHERE server_id = ? AND user_id = ?").run(sid, tid); db.prepare("DELETE FROM members WHERE server_id = ? AND user_id = ?").run(sid, tid); });
  function evict(s, t, extra = {}) {
    removeMember(s.id, t.id);
    io.to("user:" + t.id).emit("kicked", { serverId: s.id, name: s.name, ...extra });
    io.in("user:" + t.id).socketsLeave("srv:" + s.id);
    io.to("srv:" + s.id).emit("membersChanged", { serverId: s.id });
  }
  const reasonOf = (r) => clean(r, 200);

  socket.on("kick", guard(({ serverId, userId, reason }, ack) => {
    const r = sanctionTarget(serverId, userId, P.KICK, ack); if (!r) return;
    logSanction(serverId, r.t.id, "kick", reasonOf(reason), null, uid);
    evict(r.s, r.t, { reason: reasonOf(reason) }); ack({ ok: true });
  }));

  socket.on("ban", guard(({ serverId, userId, hours, reason }, ack) => {
    const r = sanctionTarget(serverId, userId, P.BAN, ack); if (!r) return;
    const perm = hours === null || hours === undefined || hours === 0, h = perm ? null : Math.floor(Number(hours));
    if (!perm && !(h >= 1 && h <= 24 * 365)) return ack({ error: "Durée invalide." });
    const until = h ? Date.now() + h * 3600e3 : null, why = reasonOf(reason);
    q.setBan.run(serverId, r.t.id, until, why, uid, Date.now());
    db.prepare("DELETE FROM mutes WHERE server_id = ? AND user_id = ?").run(serverId, r.t.id);
    logSanction(serverId, r.t.id, "ban", why, until, uid);
    evict(r.s, r.t, { banned: true, until, reason: why }); ack({ ok: true });
  }));

  socket.on("unban", guard(({ serverId, userId }, ack) => {
    const r = sanctionTarget(serverId, userId, P.BAN, ack, { allowFormer: true }); if (!r) return;
    if (!db.prepare("DELETE FROM bans WHERE server_id = ? AND user_id = ?").run(serverId, r.t.id).changes) return ack({ error: "Cette personne n'est pas bannie." });
    logSanction(serverId, r.t.id, "unban", "", null, uid); ack({ ok: true });
  }));

  socket.on("warn", guard(({ serverId, userId, reason }, ack) => {
    const r = sanctionTarget(serverId, userId, P.MUTE, ack); if (!r) return;
    const why = reasonOf(reason); if (!why) return ack({ error: "Indiquez le motif de l'avertissement." });
    logSanction(serverId, r.t.id, "warn", why, null, uid);
    tell(r.t, serverId, { type: "warn", reason: why, server: r.s.name });
    ack({ ok: true });
  }));

  socket.on("mute", guard(({ serverId, userId, minutes, reason }, ack) => {
    const r = sanctionTarget(serverId, userId, P.MUTE, ack); if (!r) return;
    const m = Math.floor(Number(minutes) || 10);
    if (m < 1 || m > 7 * 24 * 60) return ack({ error: "Durée invalide (1 minute à 7 jours)." });
    const until = Date.now() + m * 60e3, why = reasonOf(reason);
    q.setMute.run(serverId, r.t.id, until, why, uid, Date.now());
    logSanction(serverId, r.t.id, "mute", why, until, uid);
    tell(r.t, serverId, { type: "mute", until, reason: why, server: r.s.name });
    io.to("user:" + r.t.id).emit("forceVoiceLeave", { serverId });
    ack({ ok: true, until });
  }));

  socket.on("unmute", guard(({ serverId, userId }, ack) => {
    const r = sanctionTarget(serverId, userId, P.MUTE, ack); if (!r) return;
    if (!db.prepare("DELETE FROM mutes WHERE server_id = ? AND user_id = ?").run(serverId, r.t.id).changes) return ack({ error: "Cette personne n'est pas en sourdine." });
    logSanction(serverId, r.t.id, "unmute", "", null, uid);
    tell(r.t, serverId, { type: "unmute", server: r.s.name }); ack({ ok: true });
  }));

  // Historique et sanctions en cours : réservé à l'équipe de modération du serveur
  socket.on("sanctions", guard(({ serverId, userId }, ack) => {
    user = cur();
    if (!q.isMember.get(serverId, uid) || !canMod(user, serverId)) return ack({ error: "Réservé aux modérateurs." });
    const now = Date.now(), nameOf = (id) => { const u = id && q.userById.get(id); return u ? u.name : "—"; };
    const view = (r) => ({ id: r.id, type: r.type, reason: r.reason, until: r.until, ts: r.ts, user: { id: r.user_id, name: nameOf(r.user_id) }, by: nameOf(r.by_id) });
    if (userId) { // fiche d'un membre
      const rows = db.prepare("SELECT * FROM sanctions WHERE server_id = ? AND user_id = ? ORDER BY id DESC LIMIT 100").all(serverId, Number(userId));
      return ack({ history: rows.map(view), mute: activeMute(serverId, Number(userId)), ban: activeBan(serverId, Number(userId)) });
    }
    const bans = db.prepare("SELECT * FROM bans WHERE server_id = ? AND (until IS NULL OR until > ?) ORDER BY ts DESC").all(serverId, now);
    const mutes = db.prepare("SELECT * FROM mutes WHERE server_id = ? AND until > ? ORDER BY until").all(serverId, now);
    const rows = db.prepare("SELECT * FROM sanctions WHERE server_id = ? ORDER BY id DESC LIMIT 200").all(serverId);
    ack({
      bans: bans.map((b) => ({ user: { id: b.user_id, name: nameOf(b.user_id) }, until: b.until, reason: b.reason, ts: b.ts, by: nameOf(b.by_id) })),
      mutes: mutes.map((m) => ({ user: { id: m.user_id, name: nameOf(m.user_id) }, until: m.until, reason: m.reason, ts: m.ts, by: nameOf(m.by_id) })),
      history: rows.map(view),
    });
  }));

  // Rôles autorisés d'un salon privé : uniquement des rôles de ce serveur
  const setChannelRoles = (c, roleIds) => {
    db.prepare("DELETE FROM channel_roles WHERE channel_id = ?").run(c.id);
    if (!c.private) return;
    const valid = new Set(q.rolesOf.all(c.server_id).map((r) => r.id));
    [...new Set((Array.isArray(roleIds) ? roleIds : []).map(Number))].filter((id) => valid.has(id)).forEach((id) => db.prepare("INSERT INTO channel_roles (channel_id, role_id) VALUES (?, ?)").run(c.id, id));
  };
  const channelsChanged = (sid) => io.to("srv:" + sid).emit("channelsChanged", { serverId: sid });
  socket.on("channels", guard(({ serverId }, ack) => {
    if (!q.isMember.get(serverId, uid)) return ack({ error: "Accès refusé." });
    ack({ channels: visibleChannels(serverId, cur()), categories: catsOf(serverId) });
  }));
  const catAuth = (serverId) => {
    user = cur();
    const s = q.serverById.get(serverId);
    return s && s.id !== DM_SERVER && can(user, s.id, P.CHANNELS) ? s : null;
  };
  const catName = (name) => clean(name, 30).replace(/\s+/g, " ");
  const catFind = (sid, name) => catsOf(sid).find((c) => c.toLowerCase() === name.toLowerCase());
  socket.on("createCategory", guard(({ serverId, name }, ack) => {
    const s = catAuth(serverId); if (!s) return ack({ error: "Vous n'avez pas la permission de gérer les catégories." });
    const n = catName(name); if (!n) return ack({ error: "Donnez un nom à la catégorie." });
    if (catFind(s.id, n)) return ack({ error: "Cette catégorie existe déjà." });
    if (catsOf(s.id).length >= CAT_MAX) return ack({ error: "Maximum " + CAT_MAX + " catégories." });
    tx(() => {
      materializeCats(s.id);
      const pos = db.prepare("SELECT COALESCE(MAX(position),0)+1 AS p FROM categories WHERE server_id = ?").get(s.id).p;
      db.prepare("INSERT INTO categories (server_id, name, position) VALUES (?,?,?)").run(s.id, n, pos);
    });
    channelsChanged(s.id); ack({ ok: true, name: n });
  }));
  socket.on("renameCategory", guard(({ serverId, from, to }, ack) => {
    const s = catAuth(serverId); if (!s) return ack({ error: "Vous n'avez pas la permission de gérer les catégories." });
    const f = catFind(s.id, String(from || "")), n = catName(to);
    if (!f) return ack({ error: "Catégorie introuvable." });
    if (!n) return ack({ error: "Donnez un nom à la catégorie." });
    const other = catFind(s.id, n); if (other && other.toLowerCase() !== f.toLowerCase()) return ack({ error: "Cette catégorie existe déjà." });
    tx(() => {
      materializeCats(s.id);
      const row = db.prepare("SELECT position FROM categories WHERE server_id = ? AND name = ?").get(s.id, f);
      const pos = row ? row.position : db.prepare("SELECT COALESCE(MAX(position),0)+1 AS p FROM categories WHERE server_id = ?").get(s.id).p;
      db.prepare("DELETE FROM categories WHERE server_id = ? AND name = ?").run(s.id, f);
      db.prepare("INSERT INTO categories (server_id, name, position) VALUES (?,?,?)").run(s.id, n, pos);
      db.prepare("UPDATE channels SET category = ? WHERE server_id = ? AND category = ?").run(n, s.id, f);
    });
    channelsChanged(s.id); ack({ ok: true });
  }));
  socket.on("reorderCategories", guard(({ serverId, names }, ack) => {
    const s = catAuth(serverId); if (!s) return ack({ error: "Vous n'avez pas la permission de gérer les catégories." });
    const have = catsOf(s.id), want = Array.isArray(names) ? names.map((n) => String(n)) : [];
    if (want.length !== have.length || !have.every((h) => want.includes(h))) return ack({ error: "Liste de catégories périmée, réessayez." });
    tx(() => {
      db.prepare("DELETE FROM categories WHERE server_id = ?").run(s.id);
      want.forEach((n, i) => db.prepare("INSERT INTO categories (server_id, name, position) VALUES (?,?,?)").run(s.id, n, i + 1));
    });
    channelsChanged(s.id); ack({ ok: true });
  }));
  socket.on("deleteCategory", guard(({ serverId, name }, ack) => {
    const s = catAuth(serverId); if (!s) return ack({ error: "Vous n'avez pas la permission de gérer les catégories." });
    const f = catFind(s.id, String(name || "")); if (!f) return ack({ error: "Catégorie introuvable." });
    tx(() => {
      // les salons ne sont jamais supprimés : ils retournent dans la catégorie par défaut de leur type
      db.prepare("DELETE FROM categories WHERE server_id = ? AND name = ?").run(s.id, f);
      db.prepare("UPDATE channels SET category = 'Salons' WHERE server_id = ? AND category = ? AND kind = 'text'").run(s.id, f);
      db.prepare("UPDATE channels SET category = 'Vocal' WHERE server_id = ? AND category = ? AND kind = 'voice'").run(s.id, f);
    });
    channelsChanged(s.id); ack({ ok: true });
  }));
  socket.on("createChannel", guard(({ serverId, name, topic, kind, category, private: priv, roleIds }, ack) => {
    user = cur();
    const s = q.serverById.get(serverId);
    if (!s || s.id === DM_SERVER || !can(user, s.id, P.CHANNELS)) return ack({ error: "Vous n'avez pas la permission de créer un salon." });
    const n = clean(name, 24).toLowerCase().replace(/\s+/g, "-");
    if (!/^[\p{L}\p{N}_-]{1,24}$/u.test(n)) return ack({ error: "Nom de salon invalide." });
    const k = kind === "voice" ? "voice" : "text";
    const cat = category ? catFind(serverId, catName(category)) : null;
    if (category && !cat) return ack({ error: "Catégorie introuvable." });
    const id = Number(q.insChannel.run(serverId, n, clean(topic, 100), cat || (k === "voice" ? "Vocal" : "Salons"), k).lastInsertRowid);
    if (priv) { db.prepare("UPDATE channels SET private = 1 WHERE id = ?").run(id); setChannelRoles(q.channel.get(id), roleIds); channelsChanged(serverId); }
    else io.to("srv:" + serverId).emit("channelCreated", { serverId, channel: chView(q.channel.get(id)) });
    ack({ ok: true });
  }));

  socket.on("setChannel", guard(({ channelId, slowmode, readonly, topic, category, private: priv, roleIds }, ack) => {
    user = cur();
    const c = q.channel.get(channelId);
    if (!c || c.kind === "dm") return ack({ error: "Salon introuvable." });
    const s = q.serverById.get(c.server_id);
    if (!can(user, s.id, P.CHANNELS)) return ack({ error: "Vous n'avez pas la permission de modifier ce salon." });
    const slow = slowmode === undefined ? c.slowmode : Math.max(0, Math.min(SLOW_MAX, Math.floor(Number(slowmode)) || 0));
    const ro = readonly === undefined ? c.readonly : readonly ? 1 : 0;
    const wasPrivate = !!c.private, isPrivate = priv === undefined ? wasPrivate : !!priv;
    let moved = false;
    if (category !== undefined) {
      const cat = catFind(c.server_id, catName(category));
      if (!cat) return ack({ error: "Catégorie introuvable." });
      if (cat !== c.category) { db.prepare("UPDATE channels SET category = ? WHERE id = ?").run(cat, c.id); moved = true; }
    }
    q.updChannel.run(topic === undefined ? c.topic : clean(topic, 100), c.kind === "voice" ? 0 : slow, c.kind === "voice" ? 0 : ro, c.id);
    if (priv !== undefined || roleIds !== undefined) {
      db.prepare("UPDATE channels SET private = ? WHERE id = ?").run(isPrivate ? 1 : 0, c.id);
      setChannelRoles(q.channel.get(c.id), roleIds === undefined ? q.chRoles.all(c.id).map((r) => r.role_id) : roleIds);
    }
    // Tout changement de visibilité : chacun recharge sa propre liste de salons
    if (wasPrivate || isPrivate || moved) channelsChanged(c.server_id);
    else io.to("srv:" + c.server_id).emit("channelUpdated", { serverId: c.server_id, channel: chView(q.channel.get(c.id)) });
    ack({ ok: true });
  }));

  socket.on("deleteChannel", guard(({ channelId }, ack) => {
    user = cur();
    const c = q.channel.get(channelId);
    if (!c || c.kind === "dm") return ack({ error: "Salon introuvable." });
    const s = q.serverById.get(c.server_id);
    if (!can(user, s.id, P.CHANNELS)) return ack({ error: "Vous n'avez pas la permission de supprimer ce salon." });
    if (c.kind === "text" && q.countTextChannels.get(c.server_id).n <= 1) return ack({ error: "Un serveur doit garder au moins un salon textuel." });
    db.prepare("SELECT id FROM messages WHERE channel_id = ?").all(c.id).forEach((m) => removeFiles(m.id));
    voiceRooms.delete(c.id); io.in("voice:" + c.id).emit("voiceEnded", { channelId: c.id }); io.in("voice:" + c.id).socketsLeave("voice:" + c.id);
    q.delChannel.run(c.id);
    if (c.private) channelsChanged(c.server_id); else io.to("srv:" + c.server_id).emit("channelDeleted", { serverId: c.server_id, channelId: c.id });
    ack({ ok: true });
  }));

  /* --- Salons vocaux (WebRTC maillé : les navigateurs s'échangent l'audio, le serveur ne relaie que la signalisation) --- */
  function leaveVoice() {
    if (!voiceChan) return;
    const cid = voiceChan, room = voiceRooms.get(cid); voiceChan = null;
    socket.leave("voice:" + cid);
    if (room) { room.delete(socket.id); if (!room.size) voiceRooms.delete(cid); }
    socket.to("voice:" + cid).emit("voicePeerLeft", { channelId: cid, socketId: socket.id });
    const c = q.channel.get(cid); if (c) {
      broadcastRoster(c);
      // Appel privé : si plus personne n'est dedans, l'appel (ou la sonnerie) se termine pour les deux
      if (c.kind === "dm" && !voiceRooms.has(cid)) io.to(roomsOf(c)).emit("callDismiss", { channelId: cid, missed: !(room && room.answered), from: uid });
    }
  }
  socket.on("voiceJoin", guard(({ channelId }, ack) => {
    user = cur();
    const c = canAccess(uid, channelId);
    if (!c || (c.kind !== "voice" && c.kind !== "dm")) return ack({ error: "Salon vocal introuvable." });
    const isDm = c.kind === "dm", peerId = isDm ? peerOfDm(c, uid) : null;
    if (isDm) {
      const other = peerId && q.userById.get(peerId);
      if (!other || other.banned || other.role === "bot") return ack({ error: "Cette personne est introuvable." });
      if (isBlocking(uid, peerId)) return ack({ error: "Vous avez bloqué cette personne. Débloquez-la pour l'appeler." });
      if (isBlocking(peerId, uid)) return ack({ error: "Cette personne ne peut pas recevoir vos appels." });
    } else if (activeMute(c.server_id, uid)) return ack({ error: "Vous êtes en sourdine : le vocal est indisponible." });
    if (voiceChan === c.id) return ack({ error: "Vous êtes déjà dans ce salon." });
    leaveVoice();
    const room = voiceRooms.get(c.id) || new Map();
    if (room.size >= (isDm ? 2 : MAX_VOICE)) return ack({ error: isDm ? "Vous êtes déjà en appel sur un autre appareil." : "Salon vocal plein (" + MAX_VOICE + " personnes maximum)." });
    const firstIn = isDm && !room.size;
    if (firstIn && hit(callHits, uid, 60000, 6)) return ack({ error: "Trop d'appels, patientez un instant." });
    const peers = [...room.entries()].map(([sid, p]) => ({ socketId: sid, user: p.user, muted: p.muted, screen: !!p.screen, cam: !!p.cam, screenId: p.screenId || null, camId: p.camId || null }));
    room.set(socket.id, { user: pub(user), muted: false, screen: false, cam: false, screenId: null, camId: null }); voiceRooms.set(c.id, room); voiceChan = c.id;
    socket.join("voice:" + c.id);
    socket.to("voice:" + c.id).emit("voicePeerJoined", { channelId: c.id, socketId: socket.id, user: pub(user) });
    broadcastRoster(c);
    if (isDm) {
      if (firstIn) {
        // Fait sonner la personne appelée, sauf si elle est en « Ne pas déranger »
        const target = q.userById.get(peerId);
        if (target && target.status !== "dnd") {
          io.to("user:" + peerId).emit("callIncoming", { channelId: c.id, from: pub(user) });
          if (!isOnline(peerId) || ![...online.get(peerId).values()].some((s) => s.visible)) sendPush(peerId, { title: "Appel de " + user.name, body: "Touchez pour répondre", tag: "call" + c.id, url: "/app" });
        }
      } else { room.answered = true; io.to(roomsOf(c)).emit("callDismiss", { channelId: c.id, answered: true, by: uid }); }
    }
    ack({ ok: true, peers, ice: ICE });
  }));
  socket.on("callDecline", guard(({ channelId }) => {
    const c = canAccess(uid, channelId); if (!c || c.kind !== "dm") return;
    const peerId = peerOfDm(c, uid); if (!peerId) return;
    io.to("user:" + peerId).emit("callDeclined", { channelId: c.id, by: cur().name });
    io.to("user:" + uid).emit("callDismiss", { channelId: c.id, declined: true });
  }));
  socket.on("voiceSignal", guard(({ to, data }) => {
    const room = voiceChan && voiceRooms.get(voiceChan);
    if (!room || !room.has(to) || typeof to !== "string" || !data || typeof data !== "object" || JSON.stringify(data).length > 30000) return;
    io.to(to).emit("voiceSignal", { from: socket.id, data });
  }));
  socket.on("voiceMute", guard(({ muted }) => {
    const room = voiceChan && voiceRooms.get(voiceChan), p = room && room.get(socket.id);
    if (!p) return;
    p.muted = !!muted;
    socket.to("voice:" + voiceChan).emit("voicePeerState", { socketId: socket.id, muted: p.muted });
    const c = q.channel.get(voiceChan); if (c) broadcastRoster(c);
  }));
  // Partage d'écran : le serveur ne fait que signaler qui partage (la vidéo passe de navigateur à navigateur), 2 partages simultanés au maximum
  socket.on("voiceScreen", guard(({ on, streamId }, ack) => {
    const room = voiceChan && voiceRooms.get(voiceChan), p = room && room.get(socket.id);
    if (!p) return ack({ error: "Rejoignez d'abord le salon vocal." });
    on = !!on;
    if (on && !p.screen && [...room.values()].filter((x) => x.screen).length >= MAX_SCREENS) return ack({ error: "Déjà " + MAX_SCREENS + " partages d'écran en cours dans ce salon." });
    p.screen = on; p.screenId = on ? String(streamId || "").slice(0, 80) : null; announceVideo(p);
    ack({ ok: true });
  }));
  // Caméra : même principe que le partage d'écran (l'image passe de navigateur à navigateur)
  socket.on("voiceCam", guard(({ on, streamId }, ack) => {
    const room = voiceChan && voiceRooms.get(voiceChan), p = room && room.get(socket.id);
    if (!p) return ack({ error: "Rejoignez d'abord le salon vocal." });
    p.cam = !!on; p.camId = p.cam ? String(streamId || "").slice(0, 80) : null; announceVideo(p);
    ack({ ok: true });
  }));
  function announceVideo(p) {
    socket.to("voice:" + voiceChan).emit("voicePeerState", { socketId: socket.id, screen: p.screen, cam: p.cam, screenId: p.screenId, camId: p.camId });
    const c = q.channel.get(voiceChan); if (c) broadcastRoster(c);
  }
  socket.on("voiceLeave", guard(() => leaveVoice()));

  socket.on("disconnect", () => {
    leaveVoice();
    const set = online.get(uid);
    if (set) { set.delete(socket.id); if (!set.size) online.delete(uid); }
    const u = cur(); if (u) broadcastPresence(u);
  });
});

/* ---------- Administration (/api/admin) : modérateurs et administrateur ---------- */
const admin = express.Router();
const logAction = db.prepare("INSERT INTO admin_log (ts, admin_id, action, target) VALUES (?, ?, ?, ?)");
const delSessionsOf = db.prepare("DELETE FROM sessions WHERE user_id = ?");
const count = (sql, ...a) => db.prepare(sql).get(...a).n;
function audit(req, action, target) { logAction.run(Date.now(), req.admin.id, (req.admin.role === "mod" ? "[Modérateur] " : "") + action, String(target).slice(0, 200)); }
function requireAdmin(req, res, next) {
  if (req.admin.role !== "admin") return res.status(403).json({ error: "Réservé à l'administrateur." });
  next();
}
function targetUser(req, res) {
  const u = q.userById.get(Number(req.params.id));
  if (!u) { res.status(404).json({ error: "Utilisateur introuvable." }); return null; }
  if (u.role === "admin" || u.role === "bot") { res.status(400).json({ error: "Impossible d'agir sur ce compte." }); return null; }
  if (u.role === "mod" && req.admin.role !== "admin") { res.status(403).json({ error: "Seul l'administrateur peut agir sur un modérateur." }); return null; }
  return u;
}
function cutOff(userId) { delSessionsOf.run(userId); io.in("user:" + userId).disconnectSockets(true); }

admin.use((req, res, next) => {
  const u = authBearer(req);
  if (!u || !isStaff(u)) return res.status(403).json({ error: "Accès réservé à l'équipe de modération." });
  req.admin = u; next();
});

admin.get("/me", (req, res) => res.json({ id: req.admin.id, name: req.admin.name, role: req.admin.role }));

admin.get("/stats", (req, res) => res.json({
  users: count("SELECT COUNT(*) AS n FROM users WHERE role != 'bot'"), online: online.size, banned: count("SELECT COUNT(*) AS n FROM users WHERE banned = 1"),
  servers: count("SELECT COUNT(*) AS n FROM servers WHERE name != '__dm__'"), channels: count("SELECT COUNT(*) AS n FROM channels WHERE kind IN ('text', 'voice')"),
  messages: count("SELECT COUNT(*) AS n FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.kind != 'dm'"),
  messages24h: count("SELECT COUNT(*) AS n FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.kind != 'dm' AND m.ts > ?", Date.now() - 864e5),
  reportsOpen: count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
}));

admin.get("/users", (req, res) => {
  const term = "%" + clean(req.query.q, 30).replace(/[\\%_]/g, "\\$&") + "%";
  const rows = db.prepare(`SELECT u.id, u.name, u.role, u.banned, u.created,
      (SELECT COUNT(*) FROM messages WHERE user_id = u.id) AS messages, (SELECT COUNT(*) FROM members WHERE user_id = u.id) AS servers
    FROM users u WHERE u.role != 'bot' AND u.name LIKE ? ESCAPE '\\' ORDER BY u.created DESC LIMIT 200`).all(term);
  res.json(rows.map((r) => ({ ...r, banned: !!r.banned, online: isOnline(r.id) })));
});

admin.post("/users/:id/ban", (req, res) => {
  const u = targetUser(req, res); if (!u) return;
  const ban = req.body.banned !== false;
  db.prepare("UPDATE users SET banned = ? WHERE id = ?").run(ban ? 1 : 0, u.id);
  if (ban) { cutOff(u.id); db.prepare("DELETE FROM push_subs WHERE user_id = ?").run(u.id); }
  audit(req, ban ? "Suspension" : "Réactivation", u.name); res.json({ ok: true });
});

admin.post("/users/:id/kick", (req, res) => {
  const u = targetUser(req, res); if (!u) return;
  cutOff(u.id); audit(req, "Déconnexion forcée", u.name); res.json({ ok: true });
});

admin.post("/users/:id/role", requireAdmin, (req, res) => {
  const u = targetUser(req, res); if (!u) return;
  const role = req.body.role === "mod" ? "mod" : "user";
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, u.id);
  if (role === "mod") io.in("user:" + u.id).socketsJoin("staff"); else io.in("user:" + u.id).socketsLeave("staff");
  io.to("user:" + u.id).emit("roleChanged", { role });
  audit(req, role === "mod" ? "Nommé modérateur" : "Modérateur retiré", u.name); res.json({ ok: true });
});

admin.post("/users/:id/reset-password", requireAdmin, (req, res) => {
  const u = targetUser(req, res); if (!u) return;
  const temp = crypto.randomBytes(7).toString("base64url"), salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").run(salt, hashPassword(temp, salt), u.id);
  cutOff(u.id); audit(req, "Mot de passe réinitialisé", u.name); res.json({ password: temp });
});

admin.delete("/users/:id", requireAdmin, (req, res) => {
  const u = targetUser(req, res); if (!u) return;
  const rooms = q.serversOf.all(u.id).map((s) => "srv:" + s.id);
  io.in("user:" + u.id).disconnectSockets(true);
  db.prepare("SELECT m.id FROM messages m WHERE m.user_id = ?").all(u.id).forEach((m) => removeFiles(m.id));
  tx(() => { db.prepare("UPDATE servers SET owner_id = NULL WHERE owner_id = ?").run(u.id); db.prepare("DELETE FROM users WHERE id = ?").run(u.id); });
  rooms.forEach((r) => io.to(r).emit("userDeleted", { userId: u.id }));
  audit(req, "Compte supprimé", u.name); res.json({ ok: true });
});

admin.get("/servers", requireAdmin, (req, res) => res.json(db.prepare(`SELECT s.id, s.name, s.code, s.partner, s.partner_logo AS logo, o.name AS owner,
    (SELECT COUNT(*) FROM members WHERE server_id = s.id) AS members, (SELECT COUNT(*) FROM channels WHERE server_id = s.id) AS channels,
    (SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.server_id = s.id) AS messages
  FROM servers s LEFT JOIN users o ON o.id = s.owner_id WHERE s.name != '__dm__' ORDER BY s.id`).all().map((s) => ({ ...s, isDefault: s.id === DEFAULT_SERVER }))));

/* ---------- Sauvegardes : réservé à l'administrateur ---------- */
let backupBusy = false;
const dirSize = (dir, re) => { let count = 0, size = 0; try { fs.readdirSync(dir).forEach((n) => { if (!re || re.test(n)) { count++; size += fs.statSync(path.join(dir, n)).size; } }); } catch (e) { /* dossier absent */ } return { count, size }; };
const fileSize = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
admin.get("/backup/info", requireAdmin, (req, res) => {
  res.json({
    db: fileSize(DB_PATH), uploads: dirSize(UPLOAD_DIR, /^[0-9a-f]{32}$/), backups: backup.listSnapshots(BACKUP_DIR), maxMb: BACKUP_MAX / 1048576,
    // Sur Render (offre gratuite) le disque est effacé à chaque redémarrage, sauf s'il est monté sur /var/data
    ephemeral: !!process.env.RENDER && !DB_PATH.startsWith("/var/data"), beforeRestore: fs.existsSync(DB_PATH + ".before-restore"),
  });
});
const sendDownload = (res, name, type) => { res.setHeader("Content-Type", type); res.setHeader("Content-Disposition", 'attachment; filename="' + name + '"'); res.setHeader("Cache-Control", "no-store"); };
admin.get("/backup/full", requireAdmin, async (req, res) => {
  if (backupBusy) return res.status(409).json({ error: "Une opération de sauvegarde est déjà en cours." });
  backupBusy = true; const tmp = path.join(BACKUP_DIR, ".export-" + process.pid + ".db");
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true }); fs.rmSync(tmp, { force: true });
    const entries = backup.archiveEntries(db, UPLOAD_DIR, tmp);
    sendDownload(res, "cordial-sauvegarde-" + backup.stamp() + ".tar", "application/x-tar");
    await backup.writeTar(entries, res); res.end(); audit(req, "Sauvegarde complète téléchargée", entries.length - 1 + " fichier(s)");
  } catch (e) { console.error("Sauvegarde :", e.message); if (!res.headersSent) res.status(500).json({ error: "Sauvegarde impossible : " + e.message }); else res.destroy(); }
  finally { fs.rmSync(tmp, { force: true }); backupBusy = false; }
});
admin.get("/backup/db", requireAdmin, (req, res) => {
  const tmp = path.join(BACKUP_DIR, ".export-" + process.pid + "-db.db");
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true }); fs.rmSync(tmp, { force: true }); backup.snapshot(db, tmp);
    sendDownload(res, "cordial-base-" + backup.stamp() + ".db", "application/octet-stream");
    res.sendFile(tmp, { dotfiles: "allow" }, (err) => { fs.rmSync(tmp, { force: true }); if (err && !res.headersSent) res.status(500).end(); });
    audit(req, "Base téléchargée", "base seule");
  } catch (e) { fs.rmSync(tmp, { force: true }); res.status(500).json({ error: "Sauvegarde impossible : " + e.message }); }
});
admin.post("/backup/create", requireAdmin, (req, res) => {
  try { const name = backup.takeSnapshot(db, BACKUP_DIR, "manuel"); audit(req, "Instantané de la base créé", name); res.json({ ok: true, name }); }
  catch (e) { res.status(500).json({ error: "Instantané impossible : " + e.message }); }
});
admin.get("/backup/file/:name", requireAdmin, (req, res) => {
  if (!backup.SNAP_RE.test(req.params.name)) return res.status(404).json({ error: "Instantané introuvable." });
  const f = path.join(BACKUP_DIR, req.params.name); if (!fs.existsSync(f)) return res.status(404).json({ error: "Instantané introuvable." });
  sendDownload(res, req.params.name, "application/octet-stream"); res.sendFile(f);
});
// La restauration est préparée et vérifiée ici, puis appliquée au redémarrage du serveur (la base ouverte n'est jamais remplacée à chaud)
function finishRestore(req, res, what, info) {
  audit(req, "Restauration préparée", what);
  res.json({ ok: true, restart: true, uploads: info.uploads });
  res.on("finish", () => setTimeout(() => { try { db.close(); } catch (e) { /* déjà fermée */ } console.log("Redémarrage pour restaurer une sauvegarde."); process.exit(0); }, 500));
}
const confirmed = (req) => req.get("X-Confirm") === "RESTAURER";
admin.post("/backup/restore", requireAdmin, (req, res) => {
  if (!confirmed(req)) return res.status(400).json({ error: "Confirmation manquante." });
  if (backupBusy) return res.status(409).json({ error: "Une opération de sauvegarde est déjà en cours." });
  backupBusy = true; fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tmp = path.join(BACKUP_DIR, ".upload-" + process.pid), out = fs.createWriteStream(tmp); let size = 0, aborted = false;
  const done = (fn) => { backupBusy = false; out.destroy(); fs.rmSync(tmp, { force: true }); fn && fn(); };
  req.on("data", (c) => { size += c.length; if (size > BACKUP_MAX && !aborted) { aborted = true; req.unpipe(out); done(() => res.status(413).json({ error: "Fichier trop gros (" + BACKUP_MAX / 1048576 + " Mo maximum)." })); } });
  req.on("error", () => done());
  req.pipe(out);
  out.on("finish", () => {
    if (aborted) return;
    try { const info = backup.stageRestore(tmp, DB_PATH, {}); done(); finishRestore(req, res, "fichier envoyé", info); }
    catch (e) { done(() => res.status(400).json({ error: e.message })); }
  });
});
admin.post("/backup/restore/:name", requireAdmin, (req, res) => {
  if (!confirmed(req)) return res.status(400).json({ error: "Confirmation manquante." });
  if (!backup.SNAP_RE.test(req.params.name) || !fs.existsSync(path.join(BACKUP_DIR, req.params.name))) return res.status(404).json({ error: "Instantané introuvable." });
  try { const info = backup.stageRestore(path.join(BACKUP_DIR, req.params.name), DB_PATH, {}); finishRestore(req, res, req.params.name, info); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

/* Serveurs partenaires : badge « Partenaire » et logo affiché devant le nom, pour tous les membres */
const partnerPublic = (s) => ({ serverId: s.id, owner: s.owner_id, name: s.name, abbr: s.abbr, icon: s.icon, banner: s.banner, partner: !!s.partner, logo: s.partner ? s.partner_logo : null });
const partnerTarget = (req, res) => {
  const s = q.serverById.get(Number(req.params.id));
  if (!s || s.id === DM_SERVER) { res.status(404).json({ error: "Serveur introuvable." }); return null; }
  return s;
};
const partnerChanged = (id) => io.to("srv:" + id).emit("serverUpdated", partnerPublic(q.serverById.get(id)));
admin.post("/servers/:id/partner", requireAdmin, (req, res) => {
  const s = partnerTarget(req, res); if (!s) return;
  const on = req.body && req.body.partner ? 1 : 0;
  db.prepare("UPDATE servers SET partner = ? WHERE id = ?").run(on, s.id);
  partnerChanged(s.id); audit(req, on ? "Serveur partenaire" : "Partenariat retiré", s.name); res.json({ ok: true });
});
admin.post("/servers/:id/logo", requireAdmin, express.raw({ type: () => true, limit: 1024 * 1024 }), (req, res) => {
  const s = partnerTarget(req, res); if (!s) return;
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Image vide ou trop lourde (1 Mo maximum)." });
  const ext = IMG_EXT.find((e) => FILE_TYPES[e].ok(buf));
  if (!ext) return res.status(415).json({ error: "Format non accepté (PNG, JPG, GIF ou WebP)." });
  const id = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
  db.prepare("INSERT INTO files (id, user_id, name, mime, size, ts, purpose) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, req.admin.id, "logo." + ext, FILE_TYPES[ext].mime, buf.length, Date.now(), "logo");
  const old = s.partner_logo; db.prepare("UPDATE servers SET partner_logo = ? WHERE id = ?").run(id, s.id); dropProfileImage(old);
  partnerChanged(s.id); audit(req, "Logo de partenaire modifié", s.name); res.json({ ok: true });
});
admin.delete("/servers/:id/logo", requireAdmin, (req, res) => {
  const s = partnerTarget(req, res); if (!s) return;
  db.prepare("UPDATE servers SET partner_logo = NULL WHERE id = ?").run(s.id); dropProfileImage(s.partner_logo);
  partnerChanged(s.id); audit(req, "Logo de partenaire retiré", s.name); res.json({ ok: true });
});

admin.delete("/servers/:id", requireAdmin, (req, res) => {
  const s = q.serverById.get(Number(req.params.id));
  if (!s || s.id === DM_SERVER) return res.status(404).json({ error: "Serveur introuvable." });
  if (s.id === DEFAULT_SERVER) return res.status(400).json({ error: "Le serveur par défaut ne peut pas être supprimé." });
  destroyServer(s);
  audit(req, "Serveur supprimé", s.name); res.json({ ok: true });
});

// Les messages privés ne sont jamais consultables ici : seuls ceux qui ont été signalés apparaissent dans les signalements
admin.get("/messages", (req, res) => {
  const term = "%" + clean(req.query.q, 50).replace(/[\\%_]/g, "\\$&") + "%";
  res.json(db.prepare(`SELECT m.id, m.text, m.ts, u.name AS user, c.name AS channel, s.name AS server
    FROM messages m JOIN users u ON u.id = m.user_id JOIN channels c ON c.id = m.channel_id JOIN servers s ON s.id = c.server_id
    WHERE c.kind != 'dm' AND (m.text LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\') ORDER BY m.id DESC LIMIT 100`).all(term, term));
});

admin.delete("/messages/:id", (req, res) => {
  const m = q.message.get(Number(req.params.id));
  if (!m) return res.status(404).json({ error: "Message introuvable." });
  const c = q.channel.get(m.channel_id);
  if (c.kind === "dm" && !q.reportOfMessage.get(m.id)) return res.status(403).json({ error: "Les messages privés ne peuvent être supprimés que s'ils ont été signalés." });
  const rooms = roomsOf(c); deleteMessageRow(m.id, true);
  io.to(rooms).emit("deleted", { id: m.id, channelId: m.channel_id });
  audit(req, "Message supprimé", m.name + " : " + m.text.slice(0, 60)); res.json({ ok: true });
});

admin.get("/reports", (req, res) => res.json(db.prepare(
  `SELECT r.id, r.message_id, r.author_id, r.author_name, r.text, r.place, r.reason, r.ts, r.status, u.name AS reporter
   FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE (? = 'all' OR r.status = 'open') ORDER BY r.id DESC LIMIT 100`).all(req.query.status === "all" ? "all" : "open")
  .map((r) => ({ ...r, messageExists: !!(r.message_id && q.message.get(r.message_id)) }))));

admin.post("/reports/:id/resolve", (req, res) => {
  const r = db.prepare("SELECT * FROM reports WHERE id = ?").get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: "Signalement introuvable." });
  db.prepare("UPDATE reports SET status = 'done' WHERE id = ?").run(r.id);
  audit(req, "Signalement classé", r.author_name + " : " + r.text.slice(0, 60)); res.json({ ok: true });
});

admin.post("/announce", requireAdmin, (req, res) => {
  const text = clean(req.body.text, 300);
  if (!text) return res.status(400).json({ error: "Annonce vide." });
  io.emit("announce", { text, ts: Date.now() });
  audit(req, "Annonce", text); res.json({ ok: true, delivered: io.engine.clientsCount });
});

admin.get("/log", requireAdmin, (req, res) => res.json(db.prepare(
  "SELECT l.id, l.ts, l.action, l.target, u.name AS admin FROM admin_log l LEFT JOIN users u ON u.id = l.admin_id ORDER BY l.id DESC LIMIT 100").all()));

app.use("/api/admin", admin);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.too.large" || err.status === 413) return res.status(413).json({ error: "Fichier trop volumineux (8 Mo maximum)." });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Requête invalide." });
  console.error(err); res.status(500).json({ error: "Erreur serveur." });
});

backup.startAutoBackups(db, BACKUP_DIR);
server.listen(PORT, () => {
  console.log("Cordial démarré sur http://localhost:" + PORT);
  const found = db.prepare("SELECT name FROM users WHERE role = 'admin'").all().map((r) => r.name);
  if (found.length) console.log("Administrateur(s) : " + found.join(", ") + " → panneau sur /admin");
  else console.log("Aucun compte admin. Pour créer « " + ADMIN_NAMES[0] + " », inscrivez-vous avec ce pseudo et le code : " + SETUP_CODE);
});
