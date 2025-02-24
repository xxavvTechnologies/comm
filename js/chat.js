document.addEventListener('DOMContentLoaded', function() {
    // Ensure Firebase is initialized
    if (!window.db || !window.auth) {
        console.error('Firebase services not initialized');
        return;
    }

    // Add near the top of the file, with other declarations
    let isFirebaseInitialized = false;

    // DOM Elements with null checks
    const messageArea = document.getElementById('messageArea');
    const messageInput = document.querySelector('.message-input input');
    const sendButton = document.querySelector('.message-input button');
    const searchPane = document.getElementById('searchPane');
    const newChatBtn = document.getElementById('newChatBtn');
    const closeSearchBtn = document.getElementById('closeSearchBtn');
    const userSearchInput = document.getElementById('userSearchInput');
    const searchResults = document.getElementById('searchResults');
    const contactsList = document.querySelector('.contacts-list');
    
    let currentUser = null;
    let currentChat = null;
    let messageUnsubscribe = null;

    // Initialize UI
    const defaultAvatar = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y&s=64';
    document.querySelectorAll('.avatar').forEach(img => {
        img.src = defaultAvatar;
    });

    // Search functionality
    if (userSearchInput) {
        userSearchInput.addEventListener('input', debounce(handleSearch, 300));
    }

    // Button handlers with null checks
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            if (searchPane) searchPane.classList.add('active');
            if (userSearchInput) userSearchInput.focus();
        });
    }

    if (closeSearchBtn) {
        closeSearchBtn.addEventListener('click', () => {
            if (searchPane) searchPane.classList.remove('active');
            if (userSearchInput) userSearchInput.value = '';
            if (searchResults) searchResults.innerHTML = '';
        });
    }

    // Add search input with null check
    const searchInput = document.querySelector('.contacts-search input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(handleSearch, 300));
    }

    // Update search functionality
    async function handleSearch(e) {
        const searchTerm = e.target.value.toLowerCase().trim();
        const searchResults = document.getElementById('searchResults');
        searchResults.innerHTML = '';

        if (!searchTerm) return;

        try {
            const usersQuery = await db.collection('users')
                .where('email', '>=', searchTerm)
                .where('email', '<=', searchTerm + '\uf8ff')
                .limit(10)
                .get();

            usersQuery.docs.forEach(doc => {
                if (doc.id !== currentUser.uid) {
                    const userData = doc.data();
                    const resultDiv = document.createElement('div');
                    resultDiv.className = 'search-result-item';
                    resultDiv.innerHTML = `
                        <img src="${userData.photoURL || defaultAvatar}" alt="${userData.email}" class="avatar">
                        <div class="user-info">
                            <div class="contact-name">${userData.displayName || userData.email}</div>
                            <div class="last-message">${userData.status || 'Available'}</div>
                        </div>
                    `;
                    resultDiv.onclick = () => {
                        startChat(doc.id);
                        document.getElementById('searchPane').classList.remove('active');
                    };
                    searchResults.appendChild(resultDiv);
                }
            });

            if (!searchResults.children.length) {
                searchResults.innerHTML = '<div class="no-results">No users found</div>';
            }
        } catch (error) {
            console.error("Error searching users:", error);
        }
    }

    function addContactToList(userData, userId) {
        const contactDiv = document.createElement('div');
        contactDiv.className = 'contact';
        contactDiv.innerHTML = `
            <img src="${userData.photoURL || defaultAvatar}" alt="${userData.email}" class="avatar">
            <div class="contact-info">
                <span class="contact-name">${userData.displayName || userData.email}</span>
                <span class="last-message">Click to start chatting</span>
            </div>
        `;
        contactDiv.onclick = () => startChat(userId);
        document.querySelector('.contacts-list').appendChild(contactDiv);
    }

    // Update the auth state change handler
    auth.onAuthStateChanged((user) => {
        if (user) {
            currentUser = user;
            isFirebaseInitialized = true;
            setupMessaging();
            // Don't load messages until a chat is selected
            loadRecentContacts();
        } else {
            window.location.href = 'index.html';
        }
    });

    // Update the loadMessages function
    function loadMessages(chatId) {
        try {
            // Check initialization and chatId
            if (!isFirebaseInitialized) {
                console.log("Waiting for Firebase to initialize...");
                return;
            }

            if (!chatId) {
                console.log("No chat selected yet");
                return;
            }

            // Unsubscribe from previous listener if it exists
            if (messageUnsubscribe) {
                messageUnsubscribe();
            }

            // Clear existing messages
            const messageArea = document.getElementById('messageArea');
            if (messageArea) {
                messageArea.innerHTML = '';
            }

            // Set up new listener with error handling
            messageUnsubscribe = db.collection('messages')
                .where('chatId', '==', chatId)
                .orderBy('timestamp', 'desc')
                .limit(50)
                .onSnapshot((snapshot) => {
                    const changes = snapshot.docChanges().reverse();
                    
                    changes.forEach((change) => {
                        if (change.type === 'added') {
                            const message = change.doc.data();
                            if (message.timestamp) {
                                const messageId = change.doc.id;
                                // Only display if we haven't shown this message yet
                                if (!document.getElementById(messageId)) {
                                    displayMessage(message, messageId);
                                }
                            }
                        }
                    });

                    // Scroll to bottom after loading messages
                    if (messageArea && changes.length > 0) {
                        messageArea.scrollTop = messageArea.scrollHeight;
                    }
                }, (error) => {
                    console.error("Error loading messages:", error);
                });

        } catch (error) {
            console.error("Error in loadMessages:", error);
        }
    }

    // Update the displayMessage function to include message ID
    function displayMessage(message, messageId) {
        const messageDiv = document.createElement('div');
        messageDiv.id = messageId; // Add ID to prevent duplication
        messageDiv.className = `message ${message.userId === currentUser.uid ? 'sent' : 'received'}`;
        messageDiv.innerHTML = `
            <div class="message-content">
                ${message.text}
            </div>
        `;
        messageArea.appendChild(messageDiv);
    }

    // Send message
    async function sendMessage() {
        const message = messageInput.value.trim();
        if (message) {
            try {
                await db.collection('messages').add({
                    text: message,
                    userId: currentUser.uid,
                    chatId: currentChat,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    userEmail: currentUser.email
                });
                messageInput.value = '';
            } catch (error) {
                console.error("Error sending message: ", error);
            }
        }
    }

    // Setup push notifications
    async function setupMessaging() {
        try {
            if (!('Notification' in window)) {
                console.log('This browser does not support notifications');
                return;
            }
    
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log('Notification permission not granted');
                return;
            }
    
            if (!window.messaging) {
                console.error('Firebase messaging not initialized');
                return;
            }
    
            // Get token only if we have messaging and permission
            const token = await window.messaging.getToken({
                vapidKey: "BIYJYMvPjag4l00oGUWRfFe5AVRHmgu0MBUs7_mCV1V2siT1U6_LpUj1aVqVd6bUdBAp6FbzWhjpY8JpyfetqPM",
                serviceWorkerRegistration: await navigator.serviceWorker.getRegistration()
            });
    
            if (token && currentUser) {
                await db.collection('users').doc(currentUser.uid).set({
                    email: currentUser.email,
                    displayName: currentUser.displayName || currentUser.email,
                    photoURL: currentUser.photoURL,
                    notificationToken: token,
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
    
            // Handle foreground messages
            messaging.onMessage((payload) => {
                console.log('Received foreground message:', payload);
                // Add your notification display logic here
            });
    
        } catch (error) {
            console.error("Error setting up notifications:", error);
        }
    }

    // Event listeners
    if (sendButton && messageInput) {
        sendButton.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }

    // Load contacts
    db.collection('users').onSnapshot((snapshot) => {
        const contactsList = document.querySelector('.contacts-list');
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' && change.doc.id !== currentUser.uid) {
                const userData = change.doc.data();
                const contactDiv = document.createElement('div');
                contactDiv.className = 'contact';
                contactDiv.innerHTML = `
                    <img src="${userData.photoURL || defaultAvatar}" alt="${userData.email}" class="avatar">
                    <div class="contact-info">
                        <span class="contact-name">${userData.email}</span>
                        <span class="last-message">Click to start chatting</span>
                    </div>
                `;
                contactDiv.onclick = () => startChat(change.doc.id);
                contactsList.appendChild(contactDiv);
            }
        });
    });

    async function loadRecentContacts() {
        try {
            const contactsList = document.querySelector('.contacts-list');
            contactsList.innerHTML = '';

            // Get users who have recent messages with current user
            const recentChats = await db.collection('messages')
                .where('participants', 'array-contains', currentUser.uid)
                .orderBy('timestamp', 'desc')
                .limit(10)
                .get();

            const uniqueUsers = new Set();
            recentChats.docs.forEach(doc => {
                const data = doc.data();
                const otherUserId = data.participants.find(id => id !== currentUser.uid);
                if (otherUserId) uniqueUsers.add(otherUserId);
            });

            // Fetch user details for recent contacts
            for (const userId of uniqueUsers) {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    addContactToList(userDoc.data(), userId);
                }
            }
        } catch (error) {
            console.error("Error loading recent contacts:", error);
        }
    }

    // Debounce helper function
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Update startChat function
    async function startChat(userId) {
        try {
            const otherUser = await db.collection('users').doc(userId).get();
            if (!otherUser.exists) return;

            const userData = otherUser.data();
            const chatId = [currentUser.uid, userId].sort().join('_');
            
            // Set current chat and load messages
            currentChat = chatId;
            loadMessages(chatId);

            // Update chat header
            const chatHeader = document.querySelector('.chat-header .user-info');
            if (chatHeader) {
                chatHeader.innerHTML = `
                    <img src="${userData.photoURL || defaultAvatar}" alt="${userData.email}" class="avatar">
                    <div class="user-details">
                        <span class="username">${userData.displayName || userData.email}</span>
                        <span class="status">${userData.status || 'Available'}</span>
                    </div>
                `;
            }

            // Update active state in contacts list
            document.querySelectorAll('.contact').forEach(el => el.classList.remove('active'));
            const contactElement = Array.from(document.querySelectorAll('.contact')).find(el => 
                el.dataset.userId === userId);
            if (contactElement) {
                contactElement.classList.add('active');
            }
        } catch (error) {
            console.error("Error starting chat:", error);
        }
    }

    // Add click-outside handler for search pane
    document.addEventListener('click', (e) => {
        const searchPane = document.getElementById('searchPane');
        const newChatBtn = document.getElementById('newChatBtn');
        
        if (!searchPane.contains(e.target) && e.target !== newChatBtn) {
            searchPane.classList.remove('active');
        }
    });

    // Clean up on page unload
    window.addEventListener('unload', () => {
        if (messageUnsubscribe) {
            messageUnsubscribe();
        }
    });
});
