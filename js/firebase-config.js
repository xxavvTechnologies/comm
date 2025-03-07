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
    const app = firebase.initializeApp(firebaseConfig);
    
    // Initialize Realtime Database first for presence system
    window.rtdb = firebase.database();
    window.rtdb.goOnline();
    
    // Then initialize other services
    window.db = firebase.firestore();
    window.auth = firebase.auth();
    
    // Initialize providers
    window.googleProvider = new firebase.auth.GoogleAuthProvider();
    window.githubProvider = new firebase.auth.GithubAuthProvider();

    // Initialize messaging
    if ('Notification' in window && firebase.messaging.isSupported()) {
        window.messaging = firebase.messaging();
        window.messaging.onMessage((payload) => {
            console.log('Received message:', payload);
        });
    }

    // Configure Firestore settings with rate limiting
    window.db.settings({
        cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
        merge: true,
        ignoreUndefinedProperties: true
    });

    // Add rate limiting metadata
    window.db.rateLimit = {
        maxWritesPerHour: 20000, // Adjust based on your Firebase plan
        currentWrites: 0,
        lastReset: Date.now(),
        
        checkLimit() {
            const now = Date.now();
            if (now - this.lastReset > 3600000) { // 1 hour
                this.currentWrites = 0;
                this.lastReset = now;
            }
            return this.currentWrites < this.maxWritesPerHour;
        },
        
        incrementWrites() {
            this.currentWrites++;
        }
    };

    // Add connection state handler
    window.rtdb.ref('.info/connected').on('value', (snapshot) => {
        if (snapshot.val() === true) {
            console.log('Connected to Realtime Database');
        } else {
            console.log('Disconnected from Realtime Database');
        }
    });

} catch (error) {
    console.error("Error initializing Firebase services:", error);
}
