const u = document.getElementById("u"), e = document.getElementById("e"), b = document.getElementById("b");
u.value = new URLSearchParams(location.search).get("url") || "";
document.getElementById("f").onsubmit = async (ev) => {
  ev.preventDefault(); e.textContent = ""; b.disabled = true; b.textContent = "Vérification…";
  const r = await window.cordialDesktop.saveServer(u.value);
  if (r && r.error) { e.textContent = r.error; b.disabled = false; b.textContent = "Se connecter"; }
};
