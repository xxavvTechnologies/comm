self.addEventListener('push', event => {
    const data = event.data.json();
    const options = {
        body: data.notification.body,
        icon: 'https://d2zcpib8duehag.cloudfront.net/Nova%20Comm.png',
        badge: 'https://d2zcpib8duehag.cloudfront.net/Nova%20Comm.png',
        tag: data.data.messageId || 'general',
        data: {
            url: data.data.url,
            messageId: data.data.messageId,
            chatId: data.data.chatId
        },
        vibrate: [100, 50, 100],
        actions: [
            {
                action: 'reply',
                title: 'Reply',
                icon: '/img/icons/reply-32.png'
            },
            {
                action: 'close',
                title: 'Close',
                icon: '/img/icons/close-32.png'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.notification.title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'reply') {
        // Open chat in reply mode
        const chatUrl = `/chat.html?chat=${event.notification.data.chatId}&reply=${event.notification.data.messageId}`;
        event.waitUntil(clients.openWindow(chatUrl));
    } else {
        // Just open the chat
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(windowClients => {
                // Check if there is already a window/tab open with the target URL
                for (let client of windowClients) {
                    if (client.url === event.notification.data.url && 'focus' in client) {
                        return client.focus();
                    }
                }
                // If no window/tab is open, open a new one
                if (clients.openWindow) {
                    return clients.openWindow(event.notification.data.url);
                }
            })
        );
    }
});