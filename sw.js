// ── ARKA Service Worker ──
// Strategy:
//   - App shell (HTML, fonts, CDN libs) → Cache-first, network fallback
//   - Firebase API calls → Network-only (always fresh)
//   - Everything else → Stale-while-revalidate

const CACHE_NAME = 'arka-v1';
const OFFLINE_URL = '/';

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Roboto:wght@300;400;500&family=Roboto+Mono:wght@400;500&display=swap',
  // Lucide icons
  'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js',
  // SheetJS
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  // jsPDF
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
];

// Domains that should ALWAYS go to network (Firebase)
const NETWORK_ONLY_ORIGINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.gstatic.com',
];

// ── INSTALL ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Pre-cache one at a time so a single CDN failure doesn't break install
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err => console.warn('SW precache skip:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE_NAME)
            .map(k => {
              console.log('SW deleting old cache:', k);
              return caches.delete(k);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── FETCH ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // 1. Network-only for Firebase/Google APIs
  if (NETWORK_ONLY_ORIGINS.some(origin => url.hostname.includes(origin))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. For the main HTML document → Network-first, cache fallback (ensures fresh app shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(OFFLINE_URL).then(cached => cached || offlinePage())
        )
    );
    return;
  }

  // 3. CDN assets (fonts, scripts) → Cache-first, network fallback
  if (
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached || new Response('', { status: 503 }));
      })
    );
    return;
  }

  // 4. Everything else → Stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const networkFetch = fetch(request).then(response => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});

// ── OFFLINE FALLBACK PAGE ──
function offlinePage() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARKA — Offline</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Google Sans',Roboto,sans-serif;height:100vh;display:flex;align-items:center;justify-content:center;background:#F8F9FF;color:#1A1B20;text-align:center;padding:24px}
  .wrap{max-width:340px}
  .icon{width:64px;height:64px;background:#E8F0FE;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:28px}
  h1{font-size:22px;font-weight:700;margin-bottom:8px}
  p{font-size:14px;color:#74777F;line-height:1.6;margin-bottom:24px}
  button{padding:11px 28px;background:#1A73E8;color:#fff;border:none;border-radius:24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
  button:hover{background:#1557B0}
</style>
</head>
<body>
<div class="wrap">
  <div class="icon">⚡</div>
  <h1>You're offline</h1>
  <p>ARKA needs an internet connection to sync your workspace data with Firebase. Please check your connection and try again.</p>
  <button onclick="location.reload()">Try Again</button>
</div>
</body>
</html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ── BACKGROUND SYNC (optional, for future offline queuing) ──
self.addEventListener('sync', event => {
  if (event.tag === 'arka-sync') {
    console.log('SW background sync triggered');
  }
});

// ── PUSH NOTIFICATIONS (stub for future use) ──
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'ARKA', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});
