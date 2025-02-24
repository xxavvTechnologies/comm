const firebaseConfig = {
    apiKey: "AIzaSyAeNLHp2EO50B0PrZuBchOJvxhxHlVuVu4",
    authDomain: "novasuite-e4257.firebaseapp.com",
    projectId: "novasuite-e4257",
    storageBucket: "novasuite-e4257.firebasestorage.app",
    messagingSenderId: "349176160657",
    appId: "1:349176160657:web:f55144faa713f8b2f63a30",
    measurementId: "G-N7LX5DG7MJ"
};

// Initialize Firebase immediately
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Initialize services
try {
    window.auth = firebase.auth();
    window.db = firebase.firestore();

    // Initialize authentication providers
    window.googleProvider = new firebase.auth.GoogleAuthProvider();
    window.githubProvider = new firebase.auth.GithubAuthProvider();
    
    // Initialize Firestore settings
    window.db.settings({
        cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
        merge: true
    });

    // Initialize messaging only after auth
    auth.onAuthStateChanged(async (user) => {
        if (user && 'Notification' in window) {
            try {
                window.messaging = firebase.messaging();
                
                // Request permission first
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    // Get messaging token
                    const currentToken = await messaging.getToken({
                        vapidKey: "BPWrmBMmcobYJJEpDHviOANGFu2IrGFCZsZBS3LD_KzgpHAKqQYVvAorJ8ZFVJYvnRYGKvP1FQT7oPBwceuXc"
                    });

                    if (currentToken) {
                        // Save the token to the user's profile
                        await db.collection('users').doc(user.uid).update({
                            fcmToken: currentToken,
                            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }
            } catch (error) {
                console.error("Messaging setup error:", error);
            }
        }
    });

    console.log('Firebase services initialized successfully');
} catch (error) {
    console.error("Error initializing Firebase services:", error);
}
