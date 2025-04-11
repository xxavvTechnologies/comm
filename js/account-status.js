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
        
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                await loadAccountStatus(user.uid);
            } else {
                window.location.href = 'index.html';
            }
        });
    } catch (error) {
        console.error('Failed to initialize:', error);
        alert('Failed to initialize app. Please refresh the page.');
    }
});

async function loadAccountStatus(userId) {
    const statusIndicator = document.getElementById('statusIndicator');
    const warningsList = document.getElementById('warningsList');

    try {
        // Get user's warnings
        const warningsSnapshot = await db.collection('warnings')
            .where('userId', '==', userId)
            .orderBy('timestamp', 'desc')
            .get();

        // Get user's account status
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.data();
        const accountStatus = userData.accountStatus || 'good';
        
        // Update status indicator
        updateStatusIndicator(statusIndicator, accountStatus, warningsSnapshot.size);

        // Show warnings history
        if (warningsSnapshot.empty) {
            warningsList.innerHTML = '<div class="no-warnings">No warnings received</div>';
        } else {
            warningsList.innerHTML = warningsSnapshot.docs.map(doc => {
                const warning = doc.data();
                return `
                    <div class="warning-item">
                        <div class="warning-date">
                            ${warning.timestamp.toDate().toLocaleDateString()}
                        </div>
                        <div class="warning-reason">${warning.reason}</div>
                    </div>
                `;
            }).join('');
        }

    } catch (error) {
        console.error('Error loading account status:', error);
        statusIndicator.innerHTML = `
            <i class="ri-error-warning-line"></i>
            <span class="status-text">Error loading status</span>
        `;
    }
}

function updateStatusIndicator(element, status, warningCount) {
    const statusConfig = {
        good: {
            icon: 'ri-shield-check-line',
            text: 'Account in good standing',
            class: 'good'
        },
        warning: {
            icon: 'ri-alert-line',
            text: `Account has ${warningCount} warning${warningCount > 1 ? 's' : ''}`,
            class: 'warning'
        },
        suspended: {
            icon: 'ri-timer-line',
            text: 'Account temporarily suspended',
            class: 'danger'
        },
        banned: {
            icon: 'ri-shield-cross-line',
            text: 'Account permanently banned',
            class: 'danger'
        }
    };

    const config = statusConfig[status] || statusConfig.good;
    
    element.className = `status-indicator ${config.class}`;
    element.innerHTML = `
        <i class="${config.icon}"></i>
        <span class="status-text">${config.text}</span>
    `;
}
