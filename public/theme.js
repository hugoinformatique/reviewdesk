// Loaded from <head> and kept as its own file on purpose: the admin serves
// `script-src 'self'`, so an inline boot script would be blocked by CSP and the
// shell would flash the wrong theme before admin.js runs at the end of <body>.
(function () {
  try {
    var theme = localStorage.getItem('reviewdesk-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch {
    // Private mode or blocked storage: fall back to the OS preference.
  }
})();
