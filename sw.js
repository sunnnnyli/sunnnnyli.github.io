// Keeps a copy of the site so repeat visits load fast and it still opens offline.
// Pages, styles, and scripts come from the network first, so a new deploy shows up right away; the saved copy is
// only used when the network is slow or gone. Fonts and images come straight from the saved copy and refresh
// in the background. Changing VERSION clears everything saved before.
const VERSION = 'v1';
const CACHE = `sunnyli-${VERSION}`;
const CORE = [
    './',
    './resume.html',
    './404.html',
    './assets/css/styles.css',
    './assets/css/resume.css',
    './assets/js/main.js',
    './assets/js/resume.js',
    './assets/fonts/newsreader-latin.woff2',
    './assets/fonts/newsreader-italic-latin.woff2',
    './assets/fonts/newsreader-pinyin.woff2',
    './assets/fonts/instrument-sans-latin.woff2',
    './assets/fonts/jetbrains-mono-latin.woff2',
    './assets/fonts/ma-shan-zheng-proverb.woff2',
    './assets/img/grain-light.png',
    './assets/img/grain-dark.png',
    './assets/icons/favicon.svg',
];
const SLOW = 3500; // ms to wait on the network before falling back to the saved copy

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sunnyli-') && k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

const save = (cache, request, response) => {
    if (response.status === 200 && response.type === 'basic') cache.put(request, response.clone()).catch(() => {});
    return response;
};

const networkFirst = async (request) => {
    const cache = await caches.open(CACHE);
    const network = fetch(request).then((res) => save(cache, request, res));
    network.catch(() => {});
    try {
        return await Promise.race([network, new Promise((resolve, reject) => setTimeout(() => reject(new Error('slow')), SLOW))]);
    } catch (err) {
        const saved = (await cache.match(request, { ignoreSearch: true }))
            || (request.mode === 'navigate' ? await cache.match('./') : undefined);
        return saved || network; // nothing saved yet: keep waiting on the network
    }
};

const savedFirst = async (request, event) => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(request);
    const network = fetch(request).then((res) => save(cache, request, res));
    if (saved) {
        event.waitUntil(network.catch(() => {}));
        return saved;
    }
    return network;
};

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || request.headers.has('range')) return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (/\.(woff2|png|jpe?g|webp|svg|ico)$/.test(url.pathname)) event.respondWith(savedFirst(request, event));
    else event.respondWith(networkFirst(request));
});
