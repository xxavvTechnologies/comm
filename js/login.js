document.addEventListener('DOMContentLoaded', function() {
    // Check if auth and providers are available
    if (!window.auth || !window.googleProvider || !window.githubProvider) {
        console.error('Firebase auth or providers not initialized');
        return;
    }

    const loginForm = document.getElementById('loginForm');
    
    // Email/Password Login
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const terms = document.getElementById('terms').checked;
        
        if (!terms) {
            alert('Please agree to the Terms of Service');
            return;
        }
        
        try {
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            window.location.href = 'chat.html';
        } catch (error) {
            console.error("Login error:", error);
            alert(`Login failed: ${error.message}`);
        }
    });

    // Google Login
    document.getElementById('googleLogin').addEventListener('click', async () => {
        try {
            await auth.signInWithPopup(googleProvider);
            window.location.href = 'chat.html';
        } catch (error) {
            console.error("Google sign-in error:", error);
            alert(`Login failed: ${error.message}`);
        }
    });

    // GitHub Login
    document.getElementById('githubLogin').addEventListener('click', async () => {
        try {
            await auth.signInWithPopup(githubProvider);
            window.location.href = 'chat.html';
        } catch (error) {
            console.error("GitHub sign-in error:", error);
            alert(`Login failed: ${error.message}`);
        }
    });

    // Check existing auth state
    auth.onAuthStateChanged((user) => {
        if (user) {
            window.location.href = 'chat.html';
        }
    });
});