/* Jeu d'icônes de Cordial : traits fins, couleur héritée du texte (currentColor). */
(function () {
  const S = (d) => d;
  const slash = '<path d="M4 4l16 16"/>';
  const IC = {
    "screen-share": S('<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 21h8M12 16.5V21"/><path d="M12 13V7.5M9.5 10l2.5-2.5 2.5 2.5"/>'),
    "screen-off": S('<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 21h8M12 16.5V21"/>' + slash),
    mic: S('<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7"/>'),
    "mic-off": S('<path d="M9 9V5.5a3 3 0 0 1 5.6-1.5M15 10v1a3 3 0 0 1-4.5 2.6"/><path d="M5 11a7 7 0 0 0 11.2 5.6M19 11a7 7 0 0 1-.6 2.8M12 18v3.5M8.5 21.5h7"/>' + slash),
    "phone-off": S('<path d="M10.7 13.3a16 16 0 0 0 3.6 2.7l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3 5.4 2 2 0 0 1 5 3.2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L9 10.1"/>' + slash),
    bell: S('<path d="M6 9a6 6 0 0 1 12 0c0 6.5 3 8.5 3 8.5H3S6 15.5 6 9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>'),
    "bell-off": S('<path d="M8.5 4.6A6 6 0 0 1 18 9c0 2 .3 3.7 .8 5M6 9c0 6.5-3 8.5-3 8.500h13.5"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>' + slash),
    menu: S('<path d="M4 6.500h16M4 12h16M4 17.500h16"/>'),
    search: S('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.9-4.9"/>'),
    pin: S('<path d="M12 16.500V22"/><path d="M8.5 3h7l-1 6 3.5 3.500V15H6v-2.500L9.5 9z"/>'),
    users: S('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.8"/><path d="M17.5 14.500A5.5 5.5 0 0 1 21.5 20"/>'),
    paperclip: S('<path d="m20.5 11-8.7 8.700a5.5 5.5 0 0 1-7.8-7.800l8.7-8.700a3.7 3.7 0 0 1 5.2 5.200l-8.7 8.700a1.8 1.8 0 0 1-2.6-2.600L14.8 6.5"/>'),
    smile: S('<circle cx="12" cy="12" r="9.5"/><path d="M8 14s1.5 2.5 4 2.5 4-2.5 4-2.5"/><path d="M9 9.500h.01M15 9.500h.01"/>'),
    message: S('<path d="M21 11.500a8.5 8.5 0 0 1-12.3 7.600L3 21l1.9-5.400A8.5 8.5 0 1 1 21 11.500z"/><path d="M8.5 11.500h.01M12 11.500h.01M15.5 11.500h.01"/>'),
    volume: S('<path d="M11 5 6.5 9H3v6h3.500L11 19z"/><path d="M15.5 8.500a5 5 0 0 1 0 7M18.5 5.500a9 9 0 0 1 0 13"/>'),
    sliders: S('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
    reply: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>'),
    edit: S('<path d="M4 20h4L19.5 8.500l-4-4L4 16z"/><path d="m13 7 4 4"/>'),
    flag: S('<path d="M5 21V4"/><path d="M5 4h13l-2.5 4.500L18 13H5"/>'),
    trash: S('<path d="M4 7h16M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13M9 7V4h6v3"/>'),
    maximize: S('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    "log-out": S('<path d="M10 21H5V3h5"/><path d="m16 8 4 4-4 4M20 12H9"/>'),
    camera: S('<path d="M3.5 8H7l1.8-3h6.400L17 8h3.500v12h-17z"/><circle cx="12" cy="13.5" r="3.5"/>'),
    image: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    check: S('<path d="m5 12.5 4.5 4.500L19 7.5"/>'),
    user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    shield: S('<path d="M12 3 4.5 6v5.500c0 4.7 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.8 7.5-9.500V6z"/>'),
    power: S('<path d="M12 3v8.500"/><path d="M6.500 6.500a8 8 0 1 0 11 0"/>'),
    play: S('<path d="M7 4.500v15l12-7.500z"/>'),
    pause: S('<path d="M8 5v14M16 5v14"/>'),
    video: S('<rect x="2.500" y="6" width="13" height="12" rx="2"/><path d="m15.500 10.500 6-3.500v10l-6-3.500"/>'),
    "video-off": S('<path d="M15.500 14.500V8a2 2 0 0 0-2-2H8M2.500 8v8a2 2 0 0 0 2 2h9"/><path d="m15.500 10.500 6-3.500v10l-3-1.700"/><path d="M4 4l16 16"/>'),
    x: S('<path d="M6 6l12 12M18 6 6 18"/>'),
    lock: S('<rect x="5" y="10.500" width="14" height="10" rx="2"/><path d="M8 10.500V8a4 4 0 0 1 8 0v2.500"/>'),
    ban: S('<circle cx="12" cy="12" r="9"/><path d="m5.600 5.600 12.800 12.800"/>'),
    alert: S('<path d="M12 4 2.500 20h19z"/><path d="M12 10v4.500M12 17.500v.01"/>'),
    timer: S('<circle cx="12" cy="13.500" r="7.500"/><path d="M12 9.500v4l2.500 1.500M9.500 3h5"/>'),
    history: S('<path d="M4 12a8 8 0 1 0 2.500-5.800L4 8.500"/><path d="M4 4v4.500h4.500M12 8v4.500l3 1.500"/>'),
  };
  window.IC = IC;
  window.ic = (name, size) => (IC[name] ? '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (size ? ' width="' + size + '" height="' + size + '"' : "") + ">" + IC[name] + "</svg>" : "");
  // Icône suivie d'un texte (le texte reste du texte : aucune injection possible)
  window.icText = (node, name, text) => { node.innerHTML = window.ic(name); if (text) node.appendChild(document.createTextNode(" " + text)); return node; };
  const apply = () => document.querySelectorAll("[data-ic]").forEach((n) => { n.innerHTML = window.ic(n.dataset.ic); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
