document.addEventListener('DOMContentLoaded', function() {
    if (!window.auth || !window.db || !window.storage) {
        console.error('Firebase services not initialized');
        return;
    }

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
});

// Helper function to upload avatar
async function uploadUserAvatar(file) {
    if (!file || !window.storage) return null;

    try {
        // Validate file size (max 2MB)
        if (file.size > 2 * 1024 * 1024) {
            throw new Error('Image too large. Maximum size is 2MB.');
        }

        // Create a storage reference
        const user = auth.currentUser;
        const storageRef = storage.ref(`avatars/${user.uid}/${Date.now()}_${file.name}`);
        
        // Upload file
        const snapshot = await storageRef.put(file);
        
        // Get download URL
        const url = await snapshot.ref.getDownloadURL();
        return url;
    } catch (error) {
        console.error('Error uploading avatar:', error);
        throw new Error('Failed to upload image');
    }
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
