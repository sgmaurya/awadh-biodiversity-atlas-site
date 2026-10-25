var CORE = 'atlas-core-202610251139', PAGES = 'atlas-pages';
var SHELL = ['./', 'all/', 'about/', 'find/', 'learn/', 'apart/', 'visitors/', 'use/', 'offline.html',
  'assets/atlas.css', 'assets/atlas.js', 'assets/search.json', 'assets/find.json', 'manifest.webmanifest', 'assets/icon-192.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CORE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('atlas-core-') === 0 && k !== CORE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  var isAsset = /\.(jpe?g|png|css|js|json|webmanifest)$/i.test(url.pathname);
  if (isAsset) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(PAGES).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
  } else {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(PAGES).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('offline.html'); });
    }));
  }
});
