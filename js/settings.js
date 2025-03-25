window.addEventListener('load', async function() {
    // Add loading state first
    function setLoading(loading) {
        document.body.classList.toggle('loading', loading);
    }

    // Helper function to wait for Firebase services
    async function waitForFirebase() {
        const services = ['auth', 'db']; // Removed storage from required services
        const maxAttempts = 10;
        const backoffMs = 500;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const missing = services.filter(service => !window[service]);
            
            if (missing.length === 0) {
                return true; // All services available
            }
            
            console.log(`Waiting for Firebase services: ${missing.join(', ')}. Attempt ${attempt + 1}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, backoffMs * Math.pow(2, attempt)));
        }
        
        throw new Error(`Firebase services not initialized after ${maxAttempts} attempts`);
    }

    try {
        setLoading(true);
        await waitForFirebase();

        // Rest of the settings initialization
        const profilePicture = document.getElementById('profilePicture');
        const displayName = document.getElementById('displayName');
        const email = document.getElementById('email');
        const changeAvatar = document.getElementById('changeAvatar');
        const logoutButton = document.getElementById('logoutButton');
        const messageNotifications = document.getElementById('messageNotifications');
        const soundEnabled = document.getElementById('soundEnabled');
        const readReceipts = document.getElementById('readReceipts');
        const onlineStatus = document.getElementById('onlineStatus');
        
        let currentUser = null;

        // Show loading state
        function setLoading(loading) {
            document.body.style.opacity = loading ? '0.7' : '1';
            document.body.style.pointerEvents = loading ? 'none' : 'auto';
        }

        // Load user settings
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                currentUser = user;
                setLoading(true);
                try {
                    // Load user profile
                    const userDoc = await db.collection('users').doc(user.uid).get();
                    const userData = userDoc.data() || {};
                    
                    // Update UI with user data
                    profilePicture.src = userData.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
                    displayName.value = userData.displayName || '';
                    email.value = user.email || '';

                    // Load preferences
                    const prefsDoc = await db.collection('userPreferences').doc(user.uid).get();
                    const prefs = prefsDoc.data() || {};
                    
                    // Set toggle states
                    messageNotifications.checked = prefs.messageNotifications ?? true;
                    soundEnabled.checked = prefs.soundEnabled ?? true;
                    readReceipts.checked = prefs.readReceipts ?? true;
                    onlineStatus.checked = prefs.onlineStatus ?? true;
                    
                } catch (error) {
                    console.error('Error loading settings:', error);
                    alert('Failed to load settings');
                }
                setLoading(false);
            } else {
                window.location.href = 'index.html';
            }
        });

        // Handle avatar change
        changeAvatar?.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    setLoading(true);
                    const url = await uploadUserAvatar(file);
                    await updateUserProfile({ photoURL: url });
                    profilePicture.src = url;
                } catch (error) {
                    console.error('Error updating avatar:', error);
                    alert('Failed to update profile picture');
                }
                setLoading(false);
            };
            input.click();
        });

        // Handle display name changes with debounce
        let nameTimeout;
        displayName?.addEventListener('input', () => {
            clearTimeout(nameTimeout);
            nameTimeout = setTimeout(async () => {
                try {
                    setLoading(true);
                    await updateUserProfile({ displayName: displayName.value });
                } catch (error) {
                    console.error('Error updating display name:', error);
                    alert('Failed to update display name');
                }
                setLoading(false);
            }, 500);
        });

        // Handle preference toggles
        const toggles = [messageNotifications, soundEnabled, readReceipts, onlineStatus];
        toggles.forEach(toggle => {
            toggle?.addEventListener('change', async () => {
                try {
                    setLoading(true);
                    await updateUserPreferences({
                        messageNotifications: messageNotifications.checked,
                        soundEnabled: soundEnabled.checked,
                        readReceipts: readReceipts.checked,
                        onlineStatus: onlineStatus.checked
                    });
                } catch (error) {
                    console.error('Error updating preferences:', error);
                    alert('Failed to update preferences');
                    // Revert toggle state
                    toggle.checked = !toggle.checked;
                }
                setLoading(false);
            });
        });

        // Handle logout
        logoutButton?.addEventListener('click', async () => {
            try {
                setLoading(true);
                // Update user status to offline
                if (currentUser) {
                    await db.collection('users').doc(currentUser.uid).update({
                        status: 'offline',
                        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
                await auth.signOut();
                window.location.href = 'index.html';
            } catch (error) {
                console.error('Error signing out:', error);
                alert('Failed to sign out');
                setLoading(false);
            }
        });
    } catch (error) {
        console.error('Settings initialization error:', error);
        alert('Failed to initialize Firebase services. Please refresh the page.');
    } finally {
        setLoading(false);
    }
});

// Helper function to upload avatar
async function uploadUserAvatar(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('No file selected'));
            return;
        }

        // Validate file size (max 2MB)
        if (file.size > 2 * 1024 * 1024) {
            reject(new Error('Image too large. Maximum size is 2MB.'));
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const base64String = e.target.result;
                const user = auth.currentUser;
                
                // Update user profile with base64 image
                await db.collection('users').doc(user.uid).update({
                    photoURL: base64String,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // Update auth profile
                await auth.currentUser.updateProfile({
                    photoURL: base64String
                });

                resolve(base64String);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
}

// Helper function to update user profile
async function updateUserProfile(updates) {
    if (!auth.currentUser) throw new Error('No user logged in');

    try {
        // Update Firestore user document
        await db.collection('users').doc(auth.currentUser.uid).update({
            ...updates,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // If updating display name or photo, update auth profile too
        if (updates.displayName || updates.photoURL) {
            await auth.currentUser.updateProfile({
                displayName: updates.displayName,
                photoURL: updates.photoURL
            });
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        throw new Error('Failed to update profile');
    }
}

// Helper function to update user preferences
async function updateUserPreferences(prefs) {
    if (!auth.currentUser) throw new Error('No user logged in');

    try {
        await db.collection('userPreferences').doc(auth.currentUser.uid).set({
            ...prefs,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // If online status changed, update user document
        if ('onlineStatus' in prefs) {
            await db.collection('users').doc(auth.currentUser.uid).update({
                status: prefs.onlineStatus ? 'online' : 'offline',
                lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (error) {
        console.error('Error updating preferences:', error);
        throw new Error('Failed to update preferences');
    }
}
