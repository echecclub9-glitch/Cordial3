// Cordial — application de bureau (Electron). Affiche votre serveur Cordial dans une fenêtre dédiée.
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, session, nativeImage, systemPreferences, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");

const isMac = process.platform === "darwin";
let win = null, tray = null, quitting = false, unread = 0;

/* ---------- Adresse du serveur ---------- */
const userConfig = () => path.join(app.getPath("userData"), "config.json");
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return {}; } };
// "chat.exemple.fr" devient "https://chat.exemple.fr" ; seul http(s) est accepté
function normalize(input) {
  let s = String(input || "").trim(); if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname ? u.origin : null; } catch (e) { return null; }
}
const serverUrl = () => normalize(readJson(userConfig()).url) || normalize(readJson(path.join(__dirname, "config.json")).serverUrl);
const sameOrigin = (u) => { try { return new URL(u).origin === serverUrl(); } catch (e) { return false; } };
const isLocalPage = (frame) => !!frame && /^file:/.test(frame.url);

/* ---------- Fenêtre ---------- */
function load() {
  if (!win) return;
  const url = serverUrl();
  if (url) win.loadURL(url + "/app"); else win.loadFile(path.join(__dirname, "setup.html"));
}
function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function changeServer() {
  showWindow();
  win.loadFile(path.join(__dirname, "setup.html"), { query: { url: serverUrl() || "" } });
}
function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 360, minHeight: 500, show: false, autoHideMenuBar: true,
    backgroundColor: "#0b0828", title: "Cordial", icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.once("ready-to-show", () => win.show());
  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'application
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (/^file:/.test(url) || sameOrigin(url)) return;
    e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 : chargement annulé volontairement
    win.loadFile(path.join(__dirname, "offline.html"), { query: { url: serverUrl() || "", err: desc } });
  });
  // Le titre de la page contient le nombre de messages non lus : « (3) Cordial »
  win.webContents.on("page-title-updated", (e, title) => {
    const m = /^\((\d+)\)/.exec(title), n = m ? Number(m[1]) : 0;
    if (n > unread && !win.isFocused()) win.flashFrame(true);
    unread = n; app.setBadgeCount(n);
    if (tray) tray.setToolTip(n ? "Cordial (" + n + " non lu" + (n > 1 ? "s" : "") + ")" : "Cordial");
  });
  win.on("focus", () => win.flashFrame(false));
  // Fermer la fenêtre la masque : le vocal et les notifications continuent de fonctionner
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on("closed", () => { win = null; });
  load();
}

/* ---------- Zone de notification et menus ---------- */
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png")).resize({ width: 18, height: 18 });
  tray = new Tray(icon); tray.setToolTip("Cordial");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ouvrir Cordial", click: showWindow },
    { label: "Changer de serveur…", click: changeServer },
    { type: "separator" },
    { label: "Quitter", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", showWindow);
}
function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "Cordial", submenu: [
      { label: "Recharger", accelerator: "CmdOrCtrl+R", click: () => win && win.reload() },
      { label: "Changer de serveur…", click: changeServer },
      ...(isMac ? [] : [{ type: "separator" }, { label: "Quitter", click: () => { quitting = true; app.quit(); } }]),
    ] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
}

/* ---------- Autorisations : micro et notifications pour le serveur Cordial uniquement ---------- */
function setupPermissions() {
  const allowed = new Set(["media", "notifications", "clipboard-sanitized-write", "fullscreen", "display-capture"]);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = allowed.has(permission) && sameOrigin(details.requestingUrl);
    if (ok && permission === "media" && isMac) { systemPreferences.askForMediaAccess("microphone").then(callback, () => callback(false)); return; }
    callback(ok);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && sameOrigin(origin));
}

/* ---------- Partage d'écran : la page choisit une source, puis getDisplayMedia() la reçoit ---------- */
let chosenSource = null;
function setupScreenShare() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!sameOrigin(request.securityOrigin) || !chosenSource) return callback({});
    desktopCapturer.getSources({ types: ["screen", "window"] }).then((list) => {
      const src = list.find((x) => x.id === chosenSource); chosenSource = null;
      if (!src) return callback({});
      // Le son du système n'est partagé que sous Windows
      callback(process.platform === "win32" ? { video: src, audio: "loopback" } : { video: src });
    }, () => callback({}));
  });
}
const fromServerPage = (e) => { try { return sameOrigin(e.senderFrame.url); } catch (err) { return false; } };
ipcMain.handle("screen-sources", async (e) => {
  if (!fromServerPage(e)) return [];
  const list = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
  return list.filter((x) => x.name !== "Cordial").map((x) => ({ id: x.id, name: x.name || "Écran", thumb: x.thumbnail.toDataURL() }));
});
ipcMain.handle("select-screen", (e, id) => { if (fromServerPage(e) && typeof id === "string") chosenSource = id; });

/* ---------- Échanges avec les pages ---------- */
ipcMain.on("focus", () => showWindow());
ipcMain.on("retry", (e) => { if (isLocalPage(e.senderFrame)) load(); });
ipcMain.on("change-server", (e) => { if (isLocalPage(e.senderFrame)) changeServer(); });
ipcMain.handle("save-server", async (e, input) => {
  if (!isLocalPage(e.senderFrame)) return { error: "Action non autorisée." };
  const url = normalize(input);
  if (!url) return { error: "Adresse invalide. Exemple : https://chat.monsite.fr" };
  try {
    const r = await fetch(url + "/api/config", { signal: AbortSignal.timeout(7000) });
    const d = await r.json();
    if (d.app !== "cordial") throw new Error("autre serveur");
  } catch (err) { return { error: "Aucun serveur Cordial ne répond à cette adresse. Vérifiez-la et votre connexion." }; }
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(userConfig(), JSON.stringify({ url }, null, 2));
  setImmediate(load);
  return { ok: true };
});

/* ---------- Démarrage ---------- */
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showWindow);
  app.on("before-quit", () => { quitting = true; });
  app.on("window-all-closed", () => { /* l'application reste dans la zone de notification */ });
  app.on("activate", showWindow);
  app.whenReady().then(() => { setupPermissions(); setupScreenShare(); createMenu(); createTray(); createWindow(); });
}
