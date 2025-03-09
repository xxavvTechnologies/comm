const firebaseConfig = {
    apiKey: "AIzaSyAeNLHp2EO50B0PrZuBchOJvxhxHlVuVu4",
    authDomain: "novasuite-e4257.firebaseapp.com",
    databaseURL: "https://novasuite-e4257-default-rtdb.firebaseio.com",
    projectId: "novasuite-e4257",
    storageBucket: "novasuite-e4257.firebasestorage.app",
    messagingSenderId: "349176160657",
    appId: "1:349176160657:web:f55144faa713f8b2f63a30",
    measurementId: "G-N7LX5DG7MJ"
};

// Initialize Firebase
try {
    // Initialize the Firebase app first
    const app = firebase.initializeApp(firebaseConfig);
    
    // Initialize services and make them globally available
    window.db = firebase.firestore();
    window.auth = firebase.auth();
    window.googleProvider = new firebase.auth.GoogleAuthProvider();
    window.githubProvider = new firebase.auth.GithubAuthProvider();

    // Initialize Firebase Messaging
    if (firebase.messaging && 'serviceWorker' in navigator) {
        window.messaging = firebase.messaging();
        window.messaging.onMessage((payload) => {
            console.log('Foreground message:', payload);
            // Handle foreground messages here
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification(payload.notification.title, {
                    body: payload.notification.body,
                    icon: '/img/icons/icon-192.png'
                });
            }
        });
    }

    // Initialize Realtime Database only if the SDK is loaded
    if (firebase.database) {
        window.rtdb = firebase.database();
        window.rtdb.goOnline();

        // Add connection state handler
        window.rtdb.ref('.info/connected').on('value', (snapshot) => {
            if (snapshot.val() === true) {
                console.log('Connected to Realtime Database');
            } else {
                console.log('Disconnected from Realtime Database');
            }
        });
    }

    // Configure auth persistence
    window.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    // Add auth state listener
    window.auth.onAuthStateChanged(user => {
        if (user) {
            window.db.collection('users').doc(user.uid).set({
                email: user.email,
                displayName: user.displayName || user.email,
                photoURL: user.photoURL,
                lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'online'
            }, { merge: true });
        }
    });

    // Configure Firestore settings
    window.db.settings({
        cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
        merge: true,
        ignoreUndefinedProperties: true
    });

} catch (error) {
    console.error("Error initializing Firebase services:", error);
}
