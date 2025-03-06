const testNotifications = (enabled = true) => {
    if (!enabled) return;

    // Test every minute
    setInterval(() => {
        if ('Notification' in window) {
            const notification = new Notification('Test Notification', {
                body: `Test message sent at ${new Date().toLocaleTimeString()}`,
                icon: '/img/icon-192.png'
            });

            console.log('Test notification sent');
        }
    }, 60000);

    // Also test immediately
    new Notification('Test Notification Started', {
        body: 'Notification testing is now active',
        icon: '/img/icon-192.png'
    });
};
