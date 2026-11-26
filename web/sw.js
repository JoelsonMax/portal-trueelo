// Service worker mínimo: permite instalar o portal como aplicativo.
// Não guarda dados dos clientes em cache — tudo vem sempre do servidor.
const SHELL = 'trueelo-shell-v7';
const ASSETS = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/config.js', 'js/marketing.js', 'js/tracking.js', 'assets/logo-simbolo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro; o cache só entra se estiver sem internet (e só para os arquivos do próprio site).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
