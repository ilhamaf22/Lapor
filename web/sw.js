// Service worker Lapor Kinerja
// - Tampilan aplikasi diambil dari cache HP → terbuka instan, juga saat offline / sinyal lemah.
// - Di latar belakang file diperbarui dari server, jadi versi baru terpakai pada pembukaan berikutnya.
// - Data (Supabase, Gemini, Google) tidak pernah di-cache di sini; data offline disimpan aplikasi di IndexedDB.
const CACHE = 'lapor-kinerja-v3';
const ASET = ['./', './index.html', './dashboard.html', './config.js', './css/app.css', './manifest.webmanifest',
  './vendor/supabase.js', './js/catat.js', './js/dashboard.js', './js/db.js', './js/util.js', './js/klasifikasi.js',
  './js/icons.js', './js/skp-default.js', './js/skp-parser.js', './js/ekspor.js',
  './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASET)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('lapor-kinerja-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function perbarui(req, cache) {
  return fetch(req).then(res => {
    if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) cache.put(req, res.clone());
    return res;
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/supabase\.co$|^(generativelanguage|www|oauth2)\.googleapis\.com$|^accounts\.google\.com$/.test(url.host)) return;

  // File aplikasi sendiri: stale-while-revalidate (langsung dari cache, perbarui diam-diam)
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = perbarui(req, cache).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }));
    return;
  }

  // Font & library CDN: cache-first
  if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host)) {
    e.respondWith(caches.open(CACHE).then(async cache => (await cache.match(req)) || perbarui(req, cache)));
  }
});

// Background Sync: saat sinyal kembali, bangunkan halaman yang terbuka untuk mengirim antrean
self.addEventListener('sync', e => {
  if (e.tag !== 'lapor-sinkron') return;
  e.waitUntil(self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(cs => cs.forEach(c => c.postMessage('sinkron'))));
});
