document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Wait for Firebase to initialize
        if (!window.auth) {
            throw new Error('Firebase Auth not initialized');
        }

        // Initialize UI elements
        const loginForm = document.getElementById('loginForm');
        const googleBtn = document.getElementById('googleLogin');
        const githubBtn = document.getElementById('githubLogin');
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        
        // Show loading state
        function setLoading(isLoading) {
            const buttons = [submitBtn, googleBtn, githubBtn];
            buttons.forEach(btn => {
                if (btn) {
                    btn.disabled = isLoading;
                    btn.style.opacity = isLoading ? '0.7' : '1';
                }
            });
        }

        // Handle form submission
        loginForm?.addEventListener('submit', async function(e) {
            e.preventDefault();
            setLoading(true);
            
            try {
                const email = document.getElementById('email')?.value;
                const password = document.getElementById('password')?.value;

                await auth.signInWithEmailAndPassword(email, password);
                window.location.href = 'chat.html';
            } catch (error) {
                console.error("Login error:", error);
                if (error.code === 'auth/user-not-found') {
                    window.location.href = 'https://account.nova.xxavvgroup.com';
                } else {
                    alert(error.message || 'Login failed. Please try again.');
                }
                setLoading(false);
            }
        });

        // Social login handler
        const socialLogin = async (provider) => {
            setLoading(true);
            try {
                const result = await auth.signInWithPopup(provider);
                
                // Update user status
                await db.collection('users').doc(result.user.uid).set({
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'online'
                }, { merge: true });

                window.location.href = 'chat.html';
            } catch (error) {
                console.error("Social login error:", error);
                alert(error.message || 'Login failed');
                setLoading(false);
            }
        };

        // Social login buttons
        googleBtn?.addEventListener('click', () => socialLogin(googleProvider));
        githubBtn?.addEventListener('click', () => socialLogin(githubProvider));

        // Check existing session
        auth.onAuthStateChanged((user) => {
            if (user) {
                window.location.href = 'chat.html';
            }
        });

    } catch (error) {
        console.error("Login initialization error:", error);
        alert('Unable to initialize login. Please refresh the page.');
    }
});