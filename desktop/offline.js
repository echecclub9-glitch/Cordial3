document.getElementById("u").textContent = new URLSearchParams(location.search).get("url") || "";
document.getElementById("r").onclick = () => window.cordialDesktop.retry();
document.getElementById("c").onclick = () => window.cordialDesktop.changeServer();
