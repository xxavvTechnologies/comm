document.addEventListener('DOMContentLoaded', async function() {
    if (!window.auth) {
        console.error('Firebase Auth not initialized');
        return;
    }

    const feedbackForm = document.getElementById('feedbackForm');
    const recentFeedback = document.getElementById('recentFeedback');
    let currentUser = null;

    function setLoading(loading) {
        document.body.style.opacity = loading ? '0.7' : '1';
        document.body.style.pointerEvents = loading ? 'none' : 'auto';
    }

    async function updateStats() {
        try {
            const snapshot = await db.collection('feedback').get();
            const stats = snapshot.docs.reduce((acc, doc) => {
                const status = doc.data().status;
                acc[status] = (acc[status] || 0) + 1;
                return acc;
            }, {});

            document.getElementById('implementedCount').textContent = stats.implemented || 0;
            document.getElementById('inProgressCount').textContent = stats.inProgress || 0;
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    auth.onAuthStateChanged(async user => {
        if (user) {
            currentUser = user;
            await Promise.all([
                loadRecentFeedback(),
                updateStats()
            ]);
        } else {
            window.location.href = 'index.html';
        }
    });

    async function loadRecentFeedback() {
        try {
            const snapshot = await db.collection('feedback')
                .orderBy('createdAt', 'desc')
                .limit(5)
                .get();

            recentFeedback.innerHTML = snapshot.docs.map(doc => {
                const feedback = doc.data();
                return `
                    <div class="feedback-item ${feedback.status}">
                        <div class="feedback-header">
                            <span class="feedback-type">${feedback.type}</span>
                            <span class="feedback-status">${feedback.status}</span>
                        </div>
                        <h4>${feedback.title}</h4>
                        <p>${feedback.details}</p>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading recent feedback:', error);
        }
    }

    feedbackForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const feedbackData = {
                type: document.getElementById('feedbackType').value,
                title: document.getElementById('title').value,
                details: document.getElementById('details').value,
                userId: currentUser.uid,
                userEmail: currentUser.email,
                status: 'new',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                votes: 0
            };

            await db.collection('feedback').add(feedbackData);
            alert('Feedback submitted successfully');
            feedbackForm.reset();
            await Promise.all([
                loadRecentFeedback(),
                updateStats()
            ]);
        } catch (error) {
            console.error('Error submitting feedback:', error);
            alert('Failed to submit feedback');
        } finally {
            setLoading(false);
        }
    });
});
