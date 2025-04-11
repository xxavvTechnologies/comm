let currentUser = null; // Move currentUser to module scope
let selectedUserId = null; // Move to module scope

document.addEventListener('DOMContentLoaded', async function() {
    // Wait for Firebase to initialize
    async function waitForFirebase() {
        const maxAttempts = 10;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            if (window.auth && window.db) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
        throw new Error('Firebase failed to initialize');
    }

    try {
        await waitForFirebase();
        const searchParams = new URLSearchParams(window.location.search);
        const messageId = searchParams.get('messageId');
        const messagePreview = document.getElementById('messagePreview');
        const reportForm = document.getElementById('reportForm');
        const reportTypeSelect = document.getElementById('reportType');
        const userSearchSection = document.getElementById('userSearch');
        const userSearchInput = document.getElementById('userSearchInput');
        const userSearchResults = document.getElementById('userSearchResults');

        function setLoading(loading) {
            document.body.style.opacity = loading ? '0.7' : '1';
            document.body.style.pointerEvents = loading ? 'none' : 'auto';
        }

        // Initialize Firebase auth state
        auth.onAuthStateChanged(async user => {
            if (user) {
                currentUser = user; // Update module-level currentUser
                
                // Initialize form submission handler after auth state is confirmed
                reportForm?.addEventListener('submit', handleReportSubmission);
                
                // Handle message preview if messageId exists
                if (messageId) {
                    setLoading(true);
                    try {
                        const messageDoc = await db.collection('messages').doc(messageId).get();
                        if (messageDoc.exists) {
                            const message = messageDoc.data();
                            messagePreview.classList.remove('hidden');
                            messagePreview.querySelector('.preview-content').innerHTML = `
                                <div class="message ${message.userId === currentUser.uid ? 'sent' : 'received'}">
                                    <div class="message-content">${message.text}</div>
                                </div>
                            `;
                            // Auto-select message as report type
                            reportTypeSelect.value = 'message';
                            reportTypeSelect.disabled = true;
                        }
                    } catch (error) {
                        console.error('Error loading message:', error);
                    } finally {
                        setLoading(false);
                    }
                }
            } else {
                window.location.href = 'index.html';
            }
        });

        reportTypeSelect?.addEventListener('change', (e) => {
            const type = e.target.value;
            userSearchSection.classList.toggle('hidden', type !== 'user');
            if (type === 'user' && !selectedUserId) {
                userSearchInput.focus();
            }
        });

        userSearchInput?.addEventListener('input', debounce(async (e) => {
            const email = e.target.value.trim();
            if (!email) {
                userSearchResults.innerHTML = '';
                return;
            }

            try {
                const usersRef = await db.collection('users')
                    .where('email', '==', email)
                    .limit(1)
                    .get();

                if (usersRef.empty) {
                    userSearchResults.innerHTML = '<div class="no-results">No user found with this email</div>';
                    return;
                }

                userSearchResults.innerHTML = usersRef.docs.map(doc => `
                    <div class="search-result-item" data-user-id="${doc.id}">
                        <img src="${doc.data().photoURL || defaultAvatar}" class="avatar" alt="${doc.data().email}">
                        <div class="user-info">
                            <div class="user-name">${doc.data().displayName || doc.data().email}</div>
                            <div class="user-email">${doc.data().email}</div>
                        </div>
                    </div>
                `).join('');

                // Add click handlers
                userSearchResults.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        selectedUserId = item.dataset.userId; // Updates module-level selectedUserId
                        userSearchInput.value = item.querySelector('.user-email').textContent;
                        userSearchResults.innerHTML = '';
                    });
                });
            } catch (error) {
                console.error('Error searching users:', error);
                userSearchResults.innerHTML = '<div class="no-results">Error searching for user</div>';
            }
        }, 300));
    } catch (error) {
        console.error('Failed to initialize:', error);
        alert('Failed to initialize app. Please refresh the page.');
    }
});

// Move handleReportSubmission after module-level currentUser declaration
async function handleReportSubmission(e) {
    e.preventDefault();
    
    if (!currentUser?.uid) {
        alert('Please login to submit a report');
        window.location.href = 'index.html';
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
        const reportType = document.getElementById('reportType').value;
        const reportDetails = document.getElementById('reportDetails').value;

        if (!reportType || !reportDetails) {
            throw new Error('Please fill in all required fields');
        }

        const reportData = {
            type: reportType,
            details: reportDetails,
            reportedBy: currentUser.uid,
            status: 'pending',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Only add reportedUser if it's a user report
        if (reportType === 'user' && selectedUserId) {
            reportData.reportedUser = selectedUserId;
        }

        await db.collection('reports').add(reportData);
        alert('Report submitted successfully');
        e.target.reset();
        
    } catch (error) {
        console.error('Error submitting report:', error);
        alert(error.message || 'Failed to submit report. Please try again.');
    } finally {
        submitBtn.disabled = false;
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}
