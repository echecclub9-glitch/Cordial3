(function () {
  "use strict";
  const COLORS = ["#5865f2", "#eb459e", "#3ba55d", "#e67e22", "#1abc9c", "#9b59b6", "#e74c3c", "#3498db"];
  const EMOJIS = ["😀", "😂", "😍", "🤔", "😎", "🔥", "👍", "🎉", "❤️", "👀", "🙏", "💯"];
  const QUICK = ["👍", "❤️", "😂"];
  const STATUSES = ["on", "idle", "dnd", "invisible"];
  const LABEL = { on: "En ligne", idle: "Absent", dnd: "Ne pas déranger", invisible: "Invisible", off: "Hors ligne" };
  const COMMANDS = [
    { c: "/aide", d: "Affiche la liste des commandes" },
    { c: "/de", d: "Lance un dé : /de 20 ou /de 2d6" },
    { c: "/pile", d: "Pile ou face" },
    { c: "/choix", d: "Tire une option au hasard : /choix a | b | c" },
    { c: "/sondage", d: "Crée un sondage : /sondage Question | Option 1 | Option 2" },
  ];
  const SLOW = [[0, "Désactivé"], [5, "5 secondes"], [10, "10 secondes"], [30, "30 secondes"], [60, "1 minute"], [300, "5 minutes"], [900, "15 minutes"], [3600, "1 heure"]];
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  const S = {
    token: null, sock: null, me: null, ice: [], servers: [], dms: [], view: "server", sid: null, cid: null,
    msgs: {}, more: {}, members: {}, unread: {}, ephemeral: {}, cool: {}, reply: null, editing: null, pending: null,
    prof: {}, roles: {}, panel: null, pendingTitle: 0, typingTimer: null, lastTyping: 0, push: false, cmdIdx: 0,
  };
  const V = { screen: null, tiles: new Map(), cid: null, sid: null, stream: null, muted: false, peers: new Map(), ice: [], timer: null, ctx: null, local: null };

  /* ---------- Outils ---------- */
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  let toastT;
  function toast(t) { const e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { e.hidden = true; }, 3800); }
  const color = (u) => COLORS[u.color % COLORS.length];
  const hhmm = (t) => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  function fmt(t) {
    const d = new Date(t), diff = Math.round((new Date(new Date().toDateString()) - new Date(d.toDateString())) / 864e5);
    return (diff === 0 ? "Aujourd'hui à " : diff === 1 ? "Hier à " : d.toLocaleDateString("fr-FR") + " ") + hhmm(t);
  }
  const fmtSize = (n) => (n < 1024 ? n + " o" : n < 1048576 ? Math.round(n / 1024) + " Ko" : (n / 1048576).toFixed(1).replace(".", ",") + " Mo");
  const isStaff = () => !!S.me && (S.me.role === "admin" || S.me.role === "mod");
  const server = () => S.servers.find((s) => s.id === S.sid);
  const dmOf = (id) => S.dms.find((d) => d.id === id);
  const firstText = (s) => { const c = s && s.channels.find((x) => x.kind === "text"); return c ? c.id : null; };
  function channel() {
    if (S.view === "dm") { const d = dmOf(S.cid); return d ? { id: d.id, name: d.other.name, topic: "", kind: "dm", slowmode: 0, readonly: false } : null; }
    const s = server(); return (s && s.channels.find((c) => c.id === S.cid && c.kind === "text")) || null;
  }
  function privileged() {
    const c = channel(); if (!c || c.kind === "dm") return false;
    if (isStaff()) return true;
    const s = server(); return !!s && s.owner === S.me.id;
  }
  const live = (u) => S.prof[u.id] || u;
  function avatar(u, status) {
    const f = live(u).avatar, a = el("div", "av" + (f ? " img" : ""), f ? "" : u.name[0].toUpperCase()); a.style.background = color(u);
    if (f) a.style.backgroundImage = "url(/files/" + f + ")";
    if (status) a.appendChild(el("i", "s-" + status));
    return a;
  }
  function tagFor(role) {
    if (role === "admin") return el("span", "tag", "ADMIN");
    if (role === "mod") return el("span", "tag mod", "MOD");
    if (role === "bot") return el("span", "tag bot", "BOT");
    return null;
  }
  function updateTitle() {
    const n = Object.keys(S.unread).reduce((a, k) => a + S.unread[k], 0) + S.pendingTitle;
    document.title = (n ? "(" + n + ") " : "") + "Cordial";
  }

  /* ---------- Connexion ---------- */
  let mode = "in";
  function setMode(m) {
    mode = m; $("tabIn").classList.toggle("on", m === "in"); $("tabUp").classList.toggle("on", m === "up");
    $("aGo").textContent = m === "in" ? "Se connecter" : "Créer mon compte";
    $("aPass").autocomplete = m === "in" ? "current-password" : "new-password"; $("aErr").textContent = "";
  }
  $("tabIn").onclick = () => setMode("in"); $("tabUp").onclick = () => setMode("up");
  $("authForm").onsubmit = (e) => {
    e.preventDefault(); const btn = $("aGo"); btn.disabled = true; $("aErr").textContent = "";
    fetch("/api/" + (mode === "in" ? "login" : "register"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("aName").value, password: $("aPass").value, setupCode: $("aCode").value }) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then((r) => {
        btn.disabled = false;
        if (!r.ok) { if (r.d.needCode) { $("aCodeWrap").hidden = false; $("aCode").focus(); } $("aErr").textContent = r.d.error || "Erreur."; return; }
        store("cordial-token", r.d.token); $("aPass").value = ""; connect(r.d.token);
      })
      .catch(() => { btn.disabled = false; $("aErr").textContent = "Serveur injoignable."; });
  };
  function showAuth() { $("app").hidden = true; $("auth").hidden = false; $("aName").focus(); }
  async function logout() {
    const t = S.token; leaveVoice(); await disablePush(true);
    if (S.sock) S.sock.disconnect();
    if (t) fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t }) }).catch(() => {});
    store("cordial-token", null);
    Object.assign(S, { token: null, sock: null, me: null, servers: [], dms: [], view: "server", sid: null, cid: null, msgs: {}, more: {}, members: {}, unread: {}, ephemeral: {}, cool: {}, reply: null, editing: null, pending: null, panel: null });
    showAuth();
  }
  $("bOut").onclick = logout;

  /* ---------- Socket ---------- */
  function connect(token) {
    if (S.sock) S.sock.disconnect();
    S.token = token;
    const sock = io({ auth: { token } }); S.sock = sock;
    sock.on("connect", () => { $("banner").hidden = true; sock.emit("visibility", { visible: !document.hidden }); });
    sock.on("disconnect", () => { $("banner").hidden = false; leaveVoice(true); });
    sock.on("connect_error", (err) => { if (err.message === "auth") { store("cordial-token", null); S.token = null; sock.disconnect(); showAuth(); } else $("banner").hidden = false; });
    sock.on("ready", onReady);
    sock.on("message", onMessage);
    sock.on("edited", (d) => patch(d.channelId, d.id, (m) => { m.text = d.text; m.edited = d.edited; }));
    sock.on("pinned", (d) => { patch(d.channelId, d.id, (m) => { m.pinned = d.pinned; }); if (S.panel === "pins" && d.channelId === S.cid) loadPins(); });
    sock.on("reactions", (d) => patch(d.channelId, d.id, (m) => { m.reactions = d.reactions; m.poll = d.poll; }));
    sock.on("deleted", (d) => { if (S.msgs[d.channelId]) { S.msgs[d.channelId] = S.msgs[d.channelId].filter((m) => m.id !== d.id); if (d.channelId === S.cid) renderMsgs(); } });
    sock.on("presence", onPresence); sock.on("profile", onProfile);
    sock.on("membersChanged", (d) => loadMembers(d.serverId));
    sock.on("rolesChanged", (d) => { loadRoles(d.serverId); loadMembers(d.serverId); });
    sock.on("kicked", (d) => {
      onServerDeleted({ serverId: d.serverId });
      if (d.banned) toast("Vous avez été banni de « " + d.name + " » " + (d.until ? "jusqu'au " + WHEN(d.until) : "définitivement") + (d.reason ? " — " + d.reason : "") + ".");
      else toast("Vous avez été expulsé de « " + d.name + " »." + (d.reason ? " Motif : " + d.reason : ""));
    });
    sock.on("channelsChanged", (d) => refreshChannels(d.serverId));
    sock.on("forceVoiceLeave", (d) => { if (V.sid === d.serverId) leaveVoice(); });
    sock.on("sanction", (d) => {
      loadRoles(d.serverId);
      if (d.type === "warn") { const m = modal({ title: "Avertissement", sub: "Un modérateur de « " + d.server + " » vous adresse un avertissement.", buttons: [{ label: "J'ai compris", run: (mm) => mm.close() }] }); m.card.insertBefore(el("div", "warnbox", d.reason), m.err); }
      else if (d.type === "mute") toast("Vous êtes en sourdine sur « " + d.server + " » jusqu'à " + WHEN(d.until) + (d.reason ? " — " + d.reason : "") + ".");
      else if (d.type === "unmute") toast("Votre sourdine sur « " + d.server + " » a été levée.");
    });
    sock.on("channelCreated", (d) => { const s = S.servers.find((x) => x.id === d.serverId); if (s && !s.channels.some((c) => c.id === d.channel.id)) s.channels.push(d.channel); renderSide(); });
    sock.on("channelUpdated", (d) => { const s = S.servers.find((x) => x.id === d.serverId); if (!s) return; s.channels = s.channels.map((c) => (c.id === d.channel.id ? d.channel : c)); renderAll(); });
    sock.on("channelDeleted", onChannelDeleted);
    sock.on("serverDeleted", onServerDeleted);
    sock.on("userDeleted", (d) => { Object.keys(S.msgs).forEach((k) => { S.msgs[k] = S.msgs[k].filter((m) => m.user.id !== d.userId); }); loadMembers(S.sid); renderMsgs(); });
    sock.on("dmOpened", (d) => { if (!dmOf(d.id)) S.dms.push(d); renderSide(); renderRail(); });
    sock.on("roleChanged", (d) => { S.me.role = d.role; renderMe(); renderMsgs(); toast(d.role === "mod" ? "Vous êtes maintenant modérateur." : "Votre rôle de modérateur a été retiré."); });
    sock.on("announce", (d) => { const a = $("announce"); a.textContent = "📢 " + d.text; a.hidden = false; clearTimeout(S.annT); S.annT = setTimeout(() => { a.hidden = true; }, 45000); });
    sock.on("ephemeral", (d) => { (S.ephemeral[d.channelId] ||= []).push({ text: d.text, ts: Date.now() }); if (d.channelId === S.cid) renderMsgs(true); });
    sock.on("typing", (d) => {
      if (d.channelId !== S.cid) return;
      $("typing").textContent = d.name + " est en train d'écrire…";
      clearTimeout(S.typingTimer); S.typingTimer = setTimeout(() => { $("typing").textContent = ""; }, 3000);
    });
    sock.on("voiceRoster", (d) => { const s = S.servers.find((x) => x.id === d.serverId), c = s && s.channels.find((x) => x.id === d.channelId); if (c) { c.voice = d.users; renderSide(); } });
    sock.on("voicePeerJoined", (d) => { if (V.cid === d.channelId && V.stream) makePeer(d.socketId, d.user, false); });
    sock.on("voicePeerLeft", (d) => dropPeer(d.socketId));
    sock.on("voicePeerState", (d) => onPeerVideo(d.socketId, d));
    sock.on("voiceSignal", onSignal);
    sock.on("voiceEnded", (d) => { if (V.cid === d.channelId) { leaveVoice(true); toast("Le salon vocal a été supprimé."); } });
  }
  function patch(cid, id, fn) { const l = S.msgs[cid]; if (!l) return; l.forEach((m) => { if (m.id === id) fn(m); }); if (cid === S.cid) renderMsgs(); if (S.panel) renderPanelKeep(); }
  function onReady(d) {
    S.me = d.me; S.servers = d.servers; S.dms = d.dms; S.ice = d.ice;
    if (S.view === "dm") { if (!dmOf(S.cid)) S.cid = S.dms[0] ? S.dms[0].id : null; }
    else {
      if (!server()) { S.sid = S.servers[0] && S.servers[0].id; S.cid = null; }
      if (!channel() && server()) S.cid = firstText(server());
    }
    $("auth").hidden = true; $("app").hidden = false;
    S.servers.forEach((s) => loadMembers(s.id));
    S.msgs = {}; S.more = {};
    if (S.cid) loadHistory(S.cid);
    renderAll(); initPush();
  }
  const PERM = { MESSAGES: 1, CHANNELS: 2, ROLES: 4, KICK: 8, VIP: 16, BAN: 32, MUTE: 64 };
  const canMod = () => canIn(PERM.KICK) || canIn(PERM.BAN) || canIn(PERM.MUTE);
  function loadRoles(sid) {
    if (sid == null) return;
    S.sock.emit("roles", { serverId: sid }, (r) => {
      if (!r || !r.roles) return; S.roles[sid] = r;
      if (sid === S.sid && S.view === "server") renderAll();
      if (S.rolesRefresh) S.rolesRefresh();
    });
  }
  // Droit effectif dans le serveur affiché : propriétaire et équipe du site ont tout, les autres cumulent leurs rôles
  function canIn(flag) {
    const sv = server(); if (!sv) return false;
    return sv.owner === S.me.id || isStaff() || (((S.roles[sv.id] || {}).perms || 0) & flag) !== 0;
  }
  function loadMembers(sid) { if (sid == null) return; S.sock.emit("members", { serverId: sid }, (r) => { if (r && r.members) { S.members[sid] = r.members; if (sid === S.sid) renderMembers(); } }); }
  function loadHistory(cid, before) {
    S.sock.emit("history", { channelId: cid, before: before || null }, (r) => {
      if (!r || !r.messages) return;
      S.msgs[cid] = before ? r.messages.concat(S.msgs[cid] || []) : r.messages; S.more[cid] = r.more;
      if (cid !== S.cid) return;
      if (before) { const box = $("msgs"), h = box.scrollHeight; renderMsgs(false); box.scrollTop = box.scrollHeight - h; } else renderMsgs(true);
    });
  }
  function onMessage(m) {
    const mine = m.user.id === S.me.id;
    if (S.msgs[m.channelId]) S.msgs[m.channelId].push(m);
    if (m.channelId === S.cid) renderMsgs(true, true);
    else if (!mine) { S.unread[m.channelId] = (S.unread[m.channelId] || 0) + 1; renderSide(); renderRail(); updateTitle(); }
    if (document.hidden && !mine) { S.pendingTitle++; updateTitle(); }
    if (!mine) notifyLocal(m);
  }
  function onProfile(p) {
    S.prof[p.id] = p;
    if (p.id === S.me.id) Object.assign(S.me, { avatar: p.avatar, custom: p.custom });
    const box = $("msgs"), top = box ? box.scrollTop : 0;
    renderAll(); if (S.cid != null && S.msgs[S.cid]) { renderMsgs(false); box.scrollTop = top; }
  }
  function onPresence(p) {
    (S.members[p.serverId] || []).forEach((m) => { if (m.id === p.id) m.status = p.status; });
    S.dms.forEach((d) => { if (d.other.id === p.id) d.other.status = p.status; });
    if (p.serverId === S.sid) renderMembers();
    if (S.view === "dm") renderSide();
  }
  function onChannelDeleted(d) {
    const s = S.servers.find((x) => x.id === d.serverId); if (!s) return;
    s.channels = s.channels.filter((c) => c.id !== d.channelId); delete S.msgs[d.channelId]; delete S.unread[d.channelId];
    if (V.cid === d.channelId) leaveVoice(true);
    if (S.cid === d.channelId) go("server", s.id, firstText(s)); else renderAll();
  }
  // Visibilité des salons privés modifiée (rôle, réglage) : on recharge la liste propre à cette personne
  function refreshChannels(sid) {
    S.sock.emit("channels", { serverId: sid }, (r) => {
      const s = S.servers.find((x) => x.id === sid); if (!s || !r || !r.channels) return;
      s.channels = r.channels;
      if (V.cid && V.sid === sid && !s.channels.some((c) => c.id === V.cid)) leaveVoice(true);
      if (S.view === "server" && S.sid === sid && !s.channels.some((c) => c.id === S.cid && c.kind === "text")) go("server", sid, firstText(s)); else renderAll();
    });
  }
  function onServerDeleted(d) {
    S.servers = S.servers.filter((s) => s.id !== d.serverId);
    if (V.sid === d.serverId) leaveVoice(true);
    if (S.sid === d.serverId && S.view === "server") { S.sid = S.servers[0] && S.servers[0].id; go("server", S.sid, firstText(server())); toast("Ce serveur a été supprimé."); } else renderAll();
  }

  /* ---------- Navigation ---------- */
  function go(view, sid, cid) {
    S.view = view; if (sid != null) S.sid = sid; S.cid = cid;
    S.panel = null; S.reply = null; S.editing = null; S.ephemeral = {}; S.sel = null;
    if (cid != null) { delete S.unread[cid]; if (!S.msgs[cid] && S.sock) loadHistory(cid); }
    if (view === "server" && !S.members[S.sid]) loadMembers(S.sid);
    if (view === "server" && !S.roles[S.sid]) loadRoles(S.sid);
    closeDrawers(); $("typing").textContent = ""; renderAll(); updateTitle();
    if (!matchMedia("(max-width: 760px)").matches) $("inp").focus();
  }
  function closeDrawers() { $("app").classList.remove("nav", "mems"); $("mem").classList.remove("open"); }

  /* ---------- Rendu : colonnes ---------- */
  function renderRail() {
    const r = $("rail"); r.innerHTML = "";
    const n = S.dms.reduce((a, d) => a + (S.unread[d.id] || 0), 0);
    const home = icText(el("button", "srv home" + (S.view === "dm" ? " on" : "")), "message"); home.title = "Messages privés"; home.setAttribute("aria-label", "Messages privés");
    if (n) home.appendChild(el("span", "dot", String(n)));
    home.onclick = () => go("dm", null, dmOf(S.cid) ? S.cid : S.dms[0] ? S.dms[0].id : null);
    r.appendChild(home); r.appendChild(el("div", "sep"));
    S.servers.forEach((s) => {
      const b = el("button", "srv" + (S.view === "server" && s.id === S.sid ? " on" : ""), s.abbr); b.title = s.name; b.setAttribute("aria-label", s.name);
      const u = s.channels.reduce((a, c) => a + (S.unread[c.id] || 0), 0);
      if (u && !(S.view === "server" && s.id === S.sid)) b.appendChild(el("span", "dot", String(u)));
      b.onclick = () => go("server", s.id, firstText(s));
      r.appendChild(b);
    });
    const add = el("button", "srv add", "+"); add.title = "Créer ou rejoindre un serveur"; add.setAttribute("aria-label", "Créer ou rejoindre un serveur");
    add.onclick = serverModal; r.appendChild(add);
  }
  function renderSide() {
    const box = $("chs"); box.innerHTML = "";
    $("app").classList.toggle("dmview", S.view === "dm");
    if (S.view === "dm") {
      $("sName").textContent = "Messages privés"; $("bInvite").hidden = true; $("bRoles").hidden = true; $("bSanc").hidden = true;
      if (!S.dms.length) { box.appendChild(el("div", "emptyside", "Aucune conversation. Cliquez sur un membre d'un serveur, puis sur « Écrire à… » pour lui envoyer un message.")); return; }
      S.dms.forEach((d) => {
        const u = S.unread[d.id] || 0;
        const b = el("button", "dmrow" + (d.id === S.cid ? " on" : "") + (u ? " unread" : "")); b.appendChild(avatar(d.other, d.other.status)); b.appendChild(el("span", "", d.other.name));
        if (u && d.id !== S.cid) b.appendChild(el("span", "badge", String(u)));
        b.onclick = () => go("dm", null, d.id); box.appendChild(b);
      });
      return;
    }
    const s = server(); if (!s) { $("sName").textContent = ""; return; }
    $("sName").textContent = s.name; $("bInvite").hidden = false; $("bRoles").hidden = !canIn(PERM.ROLES); $("bSanc").hidden = !canMod();
    const canManage = canIn(PERM.CHANNELS);
    if (canManage) { const a = icText(el("button", "addch"), "plus", "Créer un salon"); a.onclick = channelCreateModal; box.appendChild(a); }
    const cats = []; s.channels.forEach((c) => { if (cats.indexOf(c.category) < 0) cats.push(c.category); });
    cats.forEach((cat) => {
      box.appendChild(el("div", "cat", cat));
      s.channels.filter((c) => c.category === cat).forEach((c) => {
        const row = el("div", "chrow"), voice = c.kind === "voice", u = S.unread[c.id] || 0;
        const b = el("button", "ch" + (!voice && c.id === S.cid ? " on" : "") + (u ? " unread" : ""));
        { const h = el("span", "hash"); if (c.private) { h.innerHTML = ic("lock", 16); h.title = "Salon privé"; } else if (voice) h.innerHTML = ic("volume", 18); else h.textContent = "#"; b.appendChild(h); } b.appendChild(el("span", "", c.name));
        if (u && c.id !== S.cid) b.appendChild(el("span", "badge", String(u)));
        else if (c.readonly) b.appendChild(el("span", "lock", "🔒"));
        else if (c.slowmode) { const sl = el("span", "lock", "🐢"); sl.title = "Mode lent"; b.appendChild(sl); }
        b.onclick = () => (voice ? joinVoice(c) : go("server", s.id, c.id));
        row.appendChild(b);
        if (canManage) { const g = icText(el("button", "gear"), "sliders"); g.title = "Réglages du salon"; g.setAttribute("aria-label", "Réglages du salon " + c.name); g.onclick = () => channelSettingsModal(c); row.appendChild(g); }
        box.appendChild(row);
        if (voice && c.voice && c.voice.length) {
          const vu = el("div", "vusers");
          c.voice.forEach((u2) => { const r = el("div", "vu"); r.dataset.uid = u2.id; r.appendChild(avatar(u2)); r.appendChild(el("span", "n", u2.name)); if (u2.cam) { const cm = icText(el("span", "camic"), "video"); cm.title = "Caméra allumée"; r.appendChild(cm); } if (u2.screen) r.appendChild(el("span", "live", "EN DIRECT")); if (u2.muted) r.appendChild(el("span", "mu", "🔇")); vu.appendChild(r); });
          box.appendChild(vu);
        }
      });
    });
    renderVoicePanel();
  }
  function renderMe() {
    const a = avatar(S.me, S.me.status === "invisible" ? "off" : S.me.status); a.id = "meAv"; $("meAv").replaceWith(a);
    $("meName").textContent = S.me.name; $("meSt").textContent = LABEL[S.me.status]; $("bAdmin").hidden = !isStaff();
    renderBell();
  }
  function renderMembers() {
    const m = $("mem"); m.innerHTML = ""; const list = S.members[S.sid] || [];
    const on = list.filter((x) => x.status !== "off"), off = list.filter((x) => x.status === "off");
    function group(t, l) {
      if (!l.length) return; m.appendChild(el("div", "cat", t + " — " + l.length));
      l.forEach((u) => {
        const r = el("button", "mb" + (u.status === "off" ? " off" : "")); r.appendChild(avatar(u, u.status));
        const w = el("span", "nmw"), nmEl = el("span", "nm", u.name); if (u.roleColor) nmEl.style.color = u.roleColor; w.appendChild(nmEl); const cs = live(u).custom; if (cs) { const c = el("span", "cs", cs); c.title = cs; w.appendChild(c); } r.appendChild(w);
        const tg = tagFor(u.role); if (tg) r.appendChild(tg);
        if (u.owner) { const c = el("span", "crown", "👑"); c.title = "Propriétaire"; r.appendChild(c); }
        r.onclick = (e) => userMenu(e, u); m.appendChild(r);
      });
    }
    group("En ligne", on); group("Hors ligne", off);
  }
  function renderTop() {
    const c = channel();
    $("tName").textContent = c ? (c.kind === "dm" ? "@ " : "# ") + c.name : "";
    $("tTopic").textContent = c ? c.topic : "";
    $("bSearch").hidden = $("bPins").hidden = !c;
    updateComposer();
  }
  function updateComposer() {
    const c = channel(), inp = $("inp"), box = $("form");
    const mutedUntil = c && c.kind !== "dm" ? ((S.roles[c.serverId || S.sid] || {}).mutedUntil || 0) : 0, muted = mutedUntil > Date.now();
    const ro = !c || (c.readonly && !privileged()) || muted;
    inp.disabled = ro; box.classList.toggle("off", ro); $("bMic").disabled = ro;
    const left = c && S.cool[c.id] ? Math.ceil((S.cool[c.id] - Date.now()) / 1000) : 0;
    inp.placeholder = !c ? "" : muted ? "Vous êtes en sourdine jusqu'à " + WHEN(mutedUntil) + "." : c.readonly && !privileged() ? "Ce salon est en lecture seule." : left > 0 ? "Mode lent : encore " + left + " s" : "Envoyer un message " + (c.kind === "dm" ? "à " + c.name : "dans #" + c.name);
  }
  setInterval(() => { const c = channel(); if (c && (S.cool[c.id] || ((S.roles[S.sid] || {}).mutedUntil || 0))) updateComposer(); }, 500);

  /* ---------- Rendu : messages ---------- */
  function richText(box, text) {
    const names = ((S.view === "dm" ? [] : S.members[S.sid]) || []).map((m) => "@" + m.name.toLowerCase());
    text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|https?:\/\/[^\s<]+|@[\p{L}\p{N}_-]+)/gu).forEach((part) => {
      if (!part) return;
      if (part[0] === "`" && part.length > 2) box.appendChild(el("code", "", part.slice(1, -1)));
      else if (part.startsWith("**") && part.length > 4) box.appendChild(el("strong", "", part.slice(2, -2)));
      else if (part[0] === "*" && part.length > 2) box.appendChild(el("em", "", part.slice(1, -1)));
      else if (/^https?:\/\//.test(part)) { const a = el("a", "", part); a.href = part; a.target = "_blank"; a.rel = "noopener noreferrer"; box.appendChild(a); }
      else if (part[0] === "@" && names.indexOf(part.toLowerCase()) > -1) box.appendChild(el("span", "mn", part));
      else box.appendChild(document.createTextNode(part));
    });
  }
  function fileNode(f) {
    const w = el("div", "att"), url = "/files/" + f.id;
    if (f.mime.startsWith("image/")) { const a = el("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; const i = el("img"); i.src = url; i.alt = f.name; i.loading = "lazy"; a.appendChild(i); w.appendChild(a); }
    else if (f.mime.startsWith("audio/") && /^vocal-\d+\./.test(f.name)) w.appendChild(voicePlayer(url, Number(f.name.match(/^vocal-(\d+)/)[1])));
    else if (f.mime.startsWith("audio/")) { const a = el("audio"); a.controls = true; a.preload = "none"; a.src = url; w.appendChild(a); }
    else if (f.mime.startsWith("video/")) { const v = el("video"); v.controls = true; v.preload = "metadata"; v.src = url; w.appendChild(v); }
    else { const a = el("a", "chip"); a.href = url + "?dl=1"; a.setAttribute("download", f.name); { const sp = el("span"); icText(sp, "paperclip", f.name); a.appendChild(sp); } a.appendChild(el("small", "", fmtSize(f.size))); w.appendChild(a); }
    return w;
  }
  const clock = (n) => Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
  // Lecteur de message vocal : lecture/pause, progression, vitesse. La durée vient du nom du fichier (les enregistrements du navigateur n'en portent pas)
  function voicePlayer(url, secs) {
    const w = el("div", "vm"), btn = el("button", "vplay"), track = el("div", "vtrack"), fill = el("i"), tm = el("span", "vtime", clock(secs)), sp = el("button", "vspeed", "1×");
    btn.type = sp.type = "button"; btn.innerHTML = ic("play"); btn.setAttribute("aria-label", "Écouter le message vocal"); sp.title = "Vitesse de lecture"; track.appendChild(fill);
    const a = new Audio(); a.preload = "none"; a.src = url; let speeds = [1, 1.5, 2], si = 0;
    const total = () => (isFinite(a.duration) && a.duration > 0 ? a.duration : secs) || 1;
    btn.onclick = () => {
      if (a.paused) { (window.__vm && window.__vm !== a) && window.__vm.pause(); window.__vm = a; a.play().catch(() => toast("Lecture impossible.")); } else a.pause();
    };
    a.onplay = () => { btn.innerHTML = ic("pause"); btn.setAttribute("aria-label", "Mettre en pause"); };
    a.onpause = () => { btn.innerHTML = ic("play"); btn.setAttribute("aria-label", "Écouter le message vocal"); };
    a.ontimeupdate = () => { fill.style.width = Math.min(100, (a.currentTime / total()) * 100) + "%"; tm.textContent = clock(a.currentTime); };
    a.onended = () => { fill.style.width = "0"; tm.textContent = clock(secs); a.currentTime = 0; };
    sp.onclick = () => { si = (si + 1) % speeds.length; a.playbackRate = speeds[si]; sp.textContent = speeds[si] + "×"; };
    track.onclick = (e) => { const r = track.getBoundingClientRect(); if (a.readyState > 0 && isFinite(a.duration)) a.currentTime = ((e.clientX - r.left) / r.width) * a.duration; };
    w.append(btn, track, tm, sp); return w;
  }
  function msgNode(m, prev, compact) {
    const mine = m.user.id === S.me.id, meTag = "@" + S.me.name.toLowerCase();
    const first = compact || !prev || prev.user.id !== m.user.id || m.ts - prev.ts > 300000 || !!m.reply || !!prev.poll;
    const row = el("div", "m" + (first ? " first" : "") + (!mine && m.text.toLowerCase().includes(meTag) ? " ping" : "")); row.dataset.id = m.id;
    if (first) { const av = avatar(m.user); av.onclick = (e) => userMenu(e, m.user); row.appendChild(av); } else row.appendChild(el("div", "gut", hhmm(m.ts)));
    const body = el("div", "body");
    if (m.reply) {
      const q = el("div", "quote"); q.appendChild(el("b", "", m.reply.name)); q.appendChild(el("span", "", m.reply.text || "Pièce jointe"));
      q.style.cursor = "pointer"; q.onclick = () => { const t = document.querySelector('#msgs .m[data-id="' + m.reply.id + '"]'); if (t) t.scrollIntoView({ block: "center", behavior: "smooth" }); };
      body.appendChild(q);
    }
    if (first) {
      const hd = el("div", "hd"), u = el("span", "u", m.user.name); u.style.color = m.user.roleColor || color(m.user); u.onclick = (e) => userMenu(e, m.user); hd.appendChild(u);
      const tg = tagFor(m.user.role); if (tg) hd.appendChild(tg);
      hd.appendChild(el("span", "ts", fmt(m.ts))); if (m.pinned) { const p = el("span", "pin"); p.innerHTML = ic("pin", 13); p.title = "Message épinglé"; hd.appendChild(p); }
      body.appendChild(hd);
    }
    if (S.editing === m.id && !compact) {
      const inp = el("input", "edit"); inp.value = m.text; inp.maxLength = 2000; inp.setAttribute("aria-label", "Modifier le message");
      inp.onkeydown = (e) => {
        if (e.key === "Escape") { S.editing = null; renderMsgs(); }
        if (e.key === "Enter") { e.preventDefault(); const v = inp.value.trim(); if (v === m.text) { S.editing = null; return renderMsgs(); } S.sock.emit("edit", { id: m.id, text: v }, (r) => { if (r && r.error) toast(r.error); else { S.editing = null; renderMsgs(); } }); }
      };
      body.appendChild(inp); body.appendChild(el("div", "hint", "Échap pour annuler, Entrée pour enregistrer."));
      setTimeout(() => inp.focus(), 0);
    } else if (m.text) {
      const tx = el("div", "tx"); richText(tx, m.text);
      if (m.edited) { const e = el("span", "ed", " (modifié)"); e.title = "Modifié le " + fmt(m.edited); tx.appendChild(e); }
      body.appendChild(tx);
    }
    if (m.file) body.appendChild(fileNode(m.file));
    if (m.poll) {
      const total = m.poll.reduce((a, o) => a + o.votes.length, 0), pl = el("div", "poll");
      m.poll.forEach((o) => {
        const b = el("button", "opt" + (o.votes.includes(S.me.name) ? " mine" : "")); b.title = o.votes.length ? o.votes.join(", ") : "Aucun vote";
        const bar = el("span", "bar"); bar.style.width = total ? Math.round((o.votes.length / total) * 100) + "%" : "0"; b.appendChild(bar);
        b.appendChild(el("span", "", o.emoji)); b.appendChild(el("span", "lb", o.label)); b.appendChild(el("span", "ct", String(o.votes.length)));
        b.onclick = () => react(m.id, o.emoji); pl.appendChild(b);
      });
      body.appendChild(pl);
    }
    const ks = Object.keys(m.reactions || {});
    if (ks.length) {
      const rx = el("div", "rx");
      ks.forEach((e) => { const who = m.reactions[e], b = el("button", who.includes(S.me.name) ? "me-r" : ""); b.title = who.join(", "); b.appendChild(el("span", "", e)); b.appendChild(el("b", "", String(who.length))); b.onclick = () => react(m.id, e); rx.appendChild(b); });
      body.appendChild(rx);
    }
    row.appendChild(body);
    if (!compact) row.appendChild(toolbar(m, mine));
    row.addEventListener("click", (e) => { if (compact || e.target.closest("button,a,input,img,video,audio")) return; const was = row.classList.contains("sel"); document.querySelectorAll("#msgs .m.sel").forEach((x) => x.classList.remove("sel")); if (!was) row.classList.add("sel"); });
    return row;
  }
  function toolbar(m, mine) {
    const t = el("div", "tools"), c = channel();
    function add(icon, title, fn) { const b = el("button", ""); if (IC[icon]) b.innerHTML = ic(icon); else b.textContent = icon; b.title = title; b.setAttribute("aria-label", title); b.type = "button"; b.onclick = fn; t.appendChild(b); }
    QUICK.forEach((e) => add(e, "Réagir " + e, () => react(m.id, e)));
    add("reply", "Répondre", () => { S.reply = m; renderReply(); $("inp").focus(); });
    if (mine && !m.poll && m.user.role !== "bot") add("edit", "Modifier", () => { S.editing = m.id; renderMsgs(); });
    if (c && (c.kind === "dm" || privileged())) add("pin", m.pinned ? "Désépingler" : "Épingler", () => S.sock.emit("pin", { id: m.id, pinned: !m.pinned }, (r) => { if (r && r.error) toast(r.error); }));
    if (!mine && m.user.role !== "bot") add("flag", "Signaler", () => reportModal(m));
    if (mine || privileged()) add("trash", "Supprimer", () => S.sock.emit("delete", { id: m.id }, (r) => { if (r && r.error) toast(r.error); }));
    return t;
  }
  function renderMsgs(toBottom, soft) {
    const box = $("msgs"), c = channel(); box.innerHTML = "";
    if (!c) {
      box.appendChild(el("div", "emptymain", S.view === "dm" ? "Choisissez une conversation, ou cliquez sur un membre d'un serveur puis sur « Écrire à… »." : "Aucun salon disponible."));
      return;
    }
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120, prevT = box.scrollTop, list = S.msgs[c.id] || [];
    if (S.more[c.id]) { const mb = el("button", "more", "Charger les messages précédents"); mb.onclick = () => loadHistory(c.id, list[0] && list[0].id); box.appendChild(mb); }
    else {
      const w = el("div", "welcome");
      w.appendChild(el("h3", "", c.kind === "dm" ? "Conversation avec " + c.name : "Bienvenue dans #" + c.name + " !"));
      w.appendChild(el("p", "", c.kind === "dm" ? "C'est le début de votre conversation privée. Seuls vous deux pouvez la lire." : c.topic || "C'est le début du salon.")); box.appendChild(w);
    }
    let prev = null; list.forEach((m) => { box.appendChild(msgNode(m, prev, false)); prev = m; });
    (S.ephemeral[c.id] || []).forEach((e) => { const d = el("div", "eph"); richText(d, e.text); d.appendChild(el("small", "", "Seul vous voyez ce message · Cordibot")); box.appendChild(d); });
    if (toBottom && (!soft || near)) box.scrollTop = box.scrollHeight; else box.scrollTop = prevT;
  }
  function react(id, e) { S.sock.emit("react", { id, emoji: e }, (r) => { if (r && r.error) toast(r.error); }); }
  function renderReply() {
    const b = $("replyBar"); b.hidden = !S.reply;
    if (S.reply) $("replyText").textContent = "Réponse à " + S.reply.user.name + " : " + (S.reply.text || "pièce jointe").slice(0, 80);
  }
  $("replyCancel").onclick = () => { S.reply = null; renderReply(); };

  /* ---------- Recherche et épingles ---------- */
  function renderPanel() {
    const p = $("panel"), c = channel();
    if (!S.panel || !c) { p.hidden = true; return; }
    p.hidden = false; $("searchForm").hidden = S.panel !== "search"; $("panelTitle").textContent = S.panel === "search" ? "Recherche dans " + (c.kind === "dm" ? "la conversation" : "#" + c.name) : "Messages épinglés";
    if (S.panel === "pins") loadPins(); else { $("panelList").innerHTML = ""; $("panelList").appendChild(el("div", "empty", "Tapez au moins 2 caractères.")); $("searchInput").value = ""; $("searchInput").focus(); }
  }
  function renderPanelKeep() { if (S.panel === "pins") loadPins(); }
  function showResults(list, emptyText) {
    const box = $("panelList"); box.innerHTML = "";
    if (!list.length) return box.appendChild(el("div", "empty", emptyText));
    list.forEach((m) => box.appendChild(msgNode(m, null, true)));
  }
  function loadPins() { S.sock.emit("pins", { channelId: S.cid }, (r) => { if (S.panel === "pins") showResults((r && r.messages) || [], "Aucun message épinglé dans ce salon."); }); }
  function runSearch() {
    const v = $("searchInput").value.trim();
    if (v.length < 2) return;
    S.sock.emit("search", { channelId: S.cid, query: v }, (r) => { if (r && r.error) return toast(r.error); if (S.panel === "search") showResults(r.messages, "Aucun message ne correspond à « " + v + " »."); });
  }
  let searchT; $("searchForm").onsubmit = (e) => { e.preventDefault(); runSearch(); };
  $("searchInput").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 450); });
  $("bSearch").onclick = () => { S.panel = S.panel === "search" ? null : "search"; renderPanel(); };
  $("bPins").onclick = () => { S.panel = S.panel === "pins" ? null : "pins"; renderPanel(); };
  $("panelClose").onclick = () => { S.panel = null; renderPanel(); };

  /* ---------- Envoi, fichiers, commandes ---------- */
  function send() {
    const c = channel(), inp = $("inp"), text = inp.value.trim();
    if (!c || (!text && !S.pending)) return;
    if (S.pending && S.pending.uploading) return toast("Envoi du fichier en cours…");
    S.sock.emit("send", { channelId: c.id, text, replyTo: S.reply && S.reply.id, fileId: S.pending && S.pending.id }, (r) => {
      if (r && r.error) { if (r.wait) S.cool[c.id] = Date.now() + r.wait * 1000; updateComposer(); return toast(r.error); }
      inp.value = ""; S.reply = null; clearFile(); renderReply(); hideCmds();
      if (c.slowmode && !privileged()) { S.cool[c.id] = Date.now() + c.slowmode * 1000; updateComposer(); }
    });
  }
  $("form").onsubmit = (e) => { e.preventDefault(); send(); };
  $("inp").addEventListener("input", () => {
    const n = Date.now(), c = channel();
    if (c && n - S.lastTyping > 2000 && !$("inp").value.startsWith("/")) { S.lastTyping = n; S.sock.emit("typing", { channelId: c.id }); }
    updateCmds();
  });
  $("inp").addEventListener("keydown", (e) => {
    const open = !$("cmds").hidden;
    if (open && (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault(); const items = cmdMatches();
      if (e.key === "Tab") pickCmd(items[S.cmdIdx] || items[0]); else { S.cmdIdx = (S.cmdIdx + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length; updateCmds(); }
    } else if (e.key === "ArrowUp" && !$("inp").value) {
      const mine = (S.msgs[S.cid] || []).slice().reverse().find((m) => m.user.id === S.me.id && !m.poll);
      if (mine) { S.editing = mine.id; renderMsgs(); }
    }
  });
  function cmdMatches() { const v = $("inp").value; return /^\/\S*$/.test(v) ? COMMANDS.filter((x) => x.c.startsWith(v.toLowerCase())) : []; }
  function updateCmds() {
    const items = cmdMatches(), box = $("cmds");
    if (!items.length) return hideCmds();
    S.cmdIdx = Math.min(S.cmdIdx, items.length - 1); box.hidden = false; box.innerHTML = "";
    items.forEach((x, i) => { const b = el("button", i === S.cmdIdx ? "on" : ""); b.type = "button"; b.appendChild(el("b", "", x.c)); b.appendChild(el("span", "", x.d)); b.onmousedown = (e) => { e.preventDefault(); pickCmd(x); }; box.appendChild(b); });
  }
  function hideCmds() { $("cmds").hidden = true; S.cmdIdx = 0; }
  function pickCmd(x) { if (!x) return; $("inp").value = x.c + " "; hideCmds(); $("inp").focus(); }

  function clearFile() { S.pending = null; $("fileBar").hidden = true; $("fileInput").value = ""; }
  function pickFile(file, autoSend) {
    if (!file) return;
    if (!channel()) return toast("Ouvrez d'abord un salon.");
    if (file.size > 8 * 1024 * 1024) return toast("Fichier trop volumineux (8 Mo maximum).");
    const p = { name: file.name, uploading: true, id: null }; S.pending = p;
    $("fileBar").hidden = false; $("fileName").textContent = "📎 " + file.name + " (" + fmtSize(file.size) + ")"; $("fileProg").textContent = "0 %";
    const x = new XMLHttpRequest(); p.xhr = x;
    x.open("POST", "/api/upload"); x.setRequestHeader("Authorization", "Bearer " + S.token); x.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) $("fileProg").textContent = Math.round((e.loaded / e.total) * 100) + " %"; };
    x.onload = () => {
      if (S.pending !== p) return;
      let d = {}; try { d = JSON.parse(x.responseText); } catch (e) { /* réponse non JSON */ }
      if (x.status === 200 && d.id) { p.id = d.id; p.uploading = false; $("fileProg").textContent = "Prêt"; if (autoSend) send(); else $("inp").focus(); }
      else { toast(d.error || "L'envoi du fichier a échoué."); clearFile(); }
    };
    x.onerror = () => { if (S.pending === p) { toast("L'envoi du fichier a échoué."); clearFile(); } };
    x.send(file);
  }
  /* ---------- Messages vocaux ---------- */
  const REC = { rec: null };
  async function startRecording() {
    if (REC.rec) return;
    const c = channel(); if (!c) return toast("Ouvrez d'abord un salon.");
    if (!navigator.mediaDevices || !window.MediaRecorder || !window.isSecureContext) return toast("Les messages vocaux demandent HTTPS, un micro et un navigateur récent.");
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { return toast("Micro inaccessible : autorisez-le dans votre navigateur."); }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [], r = { mr, stream, cid: c.id, t0: Date.now(), send: false, timer: null };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      clearInterval(r.timer); stream.getTracks().forEach((t) => t.stop()); REC.rec = null; $("recBar").hidden = true; $("form").hidden = false;
      const secs = Math.max(1, Math.round((Date.now() - r.t0) / 1000));
      if (!r.send || !chunks.length) return;
      const type = mr.mimeType || mime || "audio/webm", ext = /mp4/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "weba";
      const channelNow = channel(); if (!channelNow || channelNow.id !== r.cid) return toast("Enregistrement annulé : vous avez changé de salon.");
      pickFile(new File(chunks, "vocal-" + secs + "." + ext, { type }), true);
    };
    REC.rec = r; mr.start(250);
    $("form").hidden = true; $("recBar").hidden = false; $("recTime").textContent = "0:00";
    const bars = $("recBars"); bars.innerHTML = ""; for (let i = 0; i < 24; i++) bars.appendChild(el("i")); const an = analyserFor(stream);
    r.timer = setInterval(() => {
      const s = (Date.now() - r.t0) / 1000; $("recTime").textContent = clock(s);
      const lv = Math.min(1, level(an) / 60); [...bars.children].forEach((b, i, all) => { b.style.height = (i === all.length - 1 ? 4 + lv * 22 : parseFloat(all[i + 1].style.height) || 4) + "px"; });
      const cc = channel(); if (!cc || cc.id !== r.cid) stopRecording(false);
      else if (s >= 120) { toast("Durée maximale atteinte (2 min) : envoi."); stopRecording(true); }
    }, 120);
  }
  function stopRecording(send) { const r = REC.rec; if (!r) return; r.send = send; if (send && Date.now() - r.t0 < 800) { r.send = false; toast("Message trop court."); } try { r.mr.stop(); } catch (e) { r.send = false; r.stream.getTracks().forEach((t) => t.stop()); REC.rec = null; $("recBar").hidden = true; $("form").hidden = false; } }
  $("bMic").onclick = startRecording; $("recSend").onclick = () => stopRecording(true); $("recCancel").onclick = () => stopRecording(false);
  $("bAttach").onclick = () => $("fileInput").click();
  $("fileInput").onchange = () => pickFile($("fileInput").files[0]);
  $("fileCancel").onclick = () => { if (S.pending && S.pending.xhr) S.pending.xhr.abort(); clearFile(); };
  $("inp").addEventListener("paste", (e) => { const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0]; if (f) { e.preventDefault(); pickFile(f); } });
  const mainEl = document.querySelector(".main");
  mainEl.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  mainEl.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); pickFile(e.dataTransfer.files[0]); } });

  const emo = $("emo");
  EMOJIS.forEach((e) => { const b = el("button", "", e); b.type = "button"; b.onclick = () => { $("inp").value += e; $("inp").focus(); emo.classList.remove("open"); }; emo.appendChild(b); });
  $("bEmo").onclick = () => emo.classList.toggle("open");
  $("bSt").onclick = () => {
    const next = STATUSES[(STATUSES.indexOf(S.me.status) + 1) % STATUSES.length];
    S.sock.emit("status", { status: next }, (r) => { if (r && r.ok) { S.me.status = next; renderMe(); } });
  };

  /* ---------- Fenêtres et menus ---------- */
  function modal(o) {
    const ov = el("div", "overlay"), card = el("div", "card"); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", o.title);
    card.appendChild(el("h2", "", o.title)); if (o.sub) card.appendChild(el("p", "sub", o.sub));
    const inputs = {};
    (o.fields || []).forEach((f) => {
      let i;
      if (f.type === "select") { i = el("select", "field"); f.options.forEach(([v, l]) => { const op = el("option", "", l); op.value = v; if (String(v) === String(f.value)) op.selected = true; i.appendChild(op); }); }
      else if (f.type === "check") { const l = el("label", "check"); i = el("input"); i.type = "checkbox"; i.checked = !!f.value; i.id = "m-" + f.id; l.htmlFor = i.id; l.appendChild(i); l.appendChild(document.createTextNode(f.label)); card.appendChild(l); inputs[f.id] = i; return; }
      else { i = el("input", "field"); i.placeholder = f.ph || ""; i.maxLength = f.max || 40; i.value = f.value || ""; }
      i.id = "m-" + f.id; const l = el("label", "", f.label); l.htmlFor = i.id; card.appendChild(l); card.appendChild(i); inputs[f.id] = i;
    });
    const err = el("div", "err"); card.appendChild(err);
    const api = { v: (k) => (inputs[k].type === "checkbox" ? inputs[k].checked : inputs[k].value.trim()), error: (t) => { err.textContent = t; }, close: () => ov.remove(), card, err };
    (o.buttons || []).forEach((b) => {
      const btn = el("button", "btn" + (b.ghost ? " ghost" : "") + (b.danger ? " danger" : ""), b.label); btn.type = "button";
      btn.onclick = () => (b.run ? b.run(api, btn) : api.close()); card.appendChild(btn);
    });
    ov.appendChild(card); ov.addEventListener("mousedown", (e) => { if (e.target === ov) api.close(); });
    document.body.appendChild(ov); const first = card.querySelector("input:not([type=checkbox]),select"); if (first) first.focus();
    return api;
  }
  function serverModal() {
    modal({ title: "Ajouter un serveur", sub: "Créez le vôtre ou rejoignez-en un avec un code d'invitation.",
      fields: [{ id: "name", label: "Créer un serveur", ph: "Nom du serveur", max: 30 }, { id: "code", label: "Ou rejoindre avec un code", ph: "Ex. A1B2C3", max: 12 }],
      buttons: [{ label: "Valider", run: (m) => {
        const name = m.v("name"), code = m.v("code");
        const done = (r) => { if (r.error) return m.error(r.error); if (!S.servers.some((s) => s.id === r.server.id)) S.servers.push(r.server); m.close(); go("server", r.server.id, firstText(r.server)); };
        if (code) S.sock.emit("joinServer", { code }, done); else if (name) S.sock.emit("createServer", { name }, done); else m.error("Saisissez un nom ou un code.");
      } }, { label: "Annuler", ghost: true }] });
  }
  const WHEN = (t) => new Date(t).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  // Champs « salon privé » : une case, puis une case par rôle autorisé
  function privacyFields(c) {
    const roles = (S.roles[S.sid] || {}).roles || [], on = new Set((c && c.roleIds) || []);
    const f = [{ id: "p", type: "check", label: "Salon privé : visible seulement par les rôles cochés (et par ceux qui gèrent les salons)", value: !!(c && c.private) }];
    roles.forEach((r) => f.push({ id: "pr" + r.id, type: "check", label: "   ↳ " + r.name, value: on.has(r.id) }));
    return { fields: f, read: (m) => ({ private: m.v("p"), roleIds: roles.filter((r) => m.v("pr" + r.id)).map((r) => r.id) }) };
  }
  function channelCreateModal() {
    const pv = privacyFields(null);
    modal({ title: "Créer un salon", fields: [{ id: "n", label: "Nom du salon", ph: "ex. projets", max: 24 }, { id: "k", label: "Type", type: "select", options: [["text", "Salon textuel"], ["voice", "Salon vocal"]], value: "text" }, ...pv.fields, { id: "t", label: "Description (facultatif)", ph: "À quoi sert ce salon ?", max: 100 }],
      buttons: [{ label: "Créer", run: (m) => S.sock.emit("createChannel", { serverId: S.sid, name: m.v("n"), topic: m.v("t"), kind: m.v("k"), ...pv.read(m) }, (r) => { if (r && r.error) m.error(r.error); else m.close(); }) }, { label: "Annuler", ghost: true }] });
  }
  function channelSettingsModal(c) {
    const text = c.kind === "text", fields = [{ id: "t", label: "Description", value: c.topic, max: 100 }];
    if (text) { fields.push({ id: "s", label: "Mode lent (délai entre deux messages)", type: "select", options: SLOW, value: c.slowmode }); fields.push({ id: "r", label: "Lecture seule : seuls le propriétaire et les modérateurs écrivent", type: "check", value: c.readonly }); }
    const pv = privacyFields(c); fields.push(...pv.fields);
    let armed = false;
    modal({ title: "Réglages de #" + c.name, fields, buttons: [
      { label: "Enregistrer", run: (m) => S.sock.emit("setChannel", { channelId: c.id, ...pv.read(m), topic: m.v("t"), slowmode: text ? Number(m.v("s")) : 0, readonly: text ? m.v("r") : false }, (r) => { if (r && r.error) m.error(r.error); else m.close(); }) },
      { label: "Supprimer le salon", danger: true, run: (m, btn) => {
        if (!armed) { armed = true; btn.textContent = "Cliquez encore pour confirmer la suppression"; return; }
        S.sock.emit("deleteChannel", { channelId: c.id }, (r) => { if (r && r.error) { armed = false; btn.textContent = "Supprimer le salon"; m.error(r.error); } else m.close(); });
      } },
      { label: "Annuler", ghost: true }] });
  }
  function reportModal(msg) {
    modal({ title: "Signaler ce message", sub: "L'équipe de modération sera prévenue. Message de " + msg.user.name + " : « " + (msg.text || "pièce jointe").slice(0, 80) + " »", fields: [{ id: "r", label: "Motif (facultatif)", ph: "Insultes, spam, contenu inapproprié…", max: 200 }],
      buttons: [{ label: "Envoyer le signalement", danger: true, run: (m) => S.sock.emit("report", { id: msg.id, reason: m.v("r") }, (r) => { if (r && r.error) m.error(r.error); else { m.close(); toast("Merci, le signalement a été transmis à l'équipe."); } }) }, { label: "Annuler", ghost: true }] });
  }
  $("bInvite").onclick = () => {
    const s = server(); if (!s) return;
    const m = modal({ title: "Inviter des amis", sub: "Partagez ce code pour rejoindre « " + s.name + " ».", buttons: [
      { label: "Copier le code", run: (mm) => { try { navigator.clipboard.writeText(s.code).then(() => { mm.close(); toast("Code copié."); }, () => mm.error("Copie impossible, sélectionnez le code.")); } catch (e) { mm.error("Copie impossible, sélectionnez le code."); } } },
      { label: "Fermer", ghost: true }] });
    m.card.insertBefore(el("div", "code", s.code), m.err);
  };
  function userMenu(ev, u) {
    ev.stopPropagation(); closeMenu();
    const m = el("div", "menu"); m.id = "ctxmenu"; m.appendChild(el("div", "hd", u.name));
    { const b = el("button", "", "👤 Voir le profil"); b.onclick = () => { closeMenu(); profileCard(u.id); }; m.appendChild(b); }
    if (u.id !== S.me.id && u.role !== "bot") { const b = icText(el("button", ""), "message", "Écrire à " + u.name); b.onclick = () => { closeMenu(); openDm(u.id); }; m.appendChild(b); }
    else m.appendChild(el("div", "hd", u.id === S.me.id ? "C'est vous" : "Robot du serveur"));
    roleItems(m, u);
    document.body.appendChild(m);
    const r = m.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(ev.clientX, innerWidth - r.width - 8)) + "px"; m.style.top = Math.max(8, Math.min(ev.clientY, innerHeight - r.height - 8)) + "px";
  }
  /* ---------- Sanctions ---------- */
  const DURATIONS = { mute: [["10", "10 minutes"], ["60", "1 heure"], ["1440", "1 jour"]], ban: [["1", "1 heure"], ["24", "1 jour"], ["0", "Définitif"]] };
  const TYPE_LABEL = { warn: "Avertissement", mute: "Sourdine", unmute: "Sourdine levée", kick: "Expulsion", ban: "Bannissement", unban: "Bannissement levé" };
  function sanctionModal(type, u) {
    const sid = S.sid, titles = { warn: "Avertir ", mute: "Mettre en sourdine ", kick: "Expulser ", ban: "Bannir " };
    const subs = { warn: "Le membre reçoit votre message et l'avertissement est conservé dans l'historique.", mute: "Pendant la sourdine, il ne peut ni écrire, ni réagir, ni rejoindre le vocal.", kick: "Il peut revenir avec le code d'invitation. Pour l'en empêcher, utilisez un bannissement.", ban: "Il est retiré du serveur et ne peut plus le rejoindre pendant la durée choisie." };
    const fields = [];
    if (DURATIONS[type]) fields.push({ id: "d", label: "Durée", type: "select", options: DURATIONS[type], value: DURATIONS[type][0][0] });
    fields.push({ id: "r", label: type === "warn" ? "Message d'avertissement" : "Motif (facultatif)", ph: type === "warn" ? "Ce qu'il doit corriger" : "Insultes, spam…", max: 200 });
    modal({ title: titles[type] + u.name, sub: subs[type], fields, buttons: [
      { label: { warn: "Envoyer l'avertissement", mute: "Mettre en sourdine", kick: "Expulser", ban: "Bannir" }[type], danger: type === "kick" || type === "ban", run: (m) => {
        const base = { serverId: sid, userId: u.id, reason: m.v("r") };
        const p = type === "mute" ? { ...base, minutes: Number(m.v("d")) } : type === "ban" ? { ...base, hours: Number(m.v("d")) || null } : base;
        S.sock.emit(type, p, (x) => { if (x && x.error) m.error(x.error); else { m.close(); toast(u.name + " : " + ({ warn: "avertissement envoyé", mute: "mis en sourdine", kick: "expulsé", ban: "banni" })[type] + "."); } });
      } }, { label: "Annuler", ghost: true }] });
  }
  function histRows(list, box, withName) {
    if (!list.length) { box.appendChild(el("p", "rhint", "Aucune sanction enregistrée.")); return; }
    list.forEach((h) => {
      const row = el("div", "srow"), top = el("div", "stop");
      top.appendChild(el("b", "stype t-" + h.type, TYPE_LABEL[h.type] || h.type));
      if (withName) top.appendChild(el("span", "", " — " + h.user.name));
      top.appendChild(el("span", "swhen", WHEN(h.ts)));
      row.appendChild(top);
      const det = [h.until && (h.type === "mute" ? "jusqu'à " + WHEN(h.until) : "jusqu'au " + WHEN(h.until)), h.type === "ban" && !h.until ? "définitif" : "", h.reason, "par " + h.by].filter(Boolean).join(" · ");
      row.appendChild(el("div", "sdet", det)); box.appendChild(row);
    });
  }
  function historyModal(u) {
    S.sock.emit("sanctions", { serverId: S.sid, userId: u.id }, (r) => {
      if (!r || r.error) return toast((r && r.error) || "Historique indisponible.");
      const card = el("div", "card scard"); card.setAttribute("role", "dialog"); card.appendChild(el("h2", "", "Sanctions de " + u.name));
      if (r.mute) card.appendChild(el("p", "rhint", "En sourdine jusqu'à " + WHEN(r.mute.until) + "."));
      if (r.ban) card.appendChild(el("p", "rhint", "Banni " + (r.ban.until ? "jusqu'au " + WHEN(r.ban.until) : "définitivement") + "."));
      const box = el("div", "slist"); histRows(r.history, box, false); card.appendChild(box);
      const bye = el("button", "btn ghost", "Fermer"); bye.type = "button"; card.appendChild(bye);
      const close = overlay(card); bye.onclick = close;
    });
  }
  function sanctionsPanel() {
    const sid = S.sid, card = el("div", "card scard"); card.setAttribute("role", "dialog"); card.appendChild(el("h2", "", "Sanctions du serveur"));
    const tabs = el("div", "stabs"), body = el("div", "slist"); let tab = "now", data = null;
    const render = () => {
      body.innerHTML = ""; tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
      if (!data) { body.appendChild(el("p", "rhint", "Chargement…")); return; }
      if (tab === "hist") return histRows(data.history, body, true);
      body.appendChild(el("div", "hd", "Bannis (" + data.bans.length + ")"));
      if (!data.bans.length) body.appendChild(el("p", "rhint", "Personne n'est banni."));
      data.bans.forEach((b) => {
        const row = el("div", "srow"), top = el("div", "stop"); top.appendChild(el("b", "", b.user.name)); top.appendChild(el("span", "swhen", b.until ? "jusqu'au " + WHEN(b.until) : "définitif"));
        row.appendChild(top); row.appendChild(el("div", "sdet", [b.reason, "par " + b.by].filter(Boolean).join(" · ")));
        if (canIn(PERM.BAN)) { const un = el("button", "mini", "Lever le bannissement"); un.type = "button"; un.onclick = () => S.sock.emit("unban", { serverId: sid, userId: b.user.id }, (x) => { if (x && x.error) toast(x.error); else load(); }); row.appendChild(un); }
        body.appendChild(row);
      });
      body.appendChild(el("div", "hd", "Sourdines en cours (" + data.mutes.length + ")"));
      if (!data.mutes.length) body.appendChild(el("p", "rhint", "Personne n'est en sourdine."));
      data.mutes.forEach((mu) => {
        const row = el("div", "srow"), top = el("div", "stop"); top.appendChild(el("b", "", mu.user.name)); top.appendChild(el("span", "swhen", "jusqu'à " + WHEN(mu.until)));
        row.appendChild(top); row.appendChild(el("div", "sdet", [mu.reason, "par " + mu.by].filter(Boolean).join(" · ")));
        if (canIn(PERM.MUTE)) { const un = el("button", "mini", "Lever la sourdine"); un.type = "button"; un.onclick = () => S.sock.emit("unmute", { serverId: sid, userId: mu.user.id }, (x) => { if (x && x.error) toast(x.error); else load(); }); row.appendChild(un); }
        body.appendChild(row);
      });
    };
    [["now", "En cours"], ["hist", "Historique"]].forEach(([t, l]) => { const b = el("button", "stab", l); b.type = "button"; b.dataset.t = t; b.onclick = () => { tab = t; render(); }; tabs.appendChild(b); });
    const load = () => S.sock.emit("sanctions", { serverId: sid }, (r) => { if (!r || r.error) { toast((r && r.error) || "Indisponible."); return; } data = r; render(); });
    card.append(tabs, body); const bye = el("button", "btn ghost", "Fermer"); bye.type = "button"; card.appendChild(bye);
    const close = overlay(card); bye.onclick = close; render(); load();
  }
  $("bSanc").onclick = sanctionsPanel;
  /* ---------- Rôles ---------- */
  const rankOfMember = (mb) => { const rs = ((S.roles[S.sid] || {}).roles || []); return Math.max(0, ...rs.filter((r) => (mb.roles || []).includes(r.id)).map((r) => r.position)); };
  // Dans le menu d'un membre : attribuer les rôles accessibles, et expulser
  function roleItems(m, u) {
    if (S.view !== "server") return;
    const sv = server(), info = S.roles[S.sid], mb = (S.members[S.sid] || []).find((x) => x.id === u.id);
    if (!sv || !info || !mb || u.role === "bot") return;
    const untouchable = mb.owner || mb.role === "admin" || mb.role === "mod";
    const myRank = isStaff() || sv.owner === S.me.id ? 1e9 : info.rank, higher = u.id !== S.me.id && (untouchable || rankOfMember(mb) >= myRank);
    if (canIn(PERM.ROLES) && !higher) {
      const mine = info.roles.filter((r) => r.position < myRank);
      if (mine.length) {
        m.appendChild(el("div", "hd", "Rôles"));
        mine.forEach((r) => {
          const has = mb.roles.includes(r.id), b = el("button", "rolebtn" + (has ? " on" : ""));
          const dot = el("i", "rdot"); dot.style.background = r.color; b.append(dot, el("span", "", (has ? "✓ " : "＋ ") + r.name));
          b.onclick = () => {
            const ids = has ? mb.roles.filter((x) => x !== r.id) : mb.roles.concat(r.id);
            S.sock.emit("setMemberRoles", { serverId: S.sid, userId: u.id, roleIds: ids }, (x) => { if (x && x.error) toast(x.error); }); closeMenu();
          };
          m.appendChild(b);
        });
      }
    }
    if (u.id === S.me.id) return;
    const mod = (flag, icon, label, fn, danger) => { if (!canIn(flag) || higher) return; const b = icText(el("button", danger ? "danger" : ""), icon, label); b.onclick = (e) => { e.stopPropagation(); closeMenu(); fn(); }; m.appendChild(b); };
    if (canMod() && !higher) m.appendChild(el("div", "hd", "Modération"));
    mod(PERM.MUTE, "alert", "Avertir…", () => sanctionModal("warn", u));
    mod(PERM.MUTE, "timer", "Mettre en sourdine…", () => sanctionModal("mute", u));
    mod(PERM.MUTE, "volume", "Lever la sourdine", () => S.sock.emit("unmute", { serverId: S.sid, userId: u.id }, (x) => toast(x && x.error ? x.error : "Sourdine levée pour " + u.name + ".")));
    mod(PERM.KICK, "log-out", "Expulser du serveur…", () => sanctionModal("kick", u), true);
    mod(PERM.BAN, "ban", "Bannir…", () => sanctionModal("ban", u), true);
    if (canMod() && !higher) { const b = icText(el("button", ""), "history", "Historique des sanctions"); b.onclick = (e) => { e.stopPropagation(); closeMenu(); historyModal(u); }; m.appendChild(b); }
  }
  const PERM_LABELS = [
    [PERM.MESSAGES, "Gérer les messages", "Supprimer et épingler les messages des autres"],
    [PERM.CHANNELS, "Gérer les salons", "Créer, modifier et supprimer des salons"],
    [PERM.ROLES, "Gérer les rôles", "Créer des rôles plus bas que le sien et les attribuer"],
    [PERM.KICK, "Expulser des membres", "Retirer quelqu'un du serveur (il peut revenir avec le code)"],
    [PERM.VIP, "Parler partout", "Ignore le mode lent et la lecture seule"],
    [PERM.BAN, "Bannir des membres", "Bloquer quelqu'un pour une durée ou définitivement, et lever un bannissement"],
    [PERM.MUTE, "Avertir et mettre en sourdine", "Envoyer un avertissement ou interdire d'écrire pendant un temps"],
  ];
  const SWATCH = ["#99aab5", "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c", "#3498db", "#9b59b6", "#e91e63"];
  function rolesModal() {
    const sid = S.sid; let sel = null;
    const card = el("div", "card pcard rcard"); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Rôles du serveur");
    const close = overlay(card); const oldClose = close;
    const done = () => { S.rolesRefresh = null; oldClose(); };
    function render() {
      if (!card.isConnected) { S.rolesRefresh = null; return; }
      const info = S.roles[sid]; if (!info) return;
      const top = isStaff() || (server() && server().owner === S.me.id) ? 1e9 : info.rank;
      card.innerHTML = "";
      const body = el("div", "pbody"); body.appendChild(el("h2", "rtitle", "Rôles du serveur"));
      body.appendChild(el("p", "rhint", "Les rôles du haut passent avant ceux du bas. Vous ne gérez que les rôles situés sous le vôtre."));
      const list = el("div", "rlist");
      info.roles.forEach((r, i) => {
        const row = el("div", "rrow" + (sel === r.id ? " sel" : "")), dot = el("i", "rdot"); dot.style.background = r.color;
        const nm = el("button", "rname", r.name); nm.type = "button"; nm.onclick = () => { sel = r.id; render(); };
        row.append(dot, nm, el("span", "rcount", r.count + (r.count > 1 ? " membres" : " membre")));
        if (r.position < top) {
          const up = el("button", "icn", "▲"), dn = el("button", "icn", "▼"); up.type = dn.type = "button"; up.title = "Monter"; dn.title = "Descendre";
          up.disabled = i === 0 || info.roles[i - 1].position >= top; dn.disabled = i === info.roles.length - 1;
          up.onclick = () => S.sock.emit("moveRole", { roleId: r.id, dir: 1 }, (x) => x && x.error && toast(x.error));
          dn.onclick = () => S.sock.emit("moveRole", { roleId: r.id, dir: -1 }, (x) => x && x.error && toast(x.error));
          row.append(up, dn);
        }
        list.appendChild(row);
      });
      if (!info.roles.length) list.appendChild(el("p", "rhint", "Aucun rôle pour l'instant."));
      body.appendChild(list);
      const add = icText(el("button", "pbtn"), "plus", "Nouveau rôle"); add.type = "button";
      add.onclick = () => S.sock.emit("createRole", { serverId: sid, name: "Nouveau rôle", color: SWATCH[1 + Math.floor(Math.random() * 8)], perms: 0 }, (x) => { if (x && x.error) toast(x.error); else { sel = x.id; } });
      body.appendChild(add);
      const r = info.roles.find((x) => x.id === sel);
      if (r) {
        const locked = r.position >= top, ed = el("div", "redit");
        const l1 = el("label", "", "Nom du rôle"), i1 = el("input", "field"); i1.value = r.name; i1.maxLength = 24; i1.disabled = locked; l1.htmlFor = i1.id = "r-name";
        const l2 = el("label", "", "Couleur"), sw = el("div", "swatches"); let col = r.color;
        const pick = el("input"); pick.type = "color"; pick.value = col; pick.disabled = locked; pick.setAttribute("aria-label", "Couleur personnalisée");
        const mark = () => sw.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.c === col));
        SWATCH.forEach((c) => { const b = el("button", "sw"); b.type = "button"; b.dataset.c = c; b.style.background = c; b.disabled = locked; b.setAttribute("aria-label", c); b.onclick = () => { col = c; pick.value = c; mark(); }; sw.appendChild(b); });
        pick.oninput = () => { col = pick.value; mark(); }; sw.appendChild(pick);
        ed.append(l1, i1, l2, sw);
        const l3 = el("label", "", "Permissions"); ed.appendChild(l3);
        const checks = PERM_LABELS.map(([flag, name, desc]) => {
          const lab = el("label", "check perm"), cb = el("input"); cb.type = "checkbox"; cb.checked = (r.perms & flag) !== 0;
          const myPerms = isStaff() || (server() && server().owner === S.me.id) ? 127 : info.perms;
          cb.disabled = locked || (myPerms & flag) === 0;
          const tx = el("span"); tx.append(el("b", "", name), el("small", "", desc)); lab.append(cb, tx); ed.appendChild(lab); return [flag, cb];
        });
        const err = el("div", "err"); ed.appendChild(err);
        if (locked) ed.appendChild(el("p", "rhint", "Ce rôle est au même niveau que le vôtre ou au-dessus : lecture seule."));
        else {
          const save = el("button", "btn", "Enregistrer le rôle"); save.type = "button";
          save.onclick = () => S.sock.emit("updateRole", { roleId: r.id, name: i1.value, color: col, perms: checks.reduce((n, [f, c]) => n | (c.checked ? f : 0), 0) }, (x) => { if (x && x.error) err.textContent = x.error; else toast("Rôle enregistré."); });
          const del = el("button", "btn danger", "Supprimer ce rôle"); del.type = "button";
          del.onclick = () => { if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = "Cliquez encore pour confirmer"; return; } S.sock.emit("deleteRole", { roleId: r.id }, (x) => { if (x && x.error) err.textContent = x.error; else sel = null; }); };
          ed.append(save, del);
        }
        mark(); body.appendChild(ed);
      }
      const bye = el("button", "btn ghost", "Fermer"); bye.type = "button"; bye.onclick = done; body.appendChild(bye);
      card.appendChild(body);
    }
    S.rolesRefresh = render; loadRoles(sid); render();
  }
  $("bRoles").onclick = rolesModal;

  /* ---------- Profils ---------- */
  const DATE = (t) => new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  function banner(p) {
    const b = el("div", "pban");
    if (p.banner) b.style.backgroundImage = "url(/files/" + p.banner + ")"; else b.style.background = "linear-gradient(135deg, " + color(p) + ", var(--accent-2))";
    return b;
  }
  function overlay(card) {
    const ov = el("div", "overlay"); ov.appendChild(card);
    const close = () => { ov.remove(); document.removeEventListener("keydown", esc); }, esc = (e) => { if (e.key === "Escape") close(); };
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); }); document.addEventListener("keydown", esc); document.body.appendChild(ov);
    return close;
  }
  function profileCard(id) {
    S.sock.emit("getProfile", { userId: id }, (r) => {
      if (!r || r.error) return toast((r && r.error) || "Profil introuvable.");
      const p = r.profile; S.prof[p.id] = p;
      const card = el("div", "card pcard"); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Profil de " + p.name);
      card.appendChild(banner(p));
      const av = avatar(p, p.status === "invisible" ? "off" : p.status); av.classList.add("big"); card.appendChild(av);
      const body = el("div", "pbody"), nm = el("div", "pname"); nm.appendChild(el("h2", "", p.name)); const tg = tagFor(p.role); if (tg) nm.appendChild(tg); body.appendChild(nm);
      if (p.custom) body.appendChild(el("div", "pcustom", p.custom));
      if (p.bio) { body.appendChild(el("h3", "", "À propos")); body.appendChild(el("p", "pbio", p.bio)); }
      body.appendChild(el("h3", "", "Membre depuis")); body.appendChild(el("p", "", DATE(p.created)));
      const close = overlay(card);
      if (p.id === S.me.id) { const b = el("button", "btn", "Modifier mon profil"); b.type = "button"; b.onclick = () => { close(); editProfile(); }; body.appendChild(b); }
      else if (p.role !== "bot") { const b = icText(el("button", "btn"), "message", "Envoyer un message"); b.type = "button"; b.onclick = () => { close(); openDm(p.id); }; body.appendChild(b); }
      card.appendChild(body);
    });
  }
  // Recadre et réduit l'image avant l'envoi (la photo fait 256 px, la bannière 960 x 320)
  async function shrink(file, w, h) {
    const bmp = await createImageBitmap(file), cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const k = Math.max(w / bmp.width, h / bmp.height), dw = bmp.width * k, dh = bmp.height * k;
    cv.getContext("2d").drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/webp", 0.9));
    return blob && blob.type === "image/webp" ? blob : await new Promise((ok) => cv.toBlob(ok, "image/png"));
  }
  function editProfile() {
    S.sock.emit("getProfile", { userId: S.me.id }, (r) => {
      if (!r || r.error) return toast("Profil indisponible.");
      let p = r.profile;
      const card = el("div", "card pcard"); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Modifier mon profil");
      const top = el("div"); card.appendChild(top);
      const err = el("div", "err"), body = el("div", "pbody");
      const paint = () => {
        S.prof[p.id] = p; top.innerHTML = ""; top.appendChild(banner(p)); const a = avatar(p); a.classList.add("big"); top.appendChild(a);
        rm1.hidden = !p.avatar; rm2.hidden = !p.banner;
      };
      const file = el("input"); file.type = "file"; file.accept = "image/png,image/jpeg,image/webp,image/gif"; file.hidden = true;
      let kind = null;
      file.onchange = async () => {
        const f = file.files[0]; file.value = ""; if (!f || !kind) return; err.textContent = "";
        try {
          const blob = await shrink(f, kind === "avatar" ? 256 : 960, kind === "avatar" ? 256 : 320);
          const res = await fetch("/api/profile/image?kind=" + kind, { method: "POST", headers: { Authorization: "Bearer " + S.token, "Content-Type": "application/octet-stream" }, body: blob });
          const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || "Envoi impossible.");
          p = { ...p, avatar: d.profile.avatar, banner: d.profile.banner }; paint();
        } catch (e) { err.textContent = e.message && e.message !== "Failed to fetch" ? e.message : "Image illisible ou envoi impossible."; }
      };
      const pick = (k) => { kind = k; file.click(); };
      const remove = async (k) => { await fetch("/api/profile/image?kind=" + k, { method: "DELETE", headers: { Authorization: "Bearer " + S.token } }); p = { ...p, [k]: null }; paint(); };
      const row = el("div", "prow"), mk = (t, fn, ghost, icn) => { const b = el("button", "pbtn" + (ghost ? " ghost" : "")); if (icn) icText(b, icn, t); else b.textContent = t; b.type = "button"; b.onclick = fn; row.appendChild(b); return b; };
      mk("Changer la photo", () => pick("avatar"), false, "camera"); const rm1 = mk("Retirer la photo", () => remove("avatar"), true);
      mk("Changer la bannière", () => pick("banner"), false, "image"); const rm2 = mk("Retirer la bannière", () => remove("banner"), true);
      const l1 = el("label", "", "Statut personnalisé"), i1 = el("input", "field"); i1.maxLength = 60; i1.value = p.custom; i1.placeholder = "Ex. En train de coder 💻"; l1.htmlFor = i1.id = "pf-custom";
      const l2 = el("label", "", "À propos de moi"), i2 = el("textarea", "field"); i2.maxLength = 190; i2.rows = 4; i2.value = p.bio; i2.placeholder = "Parlez de vous en quelques mots"; l2.htmlFor = i2.id = "pf-bio";
      body.append(row, file, l1, i1, l2, i2, err);
      const close = overlay(card);
      const save = el("button", "btn", "Enregistrer"); save.type = "button";
      save.onclick = () => S.sock.emit("setProfile", { bio: i2.value, custom: i1.value }, (x) => { if (x && x.error) err.textContent = x.error; else { close(); toast("Profil mis à jour."); } });
      const cancel = el("button", "btn ghost", "Fermer"); cancel.type = "button"; cancel.onclick = close;
      body.append(save, cancel); card.appendChild(body); paint();
    });
  }
  document.querySelector(".me").addEventListener("click", (e) => { if (e.target.closest("#meAv, .who")) editProfile(); });
  function closeMenu() { const m = $("ctxmenu"); if (m) m.remove(); }
  document.addEventListener("click", closeMenu);
  function openDm(userId) {
    S.sock.emit("openDm", { userId }, (r) => { if (r.error) return toast(r.error); if (!dmOf(r.dm.id)) S.dms.push(r.dm); go("dm", null, r.dm.id); });
  }

  /* ---------- Notifications push ---------- */
  const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  const auth = () => ({ "Content-Type": "application/json", Authorization: "Bearer " + S.token });
  function renderBell() { const b = $("bBell"); const on = S.push || S.local; b.innerHTML = ic(on ? "bell" : "bell-off"); b.title = on ? "Notifications activées (cliquer pour désactiver)" : "Activer les notifications"; b.setAttribute("aria-label", b.title); }
  async function initPush() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return renderBell();
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      S.push = !!sub && Notification.permission === "granted";
      if (S.push) fetch("/api/push/subscribe", { method: "POST", headers: auth(), body: JSON.stringify({ subscription: sub.toJSON() }) }).catch(() => {});
    } catch (e) { S.push = false; }
    renderBell();
  }
  /* Appli de bureau : notifications locales (pas besoin de push serveur) */
  const DESK = !!window.cordialDesktop;
  try { S.local = DESK ? localStorage.getItem("cordial-local") !== "0" : false; } catch (e) { S.local = DESK; }
  function notifyLocal(m) {
    if (!S.local || S.push || !("Notification" in window) || Notification.permission !== "granted") return;
    if (document.hasFocus() && m.channelId === S.cid) return;
    const dm = dmOf(m.channelId), tag = "@" + S.me.name.toLowerCase();
    const mention = (m.text || "").toLowerCase().includes(tag), reply = !!m.reply && m.reply.name === S.me.name;
    if (!dm && !mention && !reply) return;
    try {
      const n = new Notification(dm ? m.user.name : "Mention de " + m.user.name, { body: (m.text || (m.file ? "📎 fichier" : "")).slice(0, 140), tag: "c-" + m.channelId, icon: "/icons/icon-192.png" });
      n.onclick = () => { window.cordialDesktop.focus(); const ch = findChannel(m.channelId); if (ch) go(ch.view, ch.sid, m.channelId); n.close(); };
    } catch (e) { /* ignoré */ }
  }
  function findChannel(cid) {
    if (dmOf(cid)) return { view: "dm", sid: null };
    const s = S.servers.find((x) => x.channels.some((c) => c.id === cid)); return s ? { view: "server", sid: s.id } : null;
  }
  async function enableLocal() {
    if (!("Notification" in window)) return toast("Notifications indisponibles.");
    if ((await Notification.requestPermission()) !== "granted") return toast("Notifications refusées par le système.");
    S.local = true; try { localStorage.setItem("cordial-local", "1"); } catch (e) {} renderBell(); toast("Notifications activées : messages privés, mentions et réponses.");
  }
  function disableLocal() { S.local = false; try { localStorage.setItem("cordial-local", "0"); } catch (e) {} renderBell(); toast("Notifications désactivées."); }
  async function enablePush() {
    if (DESK) return enableLocal();
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return toast(isIOS ? "Sur iPhone, installez d'abord l'application sur l'écran d'accueil (Partager, puis « Sur l'écran d'accueil »)." : "Ce navigateur ne gère pas les notifications.");
    if (!window.isSecureContext) return toast("Les notifications demandent une connexion sécurisée (HTTPS).");
    try {
      if ((await Notification.requestPermission()) !== "granted") return toast("Notifications refusées. Autorisez-les dans les réglages du navigateur.");
      const reg = await navigator.serviceWorker.ready, { key } = await (await fetch("/api/push/key")).json();
      let sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe().catch(() => {});
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: auth(), body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!r.ok) throw new Error("serveur"); S.push = true; toast("Notifications activées : messages privés, mentions et réponses.");
    } catch (e) { toast("Impossible d'activer les notifications sur cet appareil."); }
    renderBell();
  }
  async function disablePush(quiet) {
    try {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (sub) { fetch("/api/push/unsubscribe", { method: "POST", headers: auth(), body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe(); }
    } catch (e) { /* rien à désactiver */ }
    S.push = false; renderBell(); if (!quiet) toast("Notifications désactivées sur cet appareil.");
  }
  $("bBell").onclick = () => (S.local ? disableLocal() : S.push ? disablePush() : enablePush());
  if (DESK && S.local && "Notification" in window && Notification.permission === "default") Notification.requestPermission().then(renderBell);

  /* ---------- Vocal (WebRTC) ---------- */
  function renderVoicePanel() {
    const p = $("vpanel"); p.hidden = !V.cid; if (!V.cid) return;
    const s = S.servers.find((x) => x.id === V.sid), c = s && s.channels.find((x) => x.id === V.cid);
    $("vName").textContent = c ? c.name + " · " + s.name : "";
    const peers = [...V.peers.values()], st = peers.some((x) => x.state === "failed") ? "failed" : !peers.length || peers.every((x) => x.state === "connected") ? "connected" : "connecting";
    p.dataset.state = st; $("vState").textContent = st === "failed" ? "Connexion impossible" : st === "connecting" ? "Connexion…" : "Vocal connecté";
    const sh = $("vShare"); sh.hidden = !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !(window.cordialDesktop && window.cordialDesktop.screenSources);
    sh.innerHTML = ic(V.screen ? "screen-off" : "screen-share"); sh.classList.toggle("on", !!V.screen);
    const cb = $("vCam"); cb.hidden = !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); cb.innerHTML = ic(V.cam ? "video-off" : "video"); cb.classList.toggle("on", !!V.cam); cb.title = cb.ariaLabel = V.cam ? "Couper la caméra" : "Activer la caméra"; sh.title = sh.ariaLabel = V.screen ? "Arrêter le partage d'écran" : "Partager l'écran";
    const mb = $("vMute"); mb.innerHTML = ic(V.muted ? "mic-off" : "mic"); mb.classList.toggle("off", V.muted); mb.title = mb.ariaLabel = V.muted ? "Réactiver le micro" : "Couper le micro";
  }
  async function joinVoice(c) {
    if (V.cid === c.id) return;
    if (!navigator.mediaDevices || !window.isSecureContext) return toast("Le vocal demande une connexion sécurisée (HTTPS) et un micro.");
    if (V.cid) leaveVoice();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
    catch (e) { return toast("Micro inaccessible : autorisez-le dans votre navigateur."); }
    S.sock.emit("voiceJoin", { channelId: c.id }, (r) => {
      if (!r || r.error) { stream.getTracks().forEach((t) => t.stop()); return toast(r ? r.error : "Erreur de connexion."); }
      V.cid = c.id; V.sid = S.sid; V.stream = stream; V.muted = false; V.ice = r.ice || S.ice;
      r.peers.forEach((p) => { makePeer(p.socketId, p.user, true); const pe = V.peers.get(p.socketId); if (pe) pe.vid = { screenId: p.screen ? p.screenId : null, camId: p.cam ? p.camId : null }; });
      startMonitor(); renderSide();
    });
  }
  function makePeer(id, user, initiator) {
    if (V.peers.has(id)) return;
    const pc = new RTCPeerConnection({ iceServers: V.ice });
    // « Négociation parfaite » : en cas de double proposition simultanée, la personne « polie » cède
    const peer = { pc, user, audio: null, analyser: null, queue: [], state: "connecting", live: false, making: false, polite: (S.sock.id || "") < id, snd: { screen: [], cam: [] }, vid: { screenId: null, camId: null } };
    V.peers.set(id, peer);
    V.stream.getTracks().forEach((t) => pc.addTrack(t, V.stream));
    if (V.screen) addVideoTo(peer, "screen"); if (V.cam) addVideoTo(peer, "cam");
    pc.onicecandidate = (e) => { if (e.candidate) S.sock.emit("voiceSignal", { to: id, data: { candidate: e.candidate } }); };
    pc.ontrack = (e) => {
      const st = e.streams[0]; if (!st) return;
      if (e.track.kind === "video" || (e.track.kind === "audio" && peer.audio && st !== peer.audio.srcObject)) { showTile(id + "|" + st.id, id, user, st); return; } // écran partagé ou caméra (image, et son de l'écran)
      if (peer.audio) return;
      const a = el("audio"); a.autoplay = true; a.setAttribute("playsinline", ""); a.srcObject = st; $("audioBox").appendChild(a); peer.audio = a; a.play().catch(() => {});
      peer.analyser = analyserFor(st);
    };
    pc.onconnectionstatechange = () => { peer.state = pc.connectionState; renderVoicePanel(); };
    pc.onsignalingstatechange = () => {
      if (pc.signalingState !== "stable" || peer.live) return;
      peer.live = true; if (peer.snd.screen.length || peer.snd.cam.length) offer(id, peer); // un partage commencé avant la fin de la première négociation
    };
    pc.onnegotiationneeded = () => { if (peer.live) offer(id, peer); };
    if (initiator) pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => S.sock.emit("voiceSignal", { to: id, data: { sdp: pc.localDescription } })).catch(() => { peer.state = "failed"; renderVoicePanel(); });
    renderVoicePanel();
  }
  async function offer(id, peer) {
    try {
      peer.making = true; await peer.pc.setLocalDescription();
      S.sock.emit("voiceSignal", { to: id, data: { sdp: peer.pc.localDescription } });
    } catch (e) { /* une autre proposition est en cours : la négociation reprendra */ } finally { peer.making = false; }
  }
  // Les messages d'un même correspondant sont traités l'un après l'autre (sinon une offre peut croiser une réponse en cours de lecture)
  function onSignal(d) {
    const peer = V.peers.get(d.from); if (!peer) return;
    peer.chain = (peer.chain || Promise.resolve()).then(() => handleSignal(d, peer));
  }
  async function handleSignal(d, peer) {
    try {
      if (d.data.sdp) {
        const pc = peer.pc, desc = d.data.sdp;
        if (desc.type === "offer" && (peer.making || pc.signalingState !== "stable") && !peer.polite) return; // collision : l'autre côté cède
        await pc.setRemoteDescription(desc);
        peer.queue.splice(0).forEach((c) => pc.addIceCandidate(c).catch(() => {}));
        if (desc.type === "offer") { await pc.setLocalDescription(); S.sock.emit("voiceSignal", { to: d.from, data: { sdp: pc.localDescription } }); }
      } else if (d.data.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(d.data.candidate).catch(() => {}); else peer.queue.push(d.data.candidate);
      }
    } catch (e) { peer.state = "failed"; renderVoicePanel(); }
  }
  /* ---------- Partage d'écran ---------- */
  function renderStage() { $("stage").hidden = !$("stage").children.length; }
  // Une vignette par flux vidéo, identifiée par « pair|flux » ; la légende dit s'il s'agit d'un écran ou d'une caméra
  const tileLabel = (t) => {
    if (t.peerId === "me") return t.kind === "cam" ? "Votre caméra" : "Votre écran";
    const v = (V.peers.get(t.peerId) || {}).vid || {}, k = t.streamId === v.camId ? "cam" : t.streamId === v.screenId ? "screen" : null;
    return (k === "cam" ? "Caméra de " : k === "screen" ? "Écran de " : "Vidéo de ") + t.user.name;
  };
  function showTile(key, peerId, user, stream, kind) {
    let t = V.tiles.get(key);
    if (!t) {
      const box = el("div", "tile"), v = el("video"); v.autoplay = true; v.playsInline = true; v.setAttribute("playsinline", ""); if (peerId === "me") v.muted = true;
      const cap = el("span", "cap"), fs = icText(el("button", "full"), "maximize"); fs.type = "button"; fs.title = "Plein écran"; fs.setAttribute("aria-label", "Plein écran");
      fs.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else (box.requestFullscreen || v.requestFullscreen).call(box).catch(() => {}); };
      if (peerId === "me" && kind === "cam") box.classList.add("mirror");
      box.append(v, cap, fs); $("stage").appendChild(box); t = { box, v, cap, peerId, user, streamId: stream.id, kind }; V.tiles.set(key, t);
    }
    t.cap.textContent = tileLabel(t); t.box.classList.toggle("cam", t.cap.textContent.startsWith("Cam") || t.cap.textContent.startsWith("Votre cam"));
    if (t.v.srcObject !== stream) t.v.srcObject = stream; t.v.play().catch(() => {}); renderStage();
  }
  function removeTile(key) { const t = V.tiles.get(key); if (!t) return; t.v.srcObject = null; t.box.remove(); V.tiles.delete(key); renderStage(); }
  // Un correspondant annonce ce qu'il envoie : on met les légendes à jour et on retire ce qui n'est plus diffusé
  function onPeerVideo(id, d) {
    const peer = V.peers.get(id); if (!peer) return;
    peer.vid = { screenId: d.screen ? d.screenId : null, camId: d.cam ? d.camId : null };
    [...V.tiles.entries()].forEach(([key, t]) => {
      if (t.peerId !== id) return;
      if (t.streamId !== peer.vid.screenId && t.streamId !== peer.vid.camId) removeTile(key);
      else { t.cap.textContent = tileLabel(t); t.box.classList.toggle("cam", t.streamId === peer.vid.camId); }
    });
  }
  function addVideoTo(peer, kind) {
    const st = kind === "cam" ? V.cam : V.screen, rate = kind === "cam" ? 700000 : 2500000;
    st.getTracks().forEach((t) => {
      if (t.kind === "video") { try { peer.snd[kind].push(peer.pc.addTransceiver(t, { direction: "sendonly", streams: [st], sendEncodings: [{ maxBitrate: rate }] }).sender); return; } catch (e) { /* ancien navigateur */ } }
      peer.snd[kind].push(peer.pc.addTrack(t, st));
    });
  }
  // Sous Electron, la page demande d'abord à l'application quelle fenêtre ou quel écran partager
  function pickSource() {
    return new Promise(async (done) => {
      let list = []; try { list = await window.cordialDesktop.screenSources(); } catch (e) { /* pas de liste */ }
      if (!list.length) return done(null);
      const card = el("div", "card"); card.appendChild(el("h2", "", "Que voulez-vous partager ?")); const grid = el("div", "srcgrid"); card.appendChild(grid);
      let close; const finish = (id) => { close(); done(id); };
      list.forEach((x) => { const b = el("button", "src"), im = el("img"); im.src = x.thumb; im.alt = ""; b.append(im, el("span", "", x.name)); b.type = "button"; b.onclick = () => finish(x.id); grid.appendChild(b); });
      const no = el("button", "btn ghost", "Annuler"); no.type = "button"; no.onclick = () => finish(null); card.appendChild(no);
      close = overlay(card);
    });
  }
  async function startShare() {
    if (!V.cid || V.screen) return;
    if (window.cordialDesktop && window.cordialDesktop.screenSources) { const id = await pickSource(); if (!id) return; await window.cordialDesktop.selectScreen(id); }
    let st;
    try { st = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, width: { max: 1920 }, height: { max: 1080 } }, audio: true }); }
    catch (e) { return toast("Partage annulé ou refusé."); }
    S.sock.emit("voiceScreen", { on: true, streamId: st.id }, (r) => {
      if (!r || r.error || !V.cid) { st.getTracks().forEach((t) => t.stop()); return toast(r && r.error ? r.error : "Partage impossible."); }
      V.screen = st; const vt = st.getVideoTracks()[0]; if (vt) { try { vt.contentHint = "detail"; } catch (e) {} vt.onended = () => stopShare(); }
      V.peers.forEach((p) => addVideoTo(p, "screen")); showTile("me|screen", "me", S.me, st, "screen"); renderVoicePanel();
    });
  }
  function stopVideo(kind, silent) {
    const st = kind === "cam" ? V.cam : V.screen; if (!st) return;
    if (kind === "cam") V.cam = null; else V.screen = null;
    st.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    V.peers.forEach((p) => { p.snd[kind].forEach((snd) => { try { p.pc.removeTrack(snd); } catch (e) { /* déjà retiré */ } }); p.snd[kind] = []; });
    removeTile("me|" + kind); if (!silent && S.sock && S.sock.connected) S.sock.emit(kind === "cam" ? "voiceCam" : "voiceScreen", { on: false }, () => {}); renderVoicePanel();
  }
  const stopShare = (silent) => stopVideo("screen", silent), stopCam = (silent) => stopVideo("cam", silent);
  async function startCam() {
    if (!V.cid || V.cam) return;
    let st;
    try { st = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }, audio: false }); }
    catch (e) { return toast(e && e.name === "NotFoundError" ? "Aucune caméra détectée." : "Caméra inaccessible : autorisez-la dans votre navigateur."); }
    S.sock.emit("voiceCam", { on: true, streamId: st.id }, (r) => {
      if (!r || r.error || !V.cid) { st.getTracks().forEach((t) => t.stop()); return toast(r && r.error ? r.error : "Caméra impossible."); }
      V.cam = st; const vt = st.getVideoTracks()[0]; if (vt) vt.onended = () => stopCam();
      V.peers.forEach((p) => addVideoTo(p, "cam")); showTile("me|cam", "me", S.me, st, "cam"); renderVoicePanel();
    });
  }
  $("vCam").onclick = () => (V.cam ? stopCam() : startCam());
  $("vShare").onclick = () => (V.screen ? stopShare() : startShare());
  function dropPeer(id) {
    const p = V.peers.get(id); if (!p) return;
    try { p.pc.close(); } catch (e) { /* déjà fermée */ } if (p.audio) p.audio.remove(); [...V.tiles.keys()].filter((k) => k.startsWith(id + "|")).forEach(removeTile); V.peers.delete(id); renderVoicePanel();
  }
  function leaveVoice(silent) {
    if (!V.cid) return;
    if (!silent && S.sock && S.sock.connected) S.sock.emit("voiceLeave");
    stopShare(true); stopCam(true); [...V.peers.keys()].forEach(dropPeer);
    if (V.stream) V.stream.getTracks().forEach((t) => t.stop());
    clearInterval(V.timer); if (V.ctx) { V.ctx.close().catch(() => {}); V.ctx = null; }
    V.cid = null; V.sid = null; V.stream = null; V.local = null; V.muted = false; renderVoicePanel(); renderSide();
  }
  function analyserFor(stream) {
    try {
      V.ctx = V.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const a = V.ctx.createAnalyser(); a.fftSize = 256; V.ctx.createMediaStreamSource(stream).connect(a); return a;
    } catch (e) { return null; }
  }
  function level(a) { if (!a) return 0; const d = new Uint8Array(a.frequencyBinCount); a.getByteFrequencyData(d); return d.reduce((x, y) => x + y, 0) / d.length; }
  function startMonitor() {
    V.local = analyserFor(V.stream); clearInterval(V.timer);
    V.timer = setInterval(() => {
      const on = new Set(); if (!V.muted && level(V.local) > 14) on.add(S.me.id);
      V.peers.forEach((p) => { if (level(p.analyser) > 14) on.add(p.user.id); });
      document.querySelectorAll(".vu").forEach((n) => n.classList.toggle("speaking", on.has(Number(n.dataset.uid))));
    }, 200);
  }
  $("vMute").onclick = () => {
    V.muted = !V.muted; if (V.stream) V.stream.getAudioTracks().forEach((t) => { t.enabled = !V.muted; });
    S.sock.emit("voiceMute", { muted: V.muted }); renderVoicePanel();
  };
  $("vLeave").onclick = () => leaveVoice();
  window.addEventListener("beforeunload", () => { if (V.cid && S.sock) S.sock.emit("voiceLeave"); });

  /* ---------- Divers ---------- */
  function renderAll() { renderRail(); renderSide(); renderMe(); renderTop(); renderMembers(); renderMsgs(true); renderReply(); renderPanel(); renderVoicePanel(); }
  $("bNav").onclick = () => $("app").classList.add("nav");
  $("bMem").onclick = () => { const o = $("mem").classList.toggle("open"); $("app").classList.toggle("mems", o); };
  $("scrim").onclick = closeDrawers;
  $("announce").onclick = function () { this.hidden = true; };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeMenu(); hideCmds(); $("emo").classList.remove("open");
    if (S.editing) { S.editing = null; renderMsgs(); } else if (S.panel) { S.panel = null; renderPanel(); } else if (S.reply) { S.reply = null; renderReply(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (S.sock && S.sock.connected) S.sock.emit("visibility", { visible: !document.hidden });
    if (!document.hidden) { S.pendingTitle = 0; updateTitle(); }
  });
  if ("serviceWorker" in navigator) window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
  const saved = store("cordial-token"); if (saved) connect(saved); else showAuth();
})();
