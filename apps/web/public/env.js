// Runtime configuration, read by core/config/runtime-env.ts before the app boots.
//
// NOT bundled into the JS - a static asset loaded by a plain <script> in index.html. In the
// desktop app the shell generates this file itself (apiBaseUrl is always empty there: the window
// talks to the API through the app:// protocol).
window.__DR_ENV__ = {
  // Empty = same origin; the dev server proxies /api to :3333 (proxy.conf.json).
  apiBaseUrl: '',
};
