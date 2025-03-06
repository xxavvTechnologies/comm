const firebaseConfig = {
    apiKey: "AIzaSyAeNLHp2EO50B0PrZuBchOJvxhxHlVuVu4",
    authDomain: "novasuite-e4257.firebaseapp.com",
    projectId: "novasuite-e4257",
    storageBucket: "novasuite-e4257.firebasestorage.app",
    messagingSenderId: "349176160657",
    appId: "1:349176160657:web:f55144faa713f8b2f63a30",
    measurementId: "G-N7LX5DG7MJ"
};

// Initialize Firebase
try {
    const app = firebase.initializeApp(firebaseConfig);
    window.db = firebase.firestore();
    window.auth = firebase.auth();
    
    // Initialize providers
    window.googleProvider = new firebase.auth.GoogleAuthProvider();
    window.githubProvider = new firebase.auth.GithubAuthProvider();

    // Optional: Initialize messaging if available
    if ('Notification' in window && firebase.messaging) {
        window.messaging = firebase.messaging();
    }

    // Configure Firestore with proper settings
    window.db.settings({
        cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
        merge: true,
        cache: {
            enablePersistence: true,
            tabSynchronization: 'LOCAL'
        }
    });

} catch (error) {
    console.error("Error initializing Firebase services:", error);
}
