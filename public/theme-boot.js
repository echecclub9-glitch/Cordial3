/* Applique le thème choisi avant l'affichage (évite un flash de la mauvaise couleur). Chargé dans <head>. */
(function () {
  var META = { galaxie: "#0b0828", sombre: "#2b2d31", clair: "#ffffff", minuit: "#000000", foret: "#14251c", ocean: "#0d2331", crepuscule: "#2b1a23" };
  function resolve(t) { if (t === "auto") return window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "clair" : "sombre"; return META[t] ? t : "galaxie"; }
  function apply(t) {
    var r = resolve(t); document.documentElement.setAttribute("data-theme", r);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", META[r]);
  }
  var saved = "galaxie"; try { saved = localStorage.getItem("cordial-theme") || "galaxie"; } catch (e) {}
  apply(saved);
  window.cordialTheme = { apply: apply, get: function () { return saved; }, set: function (t) { saved = t; try { localStorage.setItem("cordial-theme", t); } catch (e) {} apply(t); } };
  if (window.matchMedia) matchMedia("(prefers-color-scheme: light)").addEventListener("change", function () { if (saved === "auto") apply("auto"); });
})();
