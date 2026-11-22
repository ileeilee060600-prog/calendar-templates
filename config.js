// Build-time configuration, shared by the service worker and the options page.
// clientId: the project's own Google OAuth client (type "Web application"). Its authorized
// redirect URIs must include https://<extension-id>.chromiumapp.org/ for every extension ID
// that uses it (the unpacked dev copy and the Chrome Web Store item).
// Users can still enter their own client in Options > Advanced.
(function (root) {
  root.CT_CONFIG = {
    clientId: '1084065828839-9eloenht4plvgla6lftiqqsr7m0q8tea.apps.googleusercontent.com',
    site: 'https://ileeilee060600-prog.github.io/calendar-templates/',
    privacy: 'https://ileeilee060600-prog.github.io/calendar-templates/privacy.html'
  };
})(typeof self !== 'undefined' ? self : globalThis);
