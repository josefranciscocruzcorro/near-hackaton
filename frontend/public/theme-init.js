// Applies the saved theme/language before first paint (no flash). Loaded as a classic, blocking
// script from <head> so it works under a strict CSP (script-src 'self'). Keep in sync with
// src/lib/theme.tsx and src/i18n/index.tsx.
(function () {
  try {
    var pref = localStorage.getItem('tesorero.theme');
    var dark =
      pref === 'dark' ||
      ((pref === null || pref === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    if (localStorage.getItem('tesorero.lang') === 'es') document.documentElement.lang = 'es';
  } catch (e) {
    // Storage unavailable: fall back to defaults.
  }
})();
