document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Initialize UI elements
        const loginForm = document.getElementById('loginForm');
        const googleBtn = document.getElementById('googleLogin');
        const githubBtn = document.getElementById('githubLogin');
        const termsCheckbox = document.getElementById('terms');
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
            
            if (!termsCheckbox?.checked) {
                alert('Please agree to the Terms of Service');
                return;
            }

            setLoading(true);
            
            try {
                const email = document.getElementById('email')?.value;
                const password = document.getElementById('password')?.value;

                await auth.signInWithEmailAndPassword(email, password);
                window.location.href = 'chat.html';
            } catch (error) {
                console.error("Login error:", error);
                alert(error.message || 'Login failed');
                setLoading(false);
            }
        });

        // Social logins
        const socialLogin = async (provider) => {
            setLoading(true);
            try {
                const result = await auth.signInWithPopup(provider);
                
                // Update user profile in main users collection
                await db.collection('users').doc(result.user.uid).set({
                    email: result.user.email,
                    displayName: result.user.displayName || result.user.email,
                    photoURL: result.user.photoURL,
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'online'
                }, { merge: true }); // Use merge to preserve existing user data

                window.location.href = 'chat.html';
            } catch (error) {
                console.error("Social login error:", error);
                alert(error.message || 'Login failed');
                setLoading(false);
            }
        };

        // Google login
        googleBtn?.addEventListener('click', () => socialLogin(googleProvider));

        // GitHub login
        githubBtn?.addEventListener('click', () => socialLogin(githubProvider));

        // Check existing session
        auth.onAuthStateChanged((user) => {
            if (user) {
                window.location.href = 'chat.html';
            }
        });

    } catch (error) {
        console.error("Login initialization error:", error);
    }
});