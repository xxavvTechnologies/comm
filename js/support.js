document.addEventListener('DOMContentLoaded', async function() {
    if (!window.auth) {
        console.error('Firebase Auth not initialized');
        return;
    }

    const supportForm = document.getElementById('supportForm');
    const faqList = document.getElementById('faqList');
    let currentUser = null;

    function setLoading(loading) {
        document.body.style.opacity = loading ? '0.7' : '1';
        document.body.style.pointerEvents = loading ? 'none' : 'auto';
    }

    auth.onAuthStateChanged(async user => {
        if (user) {
            currentUser = user;
            await loadFAQs();
        } else {
            window.location.href = 'index.html';
        }
    });

    async function loadFAQs() {
        try {
            const snapshot = await db.collection('faqs').orderBy('order').get();
            faqList.innerHTML = snapshot.docs.map(doc => {
                const faq = doc.data();
                return `
                    <div class="faq-item">
                        <div class="faq-question">${faq.question}</div>
                        <div class="faq-answer">${faq.answer}</div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading FAQs:', error);
        }
    }

    supportForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const ticketData = {
                category: document.getElementById('category').value,
                subject: document.getElementById('subject').value,
                description: document.getElementById('description').value,
                priority: document.getElementById('priority').value,
                userId: currentUser.uid,
                userEmail: currentUser.email,
                status: 'open',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('supportTickets').add(ticketData);
            alert('Support request submitted successfully');
            supportForm.reset();
        } catch (error) {
            console.error('Error submitting support request:', error);
            alert('Failed to submit support request');
        } finally {
            setLoading(false);
        }
    });
});
