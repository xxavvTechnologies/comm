document.addEventListener('DOMContentLoaded', function() {
    // Add debounce function at the top
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Ensure Firebase is initialized
    if (!window.db || !window.auth) {
        console.error('Firebase services not initialized');
        return;
    }

    // Global declarations
    let isFirebaseInitialized = false;
    let typingTimeout;
    let typingRef;
    let unreadCounts = new Map();
    let currentChats = new Set();
    let isRecording = false;
    let mediaRecorder = null;  // Only declare once here
    let audioChunks = [];
    let currentUser = null;
    let currentChat = null;
    let messageUnsubscribe = null;
    let recordingTimer = null;
    let recordingStartTime = null;

    // Add new function near the top with other declarations
    function updateReadStatus(messageId, readStatus) {
        return db.collection('messages').doc(messageId).update({
            readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
            readAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

    // Add write queue management
    const writeQueue = {
        operations: [],
        isProcessing: false,
        batchSize: 10,
        batchDelay: 5000, // 5 seconds between batches

        add(operation) {
            this.operations.push(operation);
            if (!this.isProcessing) {
                this.processBatch();
            }
        },

        async processBatch() {
            if (this.operations.length === 0) {
                this.isProcessing = false;
                return;
            }

            this.isProcessing = true;
            const batch = this.operations.slice(0, this.batchSize);
            
            try {
                const writeBatch = db.batch();
                batch.forEach(op => {
                    const { ref, data } = op;
                    writeBatch.update(ref, data);
                });
                
                await writeBatch.commit();
                
                // Remove processed operations
                this.operations = this.operations.slice(this.batchSize);
                
                // Process next batch after delay
                setTimeout(() => this.processBatch(), this.batchDelay);
            } catch (error) {
                console.error('Error processing write batch:', error);
                // On error, wait longer before retrying
                setTimeout(() => this.processBatch(), this.batchDelay * 2);
            }
        }
    };

    // Update the read status function to use queue
    async function updateReadStatus(messageId, readStatus) {
        try {
            const messageRef = db.collection('messages').doc(messageId);
            writeQueue.add({
                ref: messageRef,
                data: {
                    readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
                    readAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            });
            await updateUnreadCounts();
        } catch (error) {
            console.error('Error queueing read status update:', error);
        }
    }

    // Add read receipt manager near the top with other declarations
    const readReceiptManager = {
        localCache: new Set(),
        pendingUpdates: new Map(),
        batchTimeout: null,
        retryCount: 0,
        maxRetries: 3,

        markAsRead(messageId) {
            if (this.localCache.has(messageId)) return;
            
            this.localCache.add(messageId);
            this.pendingUpdates.set(messageId, Date.now());
            this.scheduleBatch();
        },

        scheduleBatch() {
            if (this.batchTimeout) return;
            
            this.batchTimeout = setTimeout(() => {
                this.processBatch();
            }, this.getBackoffDelay());
        },

        async processBatch() {
            if (this.pendingUpdates.size === 0) {
                this.batchTimeout = null;
                return;
            }

            const batch = db.batch();
            const updates = Array.from(this.pendingUpdates.entries())
                .slice(0, 10); // Process max 10 at a time

            updates.forEach(([messageId]) => {
                const ref = db.collection('messages').doc(messageId);
                batch.update(ref, {
                    readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
                    readAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });

            try {
                await batch.commit();
                // Clear successful updates
                updates.forEach(([messageId]) => {
                    this.pendingUpdates.delete(messageId);
                });
                this.retryCount = 0;
            } catch (error) {
                console.error('Error updating read receipts:', error);
                this.retryCount++;
                if (this.retryCount < this.maxRetries) {
                    setTimeout(() => this.scheduleBatch(), this.getBackoffDelay());
                }
            }

            this.batchTimeout = null;
            if (this.pendingUpdates.size > 0) {
                this.scheduleBatch();
            }
        },

        getBackoffDelay() {
            return Math.min(1000 * Math.pow(2, this.retryCount), 30000);
        }
    };

    // Update the read status function to use the manager
    function updateReadStatus(messageId) {
        readReceiptManager.markAsRead(messageId);
    }

    // DOM Elements with null checks
    const messageArea = document.getElementById('messageArea');
    const messageInput = document.querySelector('.message-input textarea');
    const sendButton = document.querySelector('.message-input button');
    const searchPane = document.getElementById('searchPane');
    const newChatBtn = document.getElementById('newChatBtn');
    const closeSearchBtn = document.getElementById('closeSearchBtn');
    const userSearchInput = document.getElementById('userSearchInput');
    const searchResults = document.getElementById('searchResults');
    const contactsList = document.querySelector('.contacts-list');
    const menuToggle = document.getElementById('menuToggle');
    const contactsSidebar = document.querySelector('.contacts-sidebar');
    const loadingOverlay = document.querySelector('.loading-overlay');
    
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

    // Add loading state management
    function showLoading() {
        loadingOverlay.classList.add('active');
    }
    function hideLoading() {
        loadingOverlay.classList.remove('active');
    }

    // Update the message input state
    function updateMessageInputState(enabled) {
        if (messageInput) {
            messageInput.disabled = !enabled;
            messageInput.placeholder = enabled ? "Type a message..." : "Select a chat to start messaging";
        }
        if (sendButton) {
            sendButton.disabled = !enabled;
        }
    }

    // Update user status tracking to use main users collection
    let userStatusRef = null;
    function setupUserStatus() {
        if (!currentUser) return;
        
        // References
        const userStatusFirestoreRef = db.collection('users').doc(currentUser.uid);
        const userStatusDatabaseRef = firebase.database().ref('/status/' + currentUser.uid);

        const isOfflineForDatabase = {
            state: 'offline',
            last_changed: firebase.database.ServerValue.TIMESTAMP,
        };

        const isOnlineForDatabase = {
            state: 'online',
            last_changed: firebase.database.ServerValue.TIMESTAMP,
        };

        const isOfflineForFirestore = {
            status: 'offline',
            lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        };

        const isOnlineForFirestore = {
            status: 'online',
            lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        };

        // Create a reference to the special '.info/connected' path
        const connectionRef = firebase.database().ref('.info/connected');

        // When the client's connection state changes...
        connectionRef.on('value', async (snapshot) => {
            if (snapshot.val() === false) {
                // Instead of waiting for disconnect, update Firestore immediately
                await userStatusFirestoreRef.update(isOfflineForFirestore);
                return;
            }

            try {
                // When we lose connection, update the Realtime Database
                await userStatusDatabaseRef.onDisconnect().set(isOfflineForDatabase);
                
                // Update both databases to show we're online
                await Promise.all([
                    userStatusDatabaseRef.set(isOnlineForDatabase),
                    userStatusFirestoreRef.update(isOnlineForFirestore)
                ]);
            } catch (error) {
                console.error('Error setting up presence:', error);
            }
        });

        // Handle tab visibility changes
        document.addEventListener('visibilitychange', async () => {
            try {
                const updates = document.visibilityState === 'hidden' 
                    ? [
                        userStatusDatabaseRef.set(isOfflineForDatabase),
                        userStatusFirestoreRef.update(isOfflineForFirestore)
                    ]
                    : [
                        userStatusDatabaseRef.set(isOnlineForDatabase),
                        userStatusFirestoreRef.update(isOnlineForFirestore)
                    ];
                
                await Promise.all(updates);
            } catch (error) {
                console.error('Error updating presence:', error);
            }
        });

        // Handle page unload
        window.addEventListener('beforeunload', async () => {
            try {
                await Promise.all([
                    userStatusDatabaseRef.set(isOfflineForDatabase),
                    userStatusFirestoreRef.update(isOfflineForFirestore)
                ]);
            } catch (error) {
                console.error('Error updating presence:', error);
            }
        });
    }

    // Update typing handler to use debounce and queue
    function handleTyping() {
        if (!currentChat || !typingRef || !currentUser) return;
        
        const setTypingStatus = debounce(async () => {
            try {
                await typingRef.set({
                    [currentUser.uid]: {
                        typing: true,
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    }
                }, { merge: true });
            } catch (error) {
                console.error('Error updating typing status:', error);
            }
        }, 300);

        setTypingStatus();
        
        // Clear previous timeout
        clearTimeout(typingTimeout);

        // Stop typing after 1.5 seconds of no input
        typingTimeout = setTimeout(async () => {
            if (typingRef && currentUser) {
                try {
                    await typingRef.set({
                        [currentUser.uid]: {
                            typing: false,
                            timestamp: firebase.firestore.FieldValue.serverTimestamp()
                        }
                    }, { merge: true });
                } catch (error) {
                    console.error('Error updating typing status:', error);
                }
            }
            
            // Hide self typing indicator
            updateSelfTypingIndicator(false);
        }, 1500);
    }

    // Add self typing indicator function
    function updateSelfTypingIndicator(isTyping) {
        let selfIndicator = document.querySelector('.self-typing-indicator');
        
        if (isTyping) {
            if (!selfIndicator) {
                selfIndicator = document.createElement('div');
                selfIndicator.className = 'self-typing-indicator';
                selfIndicator.innerHTML = 'Other user can see that you are typing...';
                document.querySelector('.message-input').prepend(selfIndicator);
            }
        } else {
            selfIndicator?.remove();
        }
    }

    // Update search functionality to use main users collection
    async function handleSearch(e) {
        const searchTerm = e.target.value.trim();
        const searchResults = document.getElementById('searchResults');
        searchResults.innerHTML = '';

        // Only proceed if input is a valid email address
        const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(searchTerm);
        
        if (!isValidEmail) {
            searchResults.innerHTML = '<div class="no-results">Please enter a complete email address</div>';
            return;
        }

        try {
            const usersQuery = await db.collection('users')
                .where('email', '==', searchTerm)  // Changed from range query to exact match
                .limit(1)  // Changed to limit 1 since email should be unique
                .get();

            if (usersQuery.empty) {
                searchResults.innerHTML = '<div class="no-results">No user found with this email address</div>';
                return;
            }

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
        } catch (error) {
            console.error("Error searching users:", error);
            searchResults.innerHTML = '<div class="no-results">An error occurred while searching</div>';
        }
    }

    // Update contact display with last message and time
    function addContactToList(userData, userId) {
        const contactDiv = document.createElement('div');
        contactDiv.className = 'contact';
        contactDiv.dataset.userId = userId;
        
        const lastSeen = userData.lastSeen ? formatLastSeen(userData.lastSeen.toDate()) : 'Offline';
        const status = userData.status === 'online' ? '<span class="status-badge online">Online</span>' : lastSeen;

        contactDiv.innerHTML = `
            <div class="avatar-container">
                <img src="${userData.photoURL || defaultAvatar}" alt="${userData.email}" class="avatar">
                <span class="status-indicator ${userData.status === 'online' ? 'online' : ''}"></span>
            </div>
            <div class="contact-info">
                <div class="contact-header">
                    <span class="contact-name">${userData.displayName || userData.email}</span>
                    <span class="last-time">${status}</span>
                </div>
                <span class="last-message">Click to start chatting</span>
            </div>
        `;
        
        contactDiv.onclick = () => startChat(userId);
        document.querySelector('.contacts-list').appendChild(contactDiv);

        // Update last message if exists
        updateLastMessage(userId);
    }

    // Format timestamp
    function formatLastSeen(date) {
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        return date.toLocaleDateString();
    }

    // Update last message for a contact
    async function updateLastMessage(userId) {
        const chatId = [currentUser.uid, userId].sort().join('_');
        const lastMessage = await db.collection('messages')
            .where('chatId', '==', chatId)
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

        if (!lastMessage.empty) {
            const messageData = lastMessage.docs[0].data();
            const contactDiv = document.querySelector(`.contact[data-user-id="${userId}"]`);
            if (contactDiv) {
                const lastMessageEl = contactDiv.querySelector('.last-message');
                if (lastMessageEl) {
                    lastMessageEl.textContent = messageData.text.substring(0, 30) + (messageData.text.length > 30 ? '...' : '');
                }
            }
        }
    }

    // Add empty state handler
    function updateEmptyState() {
        const contactsList = document.querySelector('.contacts-list');
        const noChats = document.querySelector('.no-chats');
        
        if (contactsList.children.length === 0) {
            noChats.style.display = 'flex';
        } else {
            noChats.style.display = 'none';
        }
    }

    // Update the auth state change handler
    auth.onAuthStateChanged((user) => {
        if (user) {
            currentUser = user;
            isFirebaseInitialized = true;
            setupMessaging();
            setupUserStatus();
            setupUnreadListener();
            // Don't load messages until a chat is selected
            loadRecentContacts();
            initializeGlobalSearch();
        } else {
            window.location.href = 'index.html';
        }
    });

    // Update the loadMessages function to better handle message updates
    function loadMessages(chatId) {
        try {
            if (!isFirebaseInitialized || !chatId) {
                console.log("Not ready to load messages");
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

            // Set up real-time listener
            messageUnsubscribe = db.collection('messages')
                .where('chatId', '==', chatId)
                .orderBy('timestamp', 'asc')  // Changed to ascending order
                .onSnapshot((snapshot) => {
                    const unreadMessages = [];
                    
                    snapshot.docChanges().forEach((change) => {
                        if (change.type === 'added') {
                            const message = change.doc.data();
                            const messageId = change.doc.id;
                            
                            // Collect unread messages
                            if (message.userId !== currentUser.uid && 
                                !message.readBy?.includes(currentUser.uid)) {
                                unreadMessages.push(messageId);
                            }
                            
                            if (!document.getElementById(messageId)) {
                                displayMessage(message, messageId);
                            }
                        }
                        if (change.type === 'modified') {
                            const messageEl = document.getElementById(change.doc.id);
                            const messageData = change.doc.data();
                            if (messageEl && messageData) {
                                updateReadReceipt(messageEl, messageData);
                            }
                        }
                    });

                    // Batch update read status for unread messages
                    if (unreadMessages.length > 0) {
                        // Split into smaller batches if needed
                        while (unreadMessages.length) {
                            const batch = unreadMessages.splice(0, 10);
                            batch.forEach(messageId => updateReadStatus(messageId));
                        }
                    }
                    
                    // Scroll to bottom after new messages
                    if (messageArea) {
                        messageArea.scrollTop = messageArea.scrollHeight;
                    }
                });

        } catch (error) {
            console.error("Error in loadMessages:", error);
        }
    }

    // Add function to safely update read receipt display
    function updateReadReceipt(messageEl, messageData) {
        if (!messageEl || !messageData) return;

        let footer = messageEl.querySelector('.message-footer');
        if (!footer) {
            footer = document.createElement('div');
            footer.className = 'message-footer';
            messageEl.appendChild(footer);
        }

        const timestamp = messageData.timestamp?.toDate() || new Date();
        const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Only show read receipt for sender's messages
        if (messageData.userId === currentUser?.uid) {
            footer.innerHTML = `
                <span class="message-timestamp">${timeString}</span>
                <div class="read-receipt ${messageData.readBy?.length ? 'read' : ''}" title="${getReadReceiptTitle(messageData)}">
                    <i class="ri-${messageData.readBy?.length ? 'check-double' : 'check'}-line"></i>
                    ${messageData.readBy?.length > 0 ? `<span class="read-count">${messageData.readBy.length}</span>` : ''}
                </div>
            `;

            // Add hover state data
            if (messageData.readBy?.length) {
                const readReceipt = footer.querySelector('.read-receipt');
                if (readReceipt) {
                    readReceipt.dataset.readTimestamp = messageData.readAt?.toDate()?.toLocaleString() || 'Recently';
                }
            }
        } else {
            footer.innerHTML = `<span class="message-timestamp">${timeString}</span>`;
        }
    }

    // Helper function to get read receipt tooltip text
    function getReadReceiptTitle(messageData) {
        if (!messageData.readBy?.length) return 'Not read yet';
        if (messageData.readAt) {
            return `Read ${formatLastSeen(messageData.readAt.toDate())}`;
        }
        return 'Read';
    }

    // Update the read status with better error handling
    async function updateReadStatus(messageId, readStatus) {
        if (!messageId || !currentUser) return;
        
        try {
            const messageRef = db.collection('messages').doc(messageId);
            writeQueue.add({
                ref: messageRef,
                data: {
                    readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
                    readAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            });
            await updateUnreadCounts();
        } catch (error) {
            console.error('Error queueing read status update:', error);
        }
    }

    // Add read receipt observer
    function setupReadReceiptObserver() {
        if (typeof IntersectionObserver === 'undefined') return;
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const messageEl = entry.target;
                    const messageId = messageEl.id;
                    if (messageEl.dataset.userId !== currentUser.uid) {
                        readReceiptManager.markAsRead(messageId);
                    }
                }
            });
        }, { threshold: 0.5 });

        // Observe existing and new messages
        document.querySelectorAll('.message').forEach(el => observer.observe(el));
        return observer;
    }

    // Add context menu HTML to the page
    const contextMenu = document.createElement('div');
    contextMenu.className = 'message-context-menu';
    contextMenu.innerHTML = `
        <div class="context-menu-item copy">
            <i class="ri-file-copy-line"></i>
            Copy
        </div>
        <div class="context-menu-item reply">
            <i class="ri-reply-line"></i>
            Reply
        </div>
        <div class="context-menu-item delete">
            <i class="ri-delete-bin-line"></i>
            Delete
        </div>
    `;
    document.body.appendChild(contextMenu);

    // Add link detection and sanitization
    function processMessageText(text) {
        // First handle line breaks
        const withLineBreaks = text.replace(/\n/g, '<br>');
        
        // Then handle URLs with protocol required for safety
        const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
        
        // Replace URLs with sanitized anchor tags
        return withLineBreaks.replace(urlRegex, (url) => {
            try {
                const sanitizedUrl = new URL(url);
                // Only allow specific protocols
                if (!['http:', 'https:'].includes(sanitizedUrl.protocol)) {
                    return url;
                }
                return `<a href="${sanitizedUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
            } catch {
                return url;
            }
        });
    }

    // Add link preview functionality
    async function loadLinkPreview(url, messageDiv) {
        try {
            // Create and add loading preview container
            const previewContainer = document.createElement('div');
            previewContainer.className = 'link-preview loading';
            messageDiv.querySelector('.message-content').appendChild(previewContainer);

            // Validate URL
            const validUrl = url.match(/^(http(s)?:\/\/.)[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)$/);
            if (!validUrl) {
                previewContainer.remove();
                return;
            }

            // Fetch preview data
            const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
            const data = await response.json();
            
            if (data.status === 'success') {
                const { title, description, image } = data.data;
                
                if (!title && !description && !image) {
                    previewContainer.remove();
                    return;
                }

                previewContainer.innerHTML = `
                    ${image?.url ? `<img src="${image.url}" alt="Link preview" loading="lazy">` : ''}
                    <div class="link-preview-content">
                        ${title ? `<div class="link-preview-title">${title}</div>` : ''}
                        ${description ? `<div class="link-preview-description">${description}</div>` : ''}
                        <div class="link-preview-domain">${new URL(url).hostname}</div>
                    </div>
                `;
                previewContainer.classList.remove('loading');
            } else {
                previewContainer.remove();
            }
        } catch (error) {
            console.error('Error loading link preview:', error);
            messageDiv.querySelector('.link-preview')?.remove();
        }
    }

    // Fix date comparison function
    function isSameDay(date1, date2) {
        if (!date1 || !date2) return false;
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        return d1.getDate() === d2.getDate() && 
               d1.getMonth() === d2.getMonth() && 
               d1.getFullYear() === d2.getFullYear();
    }

    // Add this helper function before displayMessage
    function isSameTimestamp(date1, date2, threshold = 2) { // 2 minute threshold
        if (!date1 || !date2) return false;
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        return Math.abs(d1 - d2) / 60000 < threshold; // Convert to minutes
    }

    // Add after processMessageText function
    function replayEffect(messageDiv, effect) {
        messageDiv.style.animation = 'none';
        messageDiv.offsetHeight; // Trigger reflow
        messageDiv.classList.remove(`effect-${effect}`);
        void messageDiv.offsetHeight; // Trigger reflow
        messageDiv.classList.add(`effect-${effect}`);
    }

    // Add new helper for markdown parsing
    function parseMarkdown(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // Bold
            .replace(/\*(.*?)\*/g, '<em>$1</em>')             // Italic
            .replace(/`(.*?)`/g, '<code>$1</code>')           // Code
            .replace(/~~(.*?)~~/g, '<del>$1</del>');          // Strikethrough
    }

    // Update the displayMessage function to include message ID and handle context menu
    async function displayMessage(message, messageId) {
        const messageDiv = document.createElement('div');
        messageDiv.id = messageId;
        messageDiv.className = `message ${message.userId === currentUser.uid ? 'sent' : 'received'}`;
        if (message.effect) {
            messageDiv.classList.add(`effect-${message.effect}`);
        }
        messageDiv.draggable = true; // Enable dragging
        messageDiv.dataset.userId = message.userId; // Add userId for grouping
        
        // Format the timestamp
        const timestamp = message.timestamp?.toDate() || new Date();
        const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Check previous message for grouping
        const lastMessage = messageArea.lastElementChild;
        const shouldGroup = lastMessage?.classList.contains('message') && 
                           lastMessage?.dataset.userId === message.userId &&
                           isSameTimestamp(timestamp, new Date(lastMessage.dataset.timestamp));
        
        // Add date divider if needed
        const dateString = timestamp.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
        // Only add date divider if it's a message element and date is different
        if (!lastMessage || 
            (lastMessage.classList.contains('message') && 
             !isSameDay(timestamp, new Date(lastMessage.dataset.date)))) {
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.innerHTML = `<span>${dateString}</span>`;
            messageArea.appendChild(divider);
        }

        // Add reply content if this is a reply
        let replyHtml = '';
        if (message.replyTo) {
            const replyClass = message.userId === currentUser.uid ? 'sent' : 'received';
            replyHtml = `
                <div class="reply-preview">
                    <div class="reply-author">
                        ${message.replyToUser || 'User'}
                    </div>
                    <div class="reply-content">
                        ${message.replyText}
                    </div>
                </div>
            `;
        }

        // Process message text for links
        const processedText = processMessageText(message.text);

        // Add swipe reply icon for mobile
        const swipeReplyIcon = `<i class="ri-reply-line swipe-reply-icon"></i>`;

        // Add message type specific content
        let messageContent = '';
        switch (message.type) {
            case 'file':
                messageContent = createFilePreview(message);
                break;
            case 'voice':
                messageContent = `
                    <div class="voice-message">
                        <button class="play-voice" data-audio="${message.audio}">
                            <i class="ri-play-fill"></i>
                        </button>
                        <div class="voice-waveform"></div>
                        <span class="voice-duration">${formatDuration(message.duration)}</span>
                    </div>
                `;
                break;
            default:
                messageContent = parseMarkdown(processMessageText(message.text)); // Add markdown parsing
        }

        // Add forwarded indicator if needed
        const forwardedHtml = message.forwardedFrom ? `
            <div class="forward-indicator">
                <i class="ri-share-forward-line"></i>
                Forwarded
            </div>
        ` : '';

        messageDiv.innerHTML = `
            ${swipeReplyIcon}
            ${replyHtml}
            ${forwardedHtml}
            <div class="message-content">
                ${messageContent}
                ${message.effect ? `
                    <button class="replay-effect" onclick="event.stopPropagation();">
                        <i class="ri-restart-line"></i>
                    </button>
                ` : ''}
            </div>
            ${!shouldGroup ? `
                <div class="message-footer">
                    <span class="message-timestamp">${timeString}</span>
                    ${message.userId === currentUser.uid ? `
                        <div class="read-receipt ${message.readBy?.length ? 'read' : ''}">
                            <i class="ri-${message.readBy?.length ? 'check-double' : 'check'}-line"></i>
                        </div>
                    ` : ''}
                </div>
            ` : ''}
        `;
        messageDiv.dataset.date = timestamp;
        messageDiv.dataset.timestamp = timestamp;

        // If this is a grouped message, add grouped class
        if (shouldGroup) {
            messageDiv.classList.add('grouped');
            // Update last message's footer if it exists
            if (lastMessage) {
                const footer = lastMessage.querySelector('.message-footer');
                if (footer) footer.remove();
            }
        }

        // Lazy load link previews
        const urls = message.text.match(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g);
        if (urls) {
            setTimeout(() => loadLinkPreview(urls[0], messageDiv), 100);
        }

        // Add context menu handlers
        let longPressTimer;
        let touchStartEvent;
        
        messageDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, message, messageId);
        });

        messageDiv.addEventListener('touchstart', (e) => {
            touchStartEvent = e;
            longPressTimer = setTimeout(() => {
                showContextMenu(touchStartEvent, message, messageId);
            }, 500);
        });

        messageDiv.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
        });

        messageDiv.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });

        // Add drag and touch event listeners
        setupDragToReply(messageDiv, message);
        setupSwipeToReply(messageDiv, message);

        messageArea.appendChild(messageDiv);

        if (message.effect) {
            const replayBtn = messageDiv.querySelector('.replay-effect');
            replayBtn.addEventListener('click', () => {
                replayEffect(messageDiv, message.effect);
            });
        }
    }

    // Add drag-to-reply functionality
    function setupDragToReply(messageEl, message) {
        const dragIndicator = document.querySelector('.drag-reply-indicator');

        messageEl.addEventListener('dragstart', (e) => {
            messageEl.classList.add('dragging');
            dragIndicator.classList.add('active');
            e.dataTransfer.setData('messageId', message.id);
        });

        messageEl.addEventListener('dragend', () => {
            messageEl.classList.remove('dragging');
            dragIndicator.classList.remove('active');
        });

        // Handle dropping on input area
        document.querySelector('.message-input').addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        document.querySelector('.message-input').addEventListener('drop', (e) => {
            e.preventDefault();
            const messageId = e.dataTransfer.getData('messageId');
            if (messageId) {
                startReply(message);
            }
        });
    }

    // Update setupSwipeToReply function with proper event handling
    function setupSwipeToReply(messageEl, message) {
        let touchStartX = 0;
        let touchMoveX = 0;

        messageEl.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
        });

        messageEl.addEventListener('touchmove', (e) => {
            touchMoveX = e.touches[0].clientX;
            const swipeDistance = touchMoveX - touchStartX;
            
            if (swipeDistance > 0 && swipeDistance < 100) {
                messageEl.classList.add('swiping');
                messageEl.style.transform = `translateX(${swipeDistance}px)`;
            }
        });

        messageEl.addEventListener('touchend', (e) => {
            const swipeDistance = touchMoveX - touchStartX;
            messageEl.style.transform = '';
            messageEl.classList.remove('swiping');
            
            if (swipeDistance > 50) {
                startReply(message);
            }
        });
    }

    // Update showContextMenu function to remove forward option
    function showContextMenu(event, message, messageId) {
        const menu = document.querySelector('.message-context-menu');
        const deleteOption = menu.querySelector('.delete');
        
        // Only show delete for own messages
        deleteOption.style.display = message.userId === currentUser.uid ? 'flex' : 'none';
        
        // Position menu
        const x = event.type.includes('touch') ? event.touches[0].clientX : event.clientX;
        const y = event.type.includes('touch') ? event.touches[0].clientY : event.clientY;
        
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.add('active');
        
        // Add action handlers
        menu.querySelector('.copy').onclick = () => {
            navigator.clipboard.writeText(message.text);
            menu.classList.remove('active');
        };
        
        menu.querySelector('.reply').onclick = () => {
            startReply(message);
            menu.classList.remove('active');
        };
        
        menu.querySelector('.delete').onclick = () => {
            deleteMessage(messageId);
            menu.classList.remove('active');
        };
    }

    // Hide context menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.message-context-menu')) {
            document.querySelector('.message-context-menu').classList.remove('active');
        }
    });

    // Handle message reply
    let replyingTo = null;
    function startReply(message, messageId) {
        replyingTo = {
            id: messageId,
            text: message.text,
            author: message.userEmail || 'User'
        };
        
        const input = document.querySelector('.message-input');
        const existingPreview = input.querySelector('.reply-container');
        if (existingPreview) {
            existingPreview.remove();
        }
        
        const replyPreview = document.createElement('div');
        replyPreview.className = 'reply-container';
        replyPreview.innerHTML = `
            <div class="reply-text">${message.text}</div>
            <button class="cancel-reply">
                <i class="ri-close-line"></i>
            </button>
        `;
        input.insertBefore(replyPreview, input.firstChild);
        
        replyPreview.querySelector('.cancel-reply').onclick = cancelReply;
        messageInput.focus();
    }

    function cancelReply() {
        replyingTo = null;
        const replyPreview = document.querySelector('.message-input .reply-container');
        if (replyPreview) {
            replyPreview.remove();
        }
    }

    // Update sendMessage to include effects
    async function sendMessage(effect = null) {
        const message = messageInput.value.trim();
        if (!message || !currentChat) return;

        try {
            messageInput.value = '';
            
            const messageData = {
                text: message,
                userId: currentUser.uid,
                chatId: currentChat,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                userEmail: currentUser.email,
                readBy: [], // Add empty readBy array
                readAt: null, // Add readAt field
                effect: effect // Add effect to message data
            };

            // Only add reply data if there is a reply
            if (replyingTo && replyingTo.id) {
                messageData.replyTo = replyingTo.id;
                messageData.replyText = replyingTo.text;
                messageData.replyToUser = replyingTo.author || 'User';
            }

            try {
                // Try immediate send
                await db.collection('messages').add(messageData);
            } catch (error) {
                // If offline, queue for background sync
                if ('serviceWorker' in navigator && 'SyncManager' in window) {
                    const sw = await navigator.serviceWorker.ready;
                    // Queue message for sync
                    sw.active.postMessage({
                        type: 'queue-message',
                        message: messageData
                    });
                    // Register for background sync
                    await sw.sync.register('sync-messages');
                } else {
                    throw error; // Re-throw if no sync available
                }
            }
            cancelReply(); // Clear reply state after sending
        } catch (error) {
            console.error("Error sending message:", error);
            alert('Failed to send message');
        }
    }

    // Delete message
    async function deleteMessage(messageId) {
        try {
            // Add deletion indicator before deleting
            const messageEl = document.getElementById(messageId);
            if (messageEl) {
                messageEl.classList.add('deleting');
                messageEl.innerHTML += `
                    <div class="delete-indicator">
                        <i class="ri-delete-bin-line"></i> Message deleted
                    </div>
                `;
            }

            await db.collection('messages').doc(messageId).delete();
            
            // Fade out and remove after animation
            messageEl?.classList.add('deleted');
            setTimeout(() => messageEl?.remove(), 500);
        } catch (error) {
            console.error("Error deleting message:", error);
            alert('Failed to delete message');
            // Remove deletion state if failed
            document.getElementById(messageId)?.classList.remove('deleting');
        }
    }

    // Replace Firebase Cloud Functions with local notification system
    async function setupMessaging() {
        try {
            // Check device/browser support
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
            
            if (isIOS && !window.navigator.standalone) {
                // Show prompt to add to home screen for iOS PWA
                showIOSInstallPrompt();
                return;
            }

            if (!('Notification' in window)) {
                console.log('This browser does not support notifications');
                return;
            }

            // Request permission and register service worker
            let permission = Notification.permission;
            
            if (permission === 'default') {
                permission = await Notification.requestPermission();
            }

            if (permission !== 'granted') {
                console.log('Notification permission denied');
                return;
            }

            // Register service worker
            const registration = await navigator.serviceWorker.register('/notifications-worker.js', {
                scope: '/'
            });

            await navigator.serviceWorker.ready;

            // Get FCM token
            const messaging = window.messaging;
            if (!messaging) {
                console.error('Firebase messaging not initialized');
                return;
            }

            const token = await messaging.getToken({
                vapidKey: "BIYJYMvPjag4l00oGUWRfFe5AVRHmgu0MBUs7_mCV1V2siT1U6_LpUj1aVqVd6bUdBAp6FbzWhjpY8JpyfetqPM",
                serviceWorkerRegistration: registration
            });

            if (token && currentUser) {
                // Create a new device token entry
                const tokenData = {
                    token: token,
                    device: getDeviceInfo(),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                // Update user's notification tokens using set with merge
                await db.collection('users').doc(currentUser.uid).set({
                    notificationTokens: [{
                        ...tokenData
                    }]
                }, { merge: true });

                // Update last token update timestamp
                await db.collection('users').doc(currentUser.uid).update({
                    lastTokenUpdate: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            // Handle foreground messages
            messaging.onMessage((payload) => {
                if (!document.hidden && currentChat === payload.data.chatId) {
                    // Don't show notification if chat is open and visible
                    return;
                }

                // Show custom notification for foreground messages
                const notification = new Notification(payload.notification.title, {
                    body: payload.notification.body,
                    icon: '/img/icons/icon-192.png',
                    tag: payload.data.messageId,
                    data: payload.data,
                    requireInteraction: true
                });

                notification.onclick = () => {
                    window.focus();
                    if (payload.data.chatId) {
                        startChat(payload.data.chatId);
                    }
                };
            });

            // Set up message listener in Firestore
            db.collection('messages')
                .where('timestamp', '>', firebase.firestore.Timestamp.now())
                .onSnapshot(snapshot => {
                    snapshot.docChanges().forEach(change => {
                        if (change.type === 'added') {
                            const message = change.doc.data();
                            
                            // Only show notification if message is for current user
                            // and chat is not active/visible
                            if (message.chatId.includes(currentUser.uid) && 
                                message.userId !== currentUser.uid && 
                                (!document.hasFocus() || currentChat !== message.chatId)) {
                                
                                showLocalNotification(message);
                            }
                        }
                    });
                });

        } catch (error) {
            console.error('Error setting up notifications:', error);
        }
    }

    async function showLocalNotification(message) {
        try {
            const otherUserId = message.chatId.split('_').find(id => id !== currentUser.uid);
            const senderDoc = await db.collection('users').doc(message.userId).get();
            const senderData = senderDoc.data();

            const notification = new Notification(senderData.displayName || 'New Message', {
                body: message.text,
                icon: senderData.photoURL || '/img/icons/icon-192.png',
                tag: message.chatId,
                data: {
                    messageId: message.id,
                    chatId: message.chatId
                },
                requireInteraction: true
            });

            notification.onclick = function() {
                window.focus();
                startChat(otherUserId);
            };

        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }

    function getDeviceInfo() {
        const ua = navigator.userAgent;
        const platform = navigator.platform;
        
        return {
            platform: platform || 'unknown',
            userAgent: ua || 'unknown',
            mobile: /Mobile|Android|iPhone|iPad|iPod/i.test(ua),
            os: getOS(),
            browser: getBrowser(),
            lastSeen: new Date().toISOString() // Use ISO string instead of timestamp
        };
    }

    function getOS() {
        const ua = navigator.userAgent;
        if (/Windows/.test(ua)) return 'Windows';
        if (/Mac OS X/.test(ua)) return 'macOS';
        if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
        if (/Android/.test(ua)) return 'Android';
        return 'Unknown';
    }

    function getBrowser() {
        const ua = navigator.userAgent;
        if (/Chrome/.test(ua)) return 'Chrome';
        if (/Firefox/.test(ua)) return 'Firefox';
        if (/Safari/.test(ua)) return 'Safari';
        if (/Edge/.test(ua)) return 'Edge';
        return 'Unknown';
    }

    function showIOSInstallPrompt() {
        // Show custom UI prompt for iOS users to add the app to home screen
        const prompt = document.createElement('div');
        prompt.className = 'ios-install-prompt';
        prompt.innerHTML = `
            <div class="prompt-content">
                <h3>Install Nova Comm</h3>
                <p>Add to Home Screen for the best experience and to receive notifications.</p>
                <button class="close-prompt">Got it</button>
            </div>
        `;
        document.body.appendChild(prompt);

        prompt.querySelector('.close-prompt').onclick = () => {
            prompt.remove();
        };
    }

    // Message Input Setup - Single Source of Truth
    if (messageInput) {
        function setupMessageInput() {
            // Function to handle auto-resize
            function autoResize() {
                messageInput.style.height = 'auto';
                const maxHeight = window.innerWidth <= 768 ? 120 : 150;
                const newHeight = Math.min(messageInput.scrollHeight, maxHeight);
                messageInput.style.height = `${newHeight}px`;

                // Adjust message container padding
                const messages = document.querySelector('.messages');
                if (messages) {
                    const bottomPadding = newHeight + 80;
                    const safeAreaBottom = parseInt(getComputedStyle(document.documentElement)
                        .getPropertyValue('--safe-area-bottom'), 10) || 0;
                    messages.style.paddingBottom = `${bottomPadding + safeAreaBottom}px`;
                }
            }

            // Input event - handles typing and resize
            messageInput.addEventListener('input', () => {
                handleTyping();
                autoResize();
            });

            // Enter key handling
            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    if (e.shiftKey) {
                        // Let the new line happen naturally
                        setTimeout(autoResize, 0);
                    } else {
                        e.preventDefault();
                        sendMessage();
                    }
                }
            });

            // Send button handler
            if (sendButton) {
                sendButton.addEventListener('click', sendMessage);
            }

            // Initial resize
            autoResize();
        }

        // Initialize message input
        setupMessageInput();
        setupEffectSelector(); // Add this line
    }

    // Update startChat function to properly handle navigation
    async function startChat(userId) {
        try {
            showLoading();
            const otherUser = await db.collection('users').doc(userId).get();
            if (!otherUser.exists) {
                hideLoading();
                return;
            }

            const userData = otherUser.data();
            const chatId = [currentUser.uid, userId].sort().join('_');
            currentChats.add(chatId); // Add this line
            
            // Set current chat and load messages
            currentChat = chatId;
            loadMessages(chatId);
            updateMessageInputState(true);

            // Update typing reference for new chat
            typingRef = db.collection('typing').doc(chatId);
            
            // Listen for typing status
            typingRef.onSnapshot((doc) => {
                const data = doc.data() || {};
                const isTyping = data[userId]?.typing;
                updateTypingIndicator(isTyping);
            });

            // Update chat header
            const chatHeader = document.querySelector('.chat-header .user-info');
            if (chatHeader) {
                chatHeader.innerHTML = `
                    <div class="avatar-container">
                        <img src="${userData.photoURL || defaultAvatar}" alt="${userData.email}" class="avatar">
                        <span class="status-indicator ${userData.status === 'online' ? 'online' : ''}"></span>
                    </div>
                    <div class="user-details">
                        <span class="username">${userData.displayName || userData.email}</span>
                        <span class="status ${userData.status === 'online' ? 'online' : ''}">
                            <i class="${userData.status === 'online' ? 'ri-checkbox-blank-circle-fill' : 'ri-time-line'}"></i>
                            ${userData.status === 'online' ? 'Online' : 'Last seen ' + formatLastSeen(userData.lastSeen?.toDate())}
                        </span>
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

            // Clear welcome screen
            const messageArea = document.getElementById('messageArea');
            const welcomeScreen = messageArea.querySelector('.welcome-screen');
            if (welcomeScreen) {
                welcomeScreen.remove();
            }

            // On mobile, close the sidebar
            if (window.innerWidth < 768) {
                contactsSidebar.classList.remove('active');
            }

            // Close the sidebar on both mobile and desktop
            contactsSidebar.classList.remove('active');

            hideLoading();
        } catch (error) {
            console.error("Error starting chat:", error);
            hideLoading();
        }
    }

    // Add typing indicator update
    function updateTypingIndicator(isTyping) {
        let typingIndicator = document.querySelector('.typing-indicator');
        
        if (isTyping) {
            if (!typingIndicator) {
                typingIndicator = document.createElement('div');
                typingIndicator.className = 'message received typing-indicator';
                typingIndicator.innerHTML = `
                    <div class="message-content">
                        <div class="dots">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </div>
                `;
                messageArea?.appendChild(typingIndicator);
                messageArea?.scrollTo({
                    top: messageArea.scrollHeight,
                    behavior: 'smooth'
                });
            }
        } else {
            typingIndicator?.remove();
        }
    }

    // Update loadRecentContacts to use main users collection
    async function loadRecentContacts() {
        try {
            const contactsList = document.querySelector('.contacts-list');
            const noChats = document.querySelector('.no-chats');
            if (!contactsList) return;

            // Clear existing contacts
            contactsList.innerHTML = '';

            const uniqueUsers = new Set();
            
            // Get all messages where user is involved
            const messagesQuery = await db.collection('messages')
                .orderBy('timestamp', 'desc')
                .get();

            messagesQuery.docs.forEach(doc => {
                const message = doc.data();
                if (!message.chatId) return;
                const users = message.chatId.split('_');
                if (users.length !== 2) return;
                const otherUserId = users[0] === currentUser.uid ? users[1] : users[0];
                if (otherUserId) uniqueUsers.add(otherUserId);
            });

            // Rest of the function remains the same...
            // Show empty state if no conversations
            if (uniqueUsers.size === 0) {
                if (noChats) noChats.style.display = 'flex';
                return;
            }

            // Hide empty state if we have conversations
            if (noChats) noChats.style.display = 'none';

            // Update currentChats after getting unique users
            currentChats = new Set(
                Array.from(uniqueUsers).map(userId => 
                    [currentUser.uid, userId].sort().join('_')
                )
            );

            // Fetch and display user details for each unique contact
            for (const userId of uniqueUsers) {
                try {
                    const userDoc = await db.collection('users').doc(userId).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        addContactToList(userData, userId);
                    }
                } catch (error) {
                    console.warn(`Error loading contact ${userId}:`, error);
                    // Continue with other contacts even if one fails
                    continue;
                }
            }

            // Move updateUnreadCounts after currentChats is set
            await updateUnreadCounts();
        } catch (error) {
            console.error("Error loading recent contacts:", error);
            // Show empty state on error
            if (document.querySelector('.no-chats')) {
                document.querySelector('.no-chats').style.display = 'flex';
            }
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

    // Add mobile menu toggle functionality
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            contactsSidebar.classList.toggle('active');
        });
    }

    // Update the click-outside handler for sidebar
    document.addEventListener('click', (e) => {
        if (contactsSidebar.classList.contains('active') &&
            !contactsSidebar.contains(e.target) && 
            !menuToggle.contains(e.target) && 
            e.target !== menuToggle) {
            contactsSidebar.classList.remove('active');
        }
    });

    // Clean up on page unload
    window.addEventListener('unload', () => {
        if (messageUnsubscribe) {
            messageUnsubscribe();
        }
        if (typingRef && currentUser) {
            typingRef.set({
                [`${currentUser.uid}`]: {
                    typing: false,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }
            }, { merge: true });
        }
    });

    // Add logout functionality
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                // Update user status to offline before logging out
                if (userStatusRef) {
                    await userStatusRef.update({
                        status: 'offline',
                        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
                
                // Sign out from Firebase
                await auth.signOut();
                
                // Redirect to login page
                window.location.href = 'index.html';
            } catch (error) {
                console.error('Error logging out:', error);
            }
        });
    }

    // Add this function after loadRecentContacts
    async function updateUnreadCounts() {
        try {
            unreadCounts.clear();
            let totalUnread = 0;

            // Only proceed if we have chats to check
            if (currentChats.size === 0) return;

            // Modify query to avoid multiple inequality filters
            const snapshot = await db.collection('messages')
                .where('chatId', 'in', Array.from(currentChats))
                .where('userId', '!=', currentUser.uid)
                .get();

            // Filter readBy client-side instead
            snapshot.docs.forEach(doc => {
                const message = doc.data();
                // Check if message is unread
                if (!message.readBy?.includes(currentUser.uid)) {
                    const otherUser = message.chatId.split('_').find(id => id !== currentUser.uid);
                    unreadCounts.set(otherUser, (unreadCounts.get(otherUser) || 0) + 1);
                    totalUnread++;
                }
            });

            // Update UI
            document.querySelectorAll('.contact').forEach(contact => {
                const userId = contact.dataset.userId;
                const count = unreadCounts.get(userId) || 0;
                let indicator = contact.querySelector('.unread-indicator');
                
                if (count > 0) {
                    if (!indicator) {
                        indicator = document.createElement('div');
                        indicator.className = 'unread-indicator';
                        contact.querySelector('.contact-header').appendChild(indicator);
                    }
                    indicator.textContent = count;
                } else if (indicator) {
                    indicator.remove();
                }
            });

            // Update menu toggle indicator
            let menuIndicator = menuToggle.querySelector('.unread-indicator');
            if (totalUnread > 0) {
                if (!menuIndicator) {
                    menuIndicator = document.createElement('div');
                    menuIndicator.className = 'unread-indicator';
                    menuToggle.appendChild(menuIndicator);
                }
            } else if (menuIndicator) {
                menuIndicator.remove();
            }
        } catch (error) {
            console.error('Error updating unread counts:', error);
        }
    }

    // Add real-time updates for unread counts
    function setupUnreadListener() {
        if (messageUnsubscribe) {
            messageUnsubscribe();
        }

        messageUnsubscribe = db.collection('messages')
            .where('userId', '!=', currentUser.uid)
            .onSnapshot(() => {
                updateUnreadCounts();
            });
    }

    // Add modal management functions
    function openModal(modalElement) {
        document.body.classList.add('modal-open');
        modalElement.classList.add('active');
    }

    function closeModal(modalElement) {
        document.body.classList.remove('modal-open');
        modalElement.classList.remove('active');
    }

    // Update search pane handlers
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            if (searchPane) {
                openModal(searchPane);
                userSearchInput?.focus();
            }
        });
    }

    if (closeSearchBtn) {
        closeSearchBtn.addEventListener('click', () => {
            if (searchPane) {
                closeModal(searchPane);
                userSearchInput.value = '';
                searchResults.innerHTML = '';
            }
        });
    }

    // Add after message input setup
    function setupEffectSelector() {
        const messageInput = document.querySelector('.message-input');
        const effectBtn = document.createElement('button');
        effectBtn.className = 'effect-btn';
        effectBtn.innerHTML = '<i class="ri-magic-line"></i>';
        
        const effectSelector = document.createElement('div');
        effectSelector.className = 'effect-selector';
        effectSelector.innerHTML = `
            <button class="effect-btn" data-effect="slam">💥</button>
            <button class="effect-btn" data-effect="loud">🔊</button>
            <button class="effect-btn" data-effect="gentle">🌊</button>
            <button class="effect-btn" data-effect="invisible">👻</button>
        `;
        
        messageInput.querySelector('.message-input-container').appendChild(effectBtn);
        messageInput.appendChild(effectSelector);

        effectBtn.addEventListener('click', () => {
            effectSelector.classList.toggle('active');
        });

        effectSelector.addEventListener('click', (e) => {
            const effectBtn = e.target.closest('.effect-btn');
            if (effectBtn) {
                const effect = effectBtn.dataset.effect;
                sendMessage(effect);
                effectSelector.classList.remove('active');
            }
        });

        // Close effect selector when clicking outside
        document.addEventListener('click', (e) => {
            if (!effectBtn.contains(e.target) && !effectSelector.contains(e.target)) {
                effectSelector.classList.remove('active');
            }
        });
    }

    // Add keyboard shortcut handling
    document.addEventListener('keydown', (e) => {
        // Only handle shortcuts if user is not typing in an input
        const isTyping = document.activeElement.tagName === 'INPUT' || 
                      document.activeElement.tagName === 'TEXTAREA';
        
        // Ctrl/Cmd + / to focus search
        if ((e.ctrlKey || e.metaKey) && e.key === '/' && !isTyping) {
            e.preventDefault();
            document.querySelector('.message-search').focus();
        }
        
        // Ctrl/Cmd + N for new chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !isTyping) {
            e.preventDefault();
            newChatBtn.click();
        }
        
        // Esc to close modals/search
        if (e.key === 'Escape') {
            const searchPane = document.getElementById('searchPane');
            if (searchPane.classList.contains('active')) {
                closeSearchBtn.click();
            }
            // Close contacts sidebar on mobile
            if (window.innerWidth < 768 && contactsSidebar.classList.contains('active')) {
                contactsSidebar.classList.remove('active');
            }
        }
        
        // Ctrl/Cmd + K to toggle contacts sidebar
        if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !isTyping) {
            e.preventDefault();
            contactsSidebar.classList.toggle('active');
        }
    });

    // Add after other declarations
    const globalSearch = document.getElementById('globalSearch');
    const globalSearchInput = document.getElementById('globalSearchInput');
    const searchResultsContainer = globalSearch.querySelector('.search-results');

    // Move these functions outside of initializeGlobalSearch
    function showGlobalSearch() {
        globalSearch.classList.add('active');
        globalSearchInput.focus();
    }

    function hideGlobalSearch() {
        globalSearch.classList.remove('active');
        globalSearchInput.value = '';
        searchResultsContainer.innerHTML = '';
    }

    // Add global search functionality
    function initializeGlobalSearch() {
        let searchResults = {};

        // Handle keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                showGlobalSearch();
            }
            if (e.key === 'Escape' && globalSearch.classList.contains('active')) {
                hideGlobalSearch();
            }
        });

        globalSearchInput.addEventListener('input', debounce(async (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                searchResultsContainer.innerHTML = '';
                return;
            }

            searchResults = {
                contacts: [],
                messages: [],
                features: [
                    { title: 'New Chat', icon: 'ri-add-line', shortcut: '⌘N', action: () => newChatBtn.click() },
                    { title: 'Settings', icon: 'ri-settings-3-line', shortcut: '⌘,', action: () => window.location.href = 'settings.html' },
                    { title: 'Sign Out', icon: 'ri-logout-box-line', action: () => logoutBtn.click() },
                ].filter(f => f.title.toLowerCase().includes(query))
            };

            // Search contacts
            if (currentUser) {
                const usersSnapshot = await db.collection('users')
                    .where('email', '>=', query)
                    .where('email', '<=', query + '\uf8ff')
                    .limit(5)
                    .get();

                searchResults.contacts = usersSnapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(user => user.id !== currentUser.uid);
            }

            // Search messages
            if (currentChat) {
                const messagesSnapshot = await db.collection('messages')
                    .where('chatId', '==', currentChat)
                    .where('text', '>=', query)
                    .orderBy('text')
                    .limit(5)
                    .get();

                searchResults.messages = messagesSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
            }

            // Render results
            renderSearchResults(searchResults);
        }, 300));

        function renderSearchResults(results) {
            searchResultsContainer.innerHTML = '';

            // Features section
            if (results.features.length) {
                const featuresSection = document.createElement('div');
                featuresSection.className = 'search-section';
                featuresSection.innerHTML = `
                    <div class="search-section-title">Features</div>
                    ${results.features.map(feature => `
                        <div class="search-item" data-feature="${feature.title}">
                            <i class="${feature.icon}"></i>
                            <span class="item-title">${feature.title}</span>
                            ${feature.shortcut ? `<span class="search-shortcut">${feature.shortcut}</span>` : ''}
                        </div>
                    `).join('')}
                `;
                searchResultsContainer.appendChild(featuresSection);

                // Add click handlers for features
                featuresSection.querySelectorAll('.search-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const feature = results.features.find(f => f.title === item.dataset.feature);
                        if (feature) {
                            hideGlobalSearch();
                            feature.action();
                        }
                    });
                });
            }

            // Contacts section
            if (results.contacts.length) {
                const contactsSection = document.createElement('div');
                contactsSection.className = 'search-section';
                contactsSection.innerHTML = `
                    <div class="search-section-title">Contacts</div>
                    ${results.contacts.map(contact => `
                        <div class="search-item" data-user-id="${contact.id}">
                            <img src="${contact.photoURL || defaultAvatar}" class="avatar" alt="${contact.email}">
                            <span class="item-title">${contact.displayName || contact.email}</span>
                        </div>
                    `).join('')}
                `;
                searchResultsContainer.appendChild(contactsSection);

                // Add click handlers for contacts
                contactsSection.querySelectorAll('.search-item').forEach(item => {
                    item.addEventListener('click', () => {
                        hideGlobalSearch();
                        startChat(item.dataset.userId);
                    });
                });
            }

            // Messages section
            if (results.messages.length) {
                const messagesSection = document.createElement('div');
                messagesSection.className = 'search-section';
                messagesSection.innerHTML = `
                    <div class="search-section-title">Messages</div>
                    ${results.messages.map(message => `
                        <div class="search-item" data-message-id="${message.id}">
                            <i class="ri-message-2-line"></i>
                            <span class="item-title">${message.text}</span>
                        </div>
                    `).join('')}
                `;
                searchResultsContainer.appendChild(messagesSection);

                // Add click handlers for messages
                messagesSection.querySelectorAll('.search-item').forEach(item => {
                    item.addEventListener('click', () => {
                        hideGlobalSearch();
                        // Scroll to message and highlight it
                        const messageEl = document.getElementById(item.dataset.messageId);
                        if (messageEl) {
                            messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            messageEl.classList.add('highlight');
                            setTimeout(() => messageEl.classList.remove('highlight'), 2000);
                        }
                    });
                });
            }
        }
    }

    const spotlightSearchBtn = document.getElementById('spotlightSearchBtn');

    if (spotlightSearchBtn) {
        spotlightSearchBtn.addEventListener('click', () => {
            showGlobalSearch();
        });
    }

    // Update keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Only handle shortcuts if user is not typing in an input
        const isTyping = document.activeElement.tagName === 'TEXTAREA';
        
        // Ctrl/Cmd + K to open global search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !isTyping) {
            e.preventDefault();
            showGlobalSearch();
        }
        
        // Esc to close search
        if (e.key === 'Escape') {
            hideGlobalSearch();
        }
    });

    // Add voice recording variables
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingTimer = null;
    let recordingStartTime = null;

    // Add voice recording setup
    function setupVoiceRecording() {
        const voiceRecordBtn = document.getElementById('voiceRecordBtn');
        const voiceControls = document.getElementById('voiceControls');
        const cancelRecordingBtn = document.getElementById('cancelRecording');
        const sendRecordingBtn = document.getElementById('sendRecording');
        const recordingTime = document.querySelector('.recording-time');

        if (!voiceRecordBtn) return;

        voiceRecordBtn.addEventListener('click', async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.addEventListener('dataavailable', event => {
                    audioChunks.push(event.data);
                });

                mediaRecorder.addEventListener('stop', () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
                    if (audioChunks.length > 0) {
                        uploadAndSendVoiceMessage(audioBlob);
                    }
                    stream.getTracks().forEach(track => track.stop());
                });

                mediaRecorder.start();
                recordingStartTime = Date.now();
                updateRecordingTimer();
                voiceControls.style.display = 'flex';
                voiceRecordBtn.style.display = 'none';
            } catch (error) {
                console.error('Error starting voice recording:', error);
                alert('Could not access microphone');
            }
        });

        cancelRecordingBtn.addEventListener('click', stopRecording.bind(null, true));
        sendRecordingBtn.addEventListener('click', stopRecording.bind(null, false));
    }

    function updateRecordingTimer() {
        const recordingTime = document.querySelector('.recording-time');
        if (!recordingStartTime || !recordingTime) return;

        recordingTimer = setInterval(() => {
            const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            recordingTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    }

    function stopRecording(cancel = false) {
        if (!mediaRecorder) return;

        const voiceControls = document.getElementById('voiceControls');
        const voiceRecordBtn = document.getElementById('voiceRecordBtn');

        clearInterval(recordingTimer);
        mediaRecorder.stop();
        voiceControls.style.display = 'none';
        voiceRecordBtn.style.display = 'block';
        
        if (cancel) {
            audioChunks = [];
        }
    }

    async function uploadAndSendVoiceMessage(audioBlob) {
        try {
            // Convert blob to base64
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
                const base64Audio = reader.result;
                
                // Create message with voice content
                const messageData = {
                    type: 'voice',
                    audio: base64Audio,
                    duration: Math.floor((Date.now() - recordingStartTime) / 1000),
                    userId: currentUser.uid,
                    chatId: currentChat,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    readBy: [],
                    readAt: null
                };

                // Send message
                await db.collection('messages').add(messageData);
            };
        } catch (error) {
            console.error('Error sending voice message:', error);
            alert('Failed to send voice message');
        }
    }

    // Initialize voice recording when chat loads
    setupVoiceRecording();
});
