let currentUser = null;
let currentChannel = null;
let messageUnsubscribe = null;

document.addEventListener('DOMContentLoaded', async function() {
    try {
        if (!window.auth) {
            throw new Error('Firebase Auth not initialized');
        }

        // Initialize UI elements
        const channelsSidebar = document.querySelector('.channels-sidebar');
        const menuToggle = document.getElementById('channelMenuToggle');

        // Setup sidebar toggle
        if (menuToggle) {
            menuToggle.addEventListener('click', () => {
                channelsSidebar.classList.toggle('active');
            });

            // Close sidebar when clicking outside
            document.addEventListener('click', (e) => {
                if (channelsSidebar.classList.contains('active') &&
                    !channelsSidebar.contains(e.target) && 
                    !menuToggle.contains(e.target) && 
                    e.target !== menuToggle) {
                    channelsSidebar.classList.remove('active');
                }
            });

            // Add keyboard shortcut (Ctrl/Cmd + K)
            document.addEventListener('keydown', (e) => {
                const isTyping = document.activeElement.tagName === 'INPUT' || 
                                document.activeElement.tagName === 'TEXTAREA';
                
                if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !isTyping) {
                    e.preventDefault();
                    channelsSidebar.classList.toggle('active');
                }

                // Close on Escape
                if (e.key === 'Escape' && channelsSidebar.classList.contains('active')) {
                    channelsSidebar.classList.remove('active');
                }
            });
        }

        // Handle auth state
        auth.onAuthStateChanged(async user => {
            if (user) {
                currentUser = user;
                await loadChannels();
                setupModals();
                setupCreateChannelForm();
                setupChannelInfoModal();
            } else {
                window.location.href = 'index.html';
            }
        });

    } catch (error) {
        console.error('Initialization error:', error);
    }
});

async function loadChannels() {
    const ownedList = document.getElementById('ownedChannelsList');
    const joinedList = document.getElementById('joinedChannelsList');
    if (!ownedList || !joinedList) return;

    ownedList.innerHTML = '';
    joinedList.innerHTML = '';

    try {
        const snapshot = await db.collection('channels')
            .where('members', 'array-contains', currentUser.uid)
            .orderBy('lastActivity', 'desc')
            .get();

        snapshot.forEach(doc => {
            const channel = doc.data();
            const isOwner = channel.creator === currentUser.uid;
            addChannelToList(channel, doc.id, isOwner ? ownedList : joinedList);
        });
    } catch (error) {
        console.error('Error loading channels:', error);
    }
}

function addChannelToList(channel, channelId, list) {
    const div = document.createElement('div');
    div.className = 'channel-item';
    div.dataset.channelId = channelId;

    const memberCount = channel.members?.length || 0;

    div.innerHTML = `
        <div class="channel-info">
            <div class="channel-name">${channel.name}</div>
            <div class="channel-meta">
                <span class="member-count">${memberCount} ${memberCount === 1 ? 'member' : 'members'}</span>
            </div>
        </div>
    `;

    div.onclick = () => loadChannelMessages(channelId);
    list.appendChild(div);
}

async function loadChannelMessages(channelId) {
    if (messageUnsubscribe) {
        messageUnsubscribe();
    }
    
    currentChannel = channelId;
    const messageArea = document.getElementById('messageArea');
    messageArea.innerHTML = '';

    // Enable message input
    const textarea = document.querySelector('.message-input textarea');
    const sendButton = document.querySelector('.send-message');
    if (textarea && sendButton) {
        textarea.disabled = false;
        sendButton.disabled = false;
    }

    try {
        // Get channel data and update UI
        const channelDoc = await db.collection('channels').doc(channelId).get();
        if (channelDoc.exists) {
            updateChannelHeader(channelDoc.data());
            
            // Update sidebar active state
            document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
            document.querySelector(`.channel-item[data-channel-id="${channelId}"]`)?.classList.add('active');
        }

        messageUnsubscribe = db.collection('messages')
            .where('channelId', '==', channelId)
            .orderBy('timestamp', 'asc')
            .onSnapshot(snapshot => {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        displayMessage(change.doc.data(), change.doc.id);
                    }
                });
                
                // Scroll to bottom
                messageArea.scrollTop = messageArea.scrollHeight;
            });
    } catch (error) {
        console.error('Error loading messages:', error);
    }

    // Show info button for channels
    const infoBtn = document.getElementById('channelInfoBtn');
    if (infoBtn) {
        infoBtn.style.display = channelId ? 'block' : 'none';
    }
}

function displayMessage(message, messageId) {
    const messageArea = document.getElementById('messageArea');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.userId === currentUser.uid ? 'sent' : 'received'}`;
    messageDiv.id = messageId;

    const timestamp = message.timestamp?.toDate() || new Date();
    const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Get the user's display name
    db.collection('users').doc(message.userId).get().then(userDoc => {
        const userData = userDoc.data();
        const displayName = userData?.displayName || userData?.email || 'User';

        messageDiv.innerHTML = `
            <div class="message-content">${message.text}</div>
            <div class="message-footer">
                <span class="message-author">${displayName}</span>
                <span class="message-timestamp">${timeString}</span>
            </div>
        `;
    });

    messageArea.appendChild(messageDiv);
}

function updateChannelHeader(channel) {
    const nameElement = document.getElementById('currentChannelName');
    const countElement = document.getElementById('memberCount');
    
    if (nameElement) nameElement.textContent = channel.name;
    if (countElement) countElement.textContent = `${channel.members?.length || 0} members`;
}

// Remove the old setupCreateChannel function and add this new one:
function setupCreateChannelForm() {
    const form = document.getElementById('createChannelForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const data = {
            name: document.getElementById('channelName').value,
            description: document.getElementById('channelDescription').value,
            isPublic: document.getElementById('isPublic').checked
        };

        await createChannel(data);
        document.getElementById('createChannelModal').classList.remove('active');
        form.reset();
    });
}

// Modal handling
function setupModals() {
    const discoveryModal = document.getElementById('discoveryModal');
    const createChannelModal = document.getElementById('createChannelModal');
    const discoverBtn = document.getElementById('discoverBtn');
    const createChannelBtn = document.getElementById('createChannelBtn');

    discoverBtn.addEventListener('click', () => {
        discoveryModal.classList.add('active');
        loadPublicChannels();
    });

    createChannelBtn.addEventListener('click', () => {
        createChannelModal.classList.add('active');
    });

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            discoveryModal.classList.remove('active');
            createChannelModal.classList.remove('active');
        });
    });
}

async function loadPublicChannels() {
    const publicChannelsList = document.getElementById('publicChannelsList');
    publicChannelsList.innerHTML = '';

    try {
        const snapshot = await db.collection('channels')
            .where('isPublic', '==', true)
            .orderBy('memberCount', 'desc')
            .limit(20)
            .get();

        snapshot.forEach(doc => {
            const channel = doc.data();
            const div = document.createElement('div');
            div.className = 'channel-card';
            div.innerHTML = `
                <h3>${channel.name}</h3>
                ${channel.description ? `<p>${channel.description}</p>` : ''}
                <div class="channel-meta">
                    <span>${channel.memberCount || 0} members</span>
                </div>
            `;

            div.addEventListener('click', () => joinChannel(doc.id));
            publicChannelsList.appendChild(div);
        });
    } catch (error) {
        console.error('Error loading public channels:', error);
    }
}

async function createChannel(data) {
    try {
        const channelData = {
            name: data.name,
            description: data.description,
            isPublic: data.isPublic,
            creator: currentUser.uid,
            members: [currentUser.uid],
            memberCount: 1,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastActivity: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('channels').add(channelData);
        window.location.href = `chat.html?channel=${docRef.id}`;
    } catch (error) {
        console.error('Error creating channel:', error);
        alert('Failed to create channel');
    }
}

async function joinChannel(channelId) {
    try {
        // Add user to channel members
        await db.collection('channels').doc(channelId).update({
            members: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
        });

        // Load the channel immediately
        const channelDoc = await db.collection('channels').doc(channelId).get();
        currentChannel = channelId;
        loadChannelMessages(channelId);
        updateChannelHeader(channelDoc.data());
        
        // Close discovery modal
        document.getElementById('discoveryModal').classList.remove('active');
        
        // Update UI for selected channel
        document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
        const channelEl = document.querySelector(`[data-channel-id="${channelId}"]`);
        if (channelEl) {
            channelEl.classList.add('active');
        }

    } catch (error) {
        console.error('Error joining channel:', error);
        alert('Failed to join channel');
    }
}

// Add message input handling
document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.querySelector('.message-input textarea');
    const sendButton = document.querySelector('.send-message');

    if (textarea && sendButton) {
        textarea.addEventListener('input', () => {
            sendButton.disabled = !textarea.value.trim();
            // Auto resize textarea
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
        });

        sendButton.addEventListener('click', () => sendMessage());
        
        textarea.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && textarea.value.trim()) {
                e.preventDefault();
                sendMessage();
            }
        });
    }
});

async function sendMessage() {
    const textarea = document.querySelector('.message-input textarea');
    const text = textarea.value.trim();
    
    if (!text || !currentChannel || !currentUser) return;

    try {
        await db.collection('messages').add({
            text: text,
            channelId: currentChannel,
            userId: currentUser.uid,
            userEmail: currentUser.email,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        textarea.value = '';
        textarea.style.height = 'auto';
    } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message');
    }
}

// Add event listeners when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    const channelsSidebar = document.querySelector('.channels-sidebar');
    const menuToggle = document.getElementById('channelMenuToggle');

    // Toggle sidebar when menu button is clicked
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            channelsSidebar.classList.toggle('active');
        });
    }

    // Close sidebar when clicking outside
    document.addEventListener('click', (e) => {
        if (channelsSidebar.classList.contains('active') &&
            !channelsSidebar.contains(e.target) && 
            !menuToggle.contains(e.target) && 
            e.target !== menuToggle) {
            channelsSidebar.classList.remove('active');
        }
    });

    // Add keyboard shortcut
    document.addEventListener('keydown', (e) => {
        // Only handle shortcuts if user is not typing in an input
        const isTyping = document.activeElement.tagName === 'INPUT' || 
                        document.activeElement.tagName === 'TEXTAREA';
        
        // Ctrl/Cmd + K to toggle channels sidebar
        if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !isTyping) {
            e.preventDefault();
            channelsSidebar.classList.toggle('active');
        }
    });
});

function setupChannelInfoModal() {
    const infoBtn = document.getElementById('channelInfoBtn');
    const modal = document.getElementById('channelInfoModal');
    const closeBtn = modal.querySelector('.modal-close');
    
    if (!infoBtn || !modal) return;

    infoBtn.style.display = 'none'; // Hide by default
    
    infoBtn.addEventListener('click', async () => {
        if (!currentChannel) return;
        
        try {
            const channelDoc = await db.collection('channels').doc(currentChannel).get();
            const channelData = channelDoc.data();
            
            const header = modal.querySelector('.channel-info-header h2');
            const created = modal.querySelector('.channel-created');
            const memberCount = modal.querySelector('.channel-member-count');
            const memberList = modal.querySelector('.member-list');
            
            header.textContent = channelData.name;
            created.textContent = channelData.createdAt.toDate().toLocaleDateString();
            memberCount.textContent = channelData.members.length;
            
            // Clear and reload member list
            memberList.innerHTML = '';
            
            // Fetch all member details
            const memberDetails = await Promise.all(
                channelData.members.map(uid => 
                    db.collection('users').doc(uid).get()
                )
            );
            
            // Sort members: owner first, then alphabetically by email
            const sortedMembers = memberDetails
                .map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }))
                .sort((a, b) => {
                    if (a.id === channelData.creator) return -1;
                    if (b.id === channelData.creator) return 1;
                    return a.email.localeCompare(b.email);
                });
            
            // Render member list
            sortedMembers.forEach(member => {
                const div = document.createElement('div');
                div.className = 'member-item';
                div.innerHTML = `
                    <img src="${member.photoURL || 'img/default-avatar.png'}" alt="Avatar" class="member-avatar">
                    <div class="member-info">
                        <div class="member-name">
                            ${member.displayName || member.email.split('@')[0]}
                            ${member.id === channelData.creator ? 
                                '<span class="owner-badge">Owner</span>' : ''}
                        </div>
                        <div class="member-email">${member.email}</div>
                    </div>
                `;
                memberList.appendChild(div);
            });
            
            modal.classList.add('active');
        } catch (error) {
            console.error('Error loading channel info:', error);
        }
    });

    // Close modal when clicking close button or outside
    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });
}
