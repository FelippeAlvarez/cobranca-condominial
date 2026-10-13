/*
  Service worker: permite instalar o app e abri-lo mesmo com a internet instável.
  Busca primeiro na rede (para receber as atualizações na hora) e usa a cópia guardada se a rede falhar.
  Só guarda os arquivos do próprio app; os dados ficam na pasta escolhida e os índices vêm do Banco Central.
*/
const CACHE = 'cobranca-condominial-v1';
const ARQUIVOS = [
  './', './index.html', './estilo.css', './icone.svg', './manifest.webmanifest',
  './util.js', './armazenamento.js', './indices.js', './calculo.js', './xlsx.js', './pdf.js', './relatorios.js', './importar.js', './app.js',
  './lib/jspdf.umd.min.js', './icones/icone-192.png', './icones/icone-512.png', './icones/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
