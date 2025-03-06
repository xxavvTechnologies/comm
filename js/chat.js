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

    // Add near the top of the file, with other declarations
    let isFirebaseInitialized = false;
    let typingTimeout;
    let typingRef;

    // Add new function near the top with other declarations
    function updateReadStatus(messageId, readStatus) {
        return db.collection('messages').doc(messageId).update({
            readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
            readAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }

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
    const menuToggle = document.getElementById('menuToggle');
    const contactsSidebar = document.querySelector('.contacts-sidebar');
    const loadingOverlay = document.querySelector('.loading-overlay');
    
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

    // Add loading state management
    function showLoading() {
        loadingOverlay.classList.add('active');
    }
    function hideLoading() {
        loadingOverlay.classList.remove('active');
    }

    // Update the message input state
    function updateMessageInputState(enabled) {
        messageInput.disabled = !enabled;
        sendButton.disabled = !enabled;
        messageInput.placeholder = enabled ? "Type a message..." : "Select a chat to start messaging";
    }

    // Update user status tracking to use main users collection
    let userStatusRef = null;
    function setupUserStatus() {
        if (!currentUser) return;
        
        userStatusRef = db.collection('users').doc(currentUser.uid);
        
        // Set initial status
        userStatusRef.set({
            email: currentUser.email,
            displayName: currentUser.displayName || currentUser.email,
            photoURL: currentUser.photoURL,
            status: 'online',
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(console.error);
        
        // Update status periodically
        setInterval(() => {
            if (currentUser) {
                userStatusRef.update({
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(console.error);
            }
        }, 60000);

        // Handle disconnect
        window.addEventListener('beforeunload', () => {
            if (userStatusRef) {
                userStatusRef.update({
                    status: 'offline',
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        });

        // Initialize typing reference
        typingRef = db.collection('typing').doc(currentChat || 'dummy');
        
        // Setup typing listener when chat changes
        messageInput.addEventListener('input', handleTyping);
    }

    // Add typing handler
    function handleTyping() {
        if (!currentChat) return;
        
        // Set typing status
        typingRef.set({
            [`${currentUser.uid}`]: {
                typing: true,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }
        }, { merge: true });

        // Show self typing indicator
        updateSelfTypingIndicator(true);

        // Clear previous timeout
        clearTimeout(typingTimeout);

        // Stop typing after 1.5 seconds of no input
        typingTimeout = setTimeout(() => {
            typingRef.set({
                [`${currentUser.uid}`]: {
                    typing: false,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }
            }, { merge: true });
            
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
            // Don't load messages until a chat is selected
            loadRecentContacts();
        } else {
            window.location.href = 'index.html';
        }
    });

    // Update the loadMessages function
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
                    snapshot.docChanges().forEach((change) => {
                        if (change.type === 'added') {
                            const message = change.doc.data();
                            const messageId = change.doc.id;
                            
                            // Mark message as read if it's not our own
                            if (message.userId !== currentUser.uid) {
                                updateReadStatus(messageId, true);
                            }
                            
                            if (!document.getElementById(messageId)) {
                                displayMessage(message, messageId);
                            }
                        }
                        if (change.type === 'modified') {
                            // Update read receipts when readBy array changes
                            const messageEl = document.getElementById(change.doc.id);
                            if (messageEl) {
                                updateReadReceipt(messageEl, change.doc.data());
                            }
                        }
                    });

                    // Scroll to bottom after new messages
                    if (messageArea) {
                        messageArea.scrollTop = messageArea.scrollHeight;
                    }
                });

        } catch (error) {
            console.error("Error in loadMessages:", error);
        }
    }

    // Add function to update read receipt display
    function updateReadReceipt(messageEl, messageData) {
        let receipt = messageEl.querySelector('.read-receipt');
        if (!receipt) {
            receipt = document.createElement('div');
            receipt.className = 'read-receipt';
            messageEl.querySelector('.message-content').appendChild(receipt);
        }

        if (messageData.readBy?.includes(currentUser.uid)) {
            receipt.innerHTML = '<i class="ri-check-double-line"></i>';
            receipt.classList.add('read');
        } else {
            receipt.innerHTML = '<i class="ri-check-line"></i>';
            receipt.classList.remove('read');
        }
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
        // URL regex with protocol required for safety
        const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
        
        // Replace URLs with sanitized anchor tags
        return text.replace(urlRegex, (url) => {
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

    // Fix date comparison function
    function isSameDay(date1, date2) {
        if (!date1 || !date2) return false;
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        return d1.getDate() === d2.getDate() && 
               d1.getMonth() === d2.getMonth() && 
               d1.getFullYear() === d2.getFullYear();
    }

    // Update the displayMessage function to include message ID and handle context menu
    function displayMessage(message, messageId) {
        const messageDiv = document.createElement('div');
        messageDiv.id = messageId;
        messageDiv.className = `message ${message.userId === currentUser.uid ? 'sent' : 'received'}`;
        
        // Format the timestamp
        const timestamp = message.timestamp?.toDate() || new Date();
        const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Add date divider if needed
        const dateString = timestamp.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
        const lastMessage = messageArea.lastElementChild;
        
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
                <div class="reply-container ${replyClass}">
                    <div class="reply-indicator">
                        <i class="ri-reply-line"></i>
                    </div>
                    <div class="reply-content">
                        <div class="reply-text">${message.replyText}</div>
                    </div>
                </div>
            `;
        }

        // Process message text for links
        const processedText = processMessageText(message.text);

        messageDiv.innerHTML = `
            ${replyHtml}
            <div class="message-content">
                ${processedText}
                <div class="message-info">
                    <span class="message-timestamp">${timeString}</span>
                    ${message.userId === currentUser.uid ? `
                        <div class="read-receipt ${message.readBy?.length ? 'read' : ''}">
                            <i class="ri-${message.readBy?.length ? 'check-double' : 'check'}-line"></i>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
        messageDiv.dataset.date = timestamp;

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

        messageArea.appendChild(messageDiv);
    }

    // Add link preview functionality
    async function loadLinkPreview(url, messageDiv) {
        try {
            const previewContainer = document.createElement('div');
            previewContainer.className = 'link-preview loading';
            messageDiv.querySelector('.message-content').appendChild(previewContainer);

            const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}&waitFor=networkidle0`);
            const data = await response.json();
            
            if (data.status === 'success' && (data.data.image || data.data.description)) {
                previewContainer.innerHTML = `
                    ${data.data.image ? `<img src="${data.data.image.url}" alt="Link preview" loading="lazy">` : ''}
                    <div class="link-preview-content">
                        <div class="link-preview-title">${data.data.title || ''}</div>
                        ${data.data.description ? `
                            <div class="link-preview-description">${data.data.description}</div>
                        ` : ''}
                        <div class="link-preview-domain">${new URL(url).hostname}</div>
                    </div>
                `;
            } else {
                previewContainer.remove();
            }
        } catch (error) {
            console.error('Error loading link preview:', error);
            messageDiv.querySelector('.link-preview')?.remove();
        }
    }

    // Fix showContextMenu function to handle touch events properly
    function showContextMenu(event, message, messageId) {
        const menu = document.querySelector('.message-context-menu');
        const deleteOption = menu.querySelector('.delete');
        
        // Only show delete for own messages
        deleteOption.style.display = message.userId === currentUser.uid ? 'flex' : 'none';
        
        // Get coordinates, handling both mouse and touch events
        const x = event.touches ? event.touches[0].clientX : event.clientX;
        const y = event.touches ? event.touches[0].clientY : event.clientY;
        
        // Position menu, keeping it in viewport
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        menu.style.left = `${Math.min(x, windowWidth - menuWidth - 10)}px`;
        menu.style.top = `${Math.min(y, windowHeight - menuHeight - 10)}px`;
        menu.classList.add('active');
        
        // Add action handlers
        menu.querySelector('.copy').onclick = () => {
            navigator.clipboard.writeText(message.text);
            menu.classList.remove('active');
        };
        
        menu.querySelector('.reply').onclick = () => {
            startReply(message, messageId); // Pass messageId to startReply
            menu.classList.remove('active');
        };
        
        menu.querySelector('.delete').onclick = () => {
            deleteMessage(messageId);
            menu.classList.remove('active');
        };
    }

    // Show context menu
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
            text: message.text
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

    // Update sendMessage to include reply data
    async function sendMessage() {
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
                readAt: null // Add readAt field
            };

            // Only add reply data if there is a reply
            if (replyingTo && replyingTo.id) {
                messageData.replyTo = replyingTo.id;
                messageData.replyText = replyingTo.text;
            }

            await db.collection('messages').add(messageData);
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
                        <span class="status">${userData.status === 'online' ? 'Online' : 'Last seen ' + formatLastSeen(userData.lastSeen?.toDate())}</span>
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

            hideLoading();
        } catch (error) {
            console.error("Error starting chat:", error);
            hideLoading();
        }
    }

    // Add typing indicator update
    function updateTypingIndicator(isTyping) {
        const typingIndicator = document.querySelector('.typing-indicator');
        
        if (isTyping) {
            if (!typingIndicator) {
                const indicator = document.createElement('div');
                indicator.className = 'message received typing-indicator';
                indicator.innerHTML = `
                    <div class="message-content">
                        <div class="dots">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </div>
                `;
                messageArea.appendChild(indicator);
                messageArea.scrollTop = messageArea.scrollHeight;
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

            // Get all chats where the current user is a participant
            const chatsQuery = await db.collection('messages')
                .where('userId', '==', currentUser.uid)
                .orderBy('timestamp', 'desc')
                .get();

            const uniqueUsers = new Set();
            
            // Extract unique user IDs from messages
            for (const doc of chatsQuery.docs) {
                const message = doc.data();
                const chatId = message.chatId;
                const [user1, user2] = chatId.split('_');
                const otherUserId = user1 === currentUser.uid ? user2 : user1;
                uniqueUsers.add(otherUserId);
            }

            // Show empty state if no conversations
            if (uniqueUsers.size === 0) {
                if (noChats) noChats.style.display = 'flex';
                return;
            }

            // Hide empty state if we have conversations
            if (noChats) noChats.style.display = 'none';

            // Fetch and display user details for each unique contact
            for (const userId of uniqueUsers) {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    addContactToList(userData, userId);
                }
            }
        } catch (error) {
            console.error("Error loading recent contacts:", error);
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

    // Update the click-outside handler for sidebar - remove mobile-only check
    document.addEventListener('click', (e) => {
        if (!contactsSidebar.contains(e.target) && 
            !menuToggle.contains(e.target) && 
            e.target !== menuToggle &&
            contactsSidebar.classList.contains('active')) {
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
});
