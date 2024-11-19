// Listen for successful problem submission
if (window.location.href.includes('leetcode.com/problems/')) {
    let problemSolved = false;
    
    const observer = new MutationObserver(function(mutations) {
        if (problemSolved) return; // Don't process if already solved
        
        mutations.forEach(function(mutation) {
            // Check for success message in the DOM
            if (document.querySelector('[data-e2e-locator="submission-result"]')) {
                const resultElement = document.querySelector('[data-e2e-locator="submission-result"]');
                if (resultElement.textContent.includes('Success') && !problemSolved) {
                    problemSolved = true;
                    // Notify background script of successful solution
                    chrome.storage.local.set({ isLocked: false });
                    chrome.runtime.sendMessage({ action: 'toggleLock', isLocked: false });
                    
                    // Show success message
                    const successMessage = document.createElement('div');
                    successMessage.style.cssText = `
                        position: fixed;
                        top: 20px;
                        left: 50%;
                        transform: translateX(-50%);
                        background-color: #4CAF50;
                        color: white;
                        padding: 16px;
                        border-radius: 4px;
                        z-index: 10000;
                        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    `;
                    successMessage.textContent = 'Problem solved! Browser unlocked. You can now browse freely.';
                    document.body.appendChild(successMessage);
                    
                    // Remove message after 5 seconds
                    setTimeout(() => {
                        successMessage.remove();
                    }, 5000);
                }
            }
        });
    });

    // Start observing the document
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}
