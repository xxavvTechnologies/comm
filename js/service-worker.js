const CACHE_NAME = 'nova-comm-v1';
const STATIC_RESOURCES = [
    '/',
    '/index.html',
    '/chat.html',
    '/css/style.css',
    '/css/styleb.css',
    '/css/stylec.css',
    '/css/styled.css',
    '/js/chat.js',
    '/js/firebase-config.js',
    'https://cdn.jsdelivr.net/npm/remixicon@3.5.0/fonts/remixicon.css',
    'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Inter:wght@400;500;600&display=swap'
];

// Install event - cache static resources
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_RESOURCES))
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        })
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', event => {
    // Skip non-GET requests and Firebase requests
    if (
        event.request.method !== 'GET' ||
        event.request.url.includes('firestore.googleapis.com') ||
        event.request.url.includes('www.googleapis.com')
    ) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Clone response for caching
                const responseClone = response.clone();
                caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, responseClone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

// Handle push notifications
self.addEventListener('push', event => {
    const options = {
        body: event.data.text(),
        icon: '/img/icons/icon-192.png',
        badge: '/img/icons/badge-96.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        }
    };

    event.waitUntil(
        self.registration.showNotification('Nova Comm', options)
    );
});
