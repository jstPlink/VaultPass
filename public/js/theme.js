// Tema dell'app: si applica subito, prima del disegno della pagina (per evitare lampi di
// colore), quindi questo file e' caricato nell'<head>. La scelta resta solo su questo dispositivo.
(function () {
  var KEY = 'vaultpass_theme';
  var THEMES = ['auto', 'light', 'dark', 'blue'];
  // Colore della barra del browser e schema dei controlli nativi, per ogni tema.
  var BAR = { light: '#f2f3f7', dark: '#121212', blue: '#0e1320' };
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function stored() {
    try {
      var value = localStorage.getItem(KEY);
      return THEMES.indexOf(value) === -1 ? 'dark' : value;
    } catch (e) {
      return 'dark';
    }
  }

  function apply(choice) {
    var theme = choice === 'auto' ? (media && media.matches ? 'light' : 'dark') : choice;
    root.setAttribute('data-theme', theme);
    var bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute('content', BAR[theme]);
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', theme === 'light' ? 'light' : 'dark');
  }

  window.VaultPassTheme = {
    get: stored,
    set: function (choice) {
      if (THEMES.indexOf(choice) === -1) return;
      try { localStorage.setItem(KEY, choice); } catch (e) {}
      apply(choice);
    },
  };

  apply(stored());
  // "Automatico" segue il sistema anche se cambia mentre l'app e' aperta.
  if (media && media.addEventListener) {
    media.addEventListener('change', function () { if (stored() === 'auto') apply('auto'); });
  }
})();
