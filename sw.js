// Le service worker garde une copie de l'appli sur le téléphone pour qu'elle marche sans connexion.
// Tes dépenses ne passent jamais par ici : elles sont dans IndexedDB, sur l'appareil.

// À changer si tu ajoutes, renommes ou retires un fichier de la liste ci-dessous.
const CACHE = 'carnet-v1';

const FICHIERS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/dexie.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'fonts/atkinson-hyperlegible-latin-400-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  'fonts/bricolage-grotesque-latin-600-normal.woff2',
  'fonts/bricolage-grotesque-latin-800-normal.woff2',
  'fonts/jetbrains-mono-latin-400-normal.woff2',
  'fonts/jetbrains-mono-latin-600-normal.woff2',
];

// À l'installation : on enregistre tous les fichiers de l'appli.
self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FICHIERS))
      .then(() => self.skipWaiting())
  );
});

// À l'activation : on efface les copies d'une ancienne version.
self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((nom) => nom !== CACHE).map((nom) => caches.delete(nom))))
      .then(() => self.clients.claim())
  );
});

// À chaque fichier demandé : on essaie d'abord Internet pour avoir la dernière version,
// puis la copie du téléphone s'il n'y a pas de connexion.
self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET' || new URL(requete.url).origin !== self.location.origin) return;

  evenement.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          evenement.waitUntil(caches.open(CACHE).then((cache) => cache.put(requete, copie)));
        }
        return reponse;
      })
      .catch(async () => {
        const copie = await caches.match(requete);
        if (copie) return copie;
        if (requete.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      })
  );
});
