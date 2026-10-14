// Review page for clients without any code on their site. Everything it needs
// travels in the URL fragment, which browsers never send to a server.
(function () {
  var params = new URLSearchParams(location.hash.slice(1));
  var project = params.get('project');
  var token = params.get('token');
  var site = params.get('site');
  var valid = /^[0-9a-f-]{36}$/.test(project || '') && /^[A-Za-z0-9_-]{20,200}$/.test(token || '');
  var siteUrl = null;
  try {
    siteUrl = site ? new URL(site) : null;
    if (siteUrl && siteUrl.protocol !== 'https:' && siteUrl.protocol !== 'http:') siteUrl = null;
  } catch {
    siteUrl = null;
  }
  if (!valid) {
    document.getElementById('review-steps').hidden = true;
    document.getElementById('review-error').hidden = false;
    return;
  }

  // The bookmarklet loads the widget on whatever page is open. Its settings
  // ride in the script URL's fragment, so they never reach an access log.
  // Always this instance's own widget, never an address read from the link:
  // a crafted link must not turn the bookmark into someone else's script.
  var src = location.origin + '/widget.js#project=' + project + '&token=' + token;
  var code =
    "(function(){if(document.querySelector('reviewdesk-widget'))return;" +
    "var s=document.createElement('script');s.src='" + src + "';document.body.appendChild(s);})();";
  var bookmarklet = document.getElementById('bookmarklet');
  bookmarklet.setAttribute('href', 'javascript:' + code);
  // Clicking it here would do nothing useful (and the page's policy forbids
  // it): the gesture to teach is dragging.
  bookmarklet.addEventListener('click', function (event) {
    event.preventDefault();
    var hint = document.getElementById('bookmarklet-hint');
    hint.textContent = 'Glissez le bouton dans la barre de favoris plutôt que de cliquer dessus.';
    hint.classList.add('nudge');
  });

  if (/Mac|iPhone|iPad/.test(navigator.userAgent)) document.getElementById('shortcut').textContent = '⌘';

  var link = document.getElementById('site-link');
  if (siteUrl) {
    link.href = siteUrl.href;
    document.getElementById('site-text').textContent = siteUrl.host + ' s’ouvre dans un nouvel onglet.';
    document.getElementById('review-title').textContent = 'Relisez ' + siteUrl.host;
    document.title = 'Relecture de ' + siteUrl.host;
  } else {
    link.hidden = true;
    document.getElementById('site-text').textContent = 'Ouvrez le site comme d’habitude.';
  }

  // The instance's own name, when it has one.
  fetch('/api/branding')
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (branding) {
      if (branding && branding.productName) document.getElementById('review-product').textContent = branding.productName;
    })
    .catch(function () {});
})();
