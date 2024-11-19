let currentProblem = null;
let isNavigating = false;
let lastNavigationTime = 0;
const navigationDelay = 2000;

// Track tab states
const tabLoadStates = new Map();
const tabUrls = new Map();
const newTabStates = new Map();
const tabProblems = new Map(); // Track problem for each tab
const problemHistory = new Set(); // Track recently shown problems
const maxHistorySize = 10; // Prevent showing the same problem in last 10 problems
const refreshStates = new Map(); // Track refresh states
const problemStartTimes = new Map(); // Track problem start times
const codeExecutionStates = new Map(); // Track code execution states
const focusStates = new Map(); // Track focus states

// Default user preferences
const defaultPreferences = {
    difficultyWeights: {
        1: 0.4,  // Easy
        2: 0.4,  // Medium
        3: 0.2   // Hard
    },
    dailyGoal: 5,
    enableTimer: true,
    timerDuration: 30, // minutes
    showHints: true,
    allowSkips: true,
    skipCooldown: 5 // minutes
};

// Initialize or load user preferences
function initializePreferences() {
    chrome.storage.local.get(['preferences'], function(result) {
        if (!result.preferences) {
            chrome.storage.local.set({ preferences: defaultPreferences });
        }
    });
}

// Initialize statistics tracking
function initializeStats() {
    const today = new Date().toDateString();
    chrome.storage.local.get(['statistics'], function(result) {
        const stats = result.statistics || {};
        if (!stats[today]) {
            stats[today] = {
                problemsSolved: 0,
                problemsAttempted: 0,
                timeSpent: 0,
                byDifficulty: { 1: 0, 2: 0, 3: 0 }
            };
            chrome.storage.local.set({ statistics: stats });
        }
    });
}

// Update statistics when a problem is solved
function updateStatistics(problem, timeSpent) {
    const today = new Date().toDateString();
    chrome.storage.local.get(['statistics', 'preferences'], function(result) {
        const stats = result.statistics || {};
        const prefs = result.preferences || defaultPreferences;
        
        if (!stats[today]) {
            stats[today] = {
                problemsSolved: 0,
                problemsAttempted: 0,
                timeSpent: 0,
                byDifficulty: { 1: 0, 2: 0, 3: 0 }
            };
        }
        
        stats[today].problemsSolved++;
        stats[today].timeSpent += timeSpent;
        stats[today].byDifficulty[problem.difficulty]++;
        
        // Check if daily goal is reached
        if (stats[today].problemsSolved >= prefs.dailyGoal) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon128.png',
                title: 'Daily Goal Reached! ',
                message: `Congratulations! You've solved ${prefs.dailyGoal} problems today!`
            });
        }
        
        chrome.storage.local.set({ statistics: stats });
        updateBadgeWithProgress(stats[today].problemsSolved, prefs.dailyGoal);
    });
}

// Update badge with daily progress
function updateBadgeWithProgress(solved, goal) {
    const progress = Math.min(Math.round((solved / goal) * 100), 100);
    chrome.action.setBadgeText({ text: progress + '%' });
    
    // Color changes based on progress
    const color = progress < 30 ? '#FF2D55' :  // Red
                 progress < 70 ? '#FFB800' :  // Yellow
                                '#00AF9B';   // Green
    
    chrome.action.setBadgeBackgroundColor({ color: color });
}

// Function to get problem difficulty indicator
function getDifficultyIndicator(difficulty) {
    const indicators = {
        1: { text: 'E', color: '#00AF9B' },
        2: { text: 'M', color: '#FFB800' },
        3: { text: 'H', color: '#FF2D55' }
    };
    return indicators[difficulty] || { text: '', color: '#000000' };
}

// Track active tab changes
chrome.tabs.onActivated.addListener(function(activeInfo) {
    updateBadgeForTab(activeInfo.tabId);
});

// Initialize problem timer for a tab
function initializeTimer(tabId) {
    chrome.storage.local.get(['preferences'], function(result) {
        const prefs = result.preferences || defaultPreferences;
        if (prefs.enableTimer) {
            const timer = {
                startTime: Date.now(),
                duration: prefs.timerDuration * 60 * 1000 // convert to milliseconds
            };
            chrome.storage.local.set({ [`timer_${tabId}`]: timer });
            
            // Start timer check interval
            setInterval(() => checkTimer(tabId), 1000);
        }
    });
}

// Check timer for a tab
function checkTimer(tabId) {
    chrome.storage.local.get([`timer_${tabId}`], function(result) {
        const timer = result[`timer_${tabId}`];
        if (timer) {
            const elapsed = Date.now() - timer.startTime;
            const remaining = timer.duration - elapsed;
            
            if (remaining <= 0) {
                // Time's up - notify user
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon128.png',
                    title: 'Time\'s Up! ',
                    message: 'Your time for this problem has expired. Consider moving to the next problem.'
                });
                
                // Clear timer
                chrome.storage.local.remove(`timer_${tabId}`);
            } else if (remaining <= 60000) { // Last minute warning
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icon128.png',
                    title: 'One Minute Remaining! ',
                    message: 'You have one minute left to solve this problem.'
                });
            }
        }
    });
}

// Register keyboard shortcuts
chrome.commands.onCommand.addListener(function(command) {
    switch(command) {
        case 'skip_problem':
            handleSkipProblem();
            break;
        case 'toggle_lock':
            handleToggleLock();
            break;
        case 'show_hints':
            handleShowHints();
            break;
    }
});

// Handle skip problem command
async function handleSkipProblem() {
    chrome.storage.local.get(['preferences', 'lastSkipTime'], function(result) {
        const prefs = result.preferences || defaultPreferences;
        const now = Date.now();
        const lastSkip = result.lastSkipTime || 0;
        const cooldown = prefs.skipCooldown * 60 * 1000;
        
        if (prefs.allowSkips && now - lastSkip >= cooldown) {
            chrome.storage.local.set({ lastSkipTime: now });
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (tabs[0]) {
                    redirectToRandomProblem(tabs[0].id);
                }
            });
        } else {
            const remainingTime = Math.ceil((cooldown - (now - lastSkip)) / 1000);
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon128.png',
                title: 'Skip Cooldown',
                message: `Please wait ${remainingTime} seconds before skipping again.`
            });
        }
    });
}

// Handle show hints command
function handleShowHints() {
    chrome.storage.local.get(['preferences'], function(result) {
        const prefs = result.preferences || defaultPreferences;
        if (prefs.showHints) {
            chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                if (tabs[0] && tabs[0].url.includes('leetcode.com/problems/')) {
                    // Inject hint revealing script
                    chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        function: () => {
                            const hintButton = document.querySelector('[data-cy="hint-btn"]');
                            if (hintButton) hintButton.click();
                        }
                    });
                }
            });
        }
    });
}

// Initialize extension
initializePreferences();
initializeStats();

// Problem difficulty weights (1: Easy, 2: Medium, 3: Hard)
const difficultyWeights = {
    1: 0.4,  // 40% chance for Easy
    2: 0.4,  // 40% chance for Medium
    3: 0.2   // 20% chance for Hard
};

// Function to update the extension badge based on active tab
function updateBadgeForTab(tabId) {
    const problem = tabProblems.get(tabId);
    if (!problem) {
        chrome.action.setBadgeText({ text: '' });
        return;
    }

    const difficultyColors = {
        1: '#00AF9B', // Easy - Green
        2: '#FFB800', // Medium - Yellow
        3: '#FF2D55'  // Hard - Red
    };
    
    const difficultyText = {
        1: 'E',
        2: 'M',
        3: 'H'
    };
    
    chrome.action.setBadgeBackgroundColor({ 
        color: difficultyColors[problem.difficulty] 
    });
    chrome.action.setBadgeText({ 
        text: difficultyText[problem.difficulty] || ''
    });
}

// Function to check if URL is a LeetCode problem page
function isLeetCodeProblemPage(url) {
    return url?.includes('leetcode.com/problems/') && !url?.includes('/interpret_solution') && !url?.includes('/submit');
}

// Function to extract problem slug from URL
function getProblemSlug(url) {
    const match = url?.match(/problems\/([^/]+)/);
    return match ? match[1] : null;
}

// Function to check if URL is for code execution
function isCodeExecution(url) {
    return url?.includes('/playground/') || 
           url?.includes('/interpret_solution/') || 
           url?.includes('/problems/') && url?.includes('/interpret_solution/') ||
           url?.includes('/submissions/detail/');
}

// Function to check submission status
async function checkSubmissionStatus(submissionId) {
    try {
        const response = await fetch(`https://leetcode.com/submissions/detail/${submissionId}/check/`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });
        if (!response.ok) {
            throw new Error('Failed to fetch submission status');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error checking submission:', error);
        return null;
    }
}

// Function to monitor submission until completion
async function monitorSubmission(submissionId, tabId) {
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    
    const checkStatus = async () => {
        if (attempts >= maxAttempts) return;
        attempts++;
        
        const status = await checkSubmissionStatus(submissionId);
        console.log('Submission status:', status); // Debug log

        if (!status) {
            setTimeout(checkStatus, 1000);
            return;
        }

        if (status.state === 'SUCCESS') {
            // Check if the solution was accepted
            if (status.run_success && status.status_msg === 'Accepted') {
                console.log('Solution accepted!'); // Debug log

                // Get the problem that was solved
                const problem = tabProblems.get(tabId);
                if (!problem) {
                    console.error('No problem found for tab:', tabId);
                    return;
                }

                // Calculate time spent (in minutes)
                const startTime = problemStartTimes.get(tabId) || Date.now();
                const timeSpent = Math.floor((Date.now() - startTime) / 60000);

                // Update statistics
                const today = new Date().toDateString();
                chrome.storage.local.get(['statistics'], function(result) {
                    const stats = result.statistics || {};
                    if (!stats[today]) {
                        stats[today] = {
                            problemsSolved: 0,
                            problemsAttempted: 0,
                            timeSpent: 0,
                            byDifficulty: { 1: 0, 2: 0, 3: 0 }
                        };
                    }

                    // Update daily statistics
                    stats[today].problemsSolved++;
                    stats[today].problemsAttempted++;
                    stats[today].timeSpent += timeSpent;
                    stats[today].byDifficulty[problem.difficulty]++;

                    // Save updated statistics
                    chrome.storage.local.set({ statistics: stats }, function() {
                        console.log('Statistics updated:', stats[today]); // Debug log
                    });
                });

                // Update problem history
                chrome.storage.local.get(['problemHistory'], function(result) {
                    const history = result.problemHistory || [];
                    history.unshift({
                        id: problem.id,
                        title: problem.title,
                        titleSlug: problem.titleSlug,
                        difficulty: problem.difficulty,
                        timeSpent: timeSpent,
                        solvedAt: new Date().toISOString()
                    });

                    // Keep only last 50 problems
                    if (history.length > 50) {
                        history.pop();
                    }

                    chrome.storage.local.set({ problemHistory: history });
                });

                // Unlock the browser
                chrome.storage.local.set({ isLocked: false }, function() {
                    console.log('Browser unlocked!'); // Debug log

                    // Show success notification
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'images/icon48.png',
                        title: 'Problem Solved!',
                        message: `Congratulations! You've solved ${problem.title}. Browser unlocked!`
                    });

                    // Clear problem tracking
                    tabProblems.delete(tabId);
                    problemStartTimes.delete(tabId);
                    currentProblem = null;

                    // Update badge
                    chrome.action.setBadgeText({ text: '' });
                });

                return;
            }
        } else if (status.state === 'PENDING' || status.state === 'STARTED') {
            // Keep checking
            setTimeout(checkStatus, 1000);
        }
    };

    // Start checking
    await checkStatus();
}

// Function to extract submission ID from URL
function getSubmissionId(url) {
    const match = url?.match(/submissions\/detail\/(\d+)/);
    return match ? match[1] : null;
}

// Function to check if we should handle this refresh
function shouldHandleRefresh(tabId, url) {
    const lastRefresh = refreshStates.get(tabId);
    const currentTime = Date.now();
    
    if (!lastRefresh) {
        refreshStates.set(tabId, {
            time: currentTime,
            url: url
        });
        return true;
    }

    // If it's been less than 2 seconds since last refresh, ignore
    if (currentTime - lastRefresh.time < 2000) {
        return false;
    }

    // If URL hasn't changed since last refresh, ignore
    if (lastRefresh.url === url) {
        return false;
    }

    refreshStates.set(tabId, {
        time: currentTime,
        url: url
    });
    return true;
}

// Function to check if we're in the middle of code execution
function isInCodeExecution(tabId) {
    const state = codeExecutionStates.get(tabId);
    if (!state) return false;
    
    // If it's been less than 5 seconds since code execution started
    return (Date.now() - state.startTime) < 5000;
}

// Function to check if this is a window focus event
function isWindowFocusChange(tabId, changeInfo) {
    const lastFocus = focusStates.get(tabId);
    const currentTime = Date.now();

    if (changeInfo.status === 'loading' && !changeInfo.url) {
        // If this is the first focus event for this tab
        if (!lastFocus) {
            focusStates.set(tabId, {
                time: currentTime,
                count: 1
            });
            return true;
        }

        // If it's been less than 1 second since last focus event
        if (currentTime - lastFocus.time < 1000) {
            lastFocus.count++;
            lastFocus.time = currentTime;
            return true;
        }

        // Update focus state
        focusStates.set(tabId, {
            time: currentTime,
            count: 1
        });
    }

    return false;
}

// Handle tab updates
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    // Check for submission results
    if (changeInfo.url && changeInfo.url.includes('/submissions/detail/')) {
        const submissionId = getSubmissionId(changeInfo.url);
        if (submissionId) {
            monitorSubmission(submissionId, tabId);
            return;
        }
    }

    // Track code execution
    if (changeInfo.url && isCodeExecution(changeInfo.url)) {
        codeExecutionStates.set(tabId, {
            startTime: Date.now(),
            url: changeInfo.url
        });
        return;
    }

    chrome.storage.local.get(['isLocked'], async function(result) {
        if (!result.isLocked) return;

        const currentUrl = changeInfo.url || tab.url || '';
        
        // Handle navigation and refreshes
        if (changeInfo.status === 'loading' || changeInfo.url) {
            // Skip if this is a window focus event
            if (isWindowFocusChange(tabId, changeInfo)) {
                return;
            }

            // Skip if we're in code execution
            if (isInCodeExecution(tabId)) {
                return;
            }

            // Skip if we shouldn't handle this refresh
            if (!shouldHandleRefresh(tabId, currentUrl)) {
                return;
            }

            // Skip if we're in the middle of navigation
            if (!canNavigate() || isNavigating) {
                return;
            }

            // If we're on a LeetCode problem page
            if (isLeetCodeProblemPage(currentUrl)) {
                const currentSlug = getProblemSlug(currentUrl);
                const expectedSlug = tabProblems.get(tabId)?.titleSlug;

                // Only get a new problem if we're not on our assigned problem
                if (currentSlug !== expectedSlug) {
                    const newProblem = await fetchRandomProblem();
                    if (newProblem) {
                        isNavigating = true;
                        lastNavigationTime = Date.now();
                        setNewProblem(tabId, newProblem);
                        
                        setTimeout(() => {
                            chrome.tabs.update(tabId, {
                                url: `https://leetcode.com/problems/${newProblem.titleSlug}`
                            });
                            updateBadgeForTab(tabId);
                            setTimeout(() => {
                                isNavigating = false;
                            }, navigationDelay);
                        }, 500);
                    }
                }
            } 
            // If we're not on a LeetCode problem page
            else if (!currentUrl.includes('leetcode.com/problems/')) {
                const newProblem = await fetchRandomProblem();
                if (newProblem) {
                    setNewProblem(tabId, newProblem);
                    chrome.tabs.update(tabId, {
                        url: `https://leetcode.com/problems/${newProblem.titleSlug}`
                    });
                    updateBadgeForTab(tabId);
                }
            }
        }
    });
});

// Clean up states when tab is closed
chrome.tabs.onRemoved.addListener(function(tabId) {
    refreshStates.delete(tabId);
    tabLoadStates.delete(tabId);
    tabUrls.delete(tabId);
    newTabStates.delete(tabId);
    tabProblems.delete(tabId);
    problemStartTimes.delete(tabId);
    codeExecutionStates.delete(tabId);
    focusStates.delete(tabId);
});

// Function to fetch a random problem with weighted difficulty
async function fetchRandomProblem() {
    try {
        const response = await fetch('https://leetcode.com/api/problems/all/');
        const data = await response.json();
        const problems = data.stat_status_pairs.filter(p => !p.paid_only);
        
        // Select difficulty based on weights
        const rand = Math.random();
        let targetDifficulty;
        if (rand < difficultyWeights[1]) {
            targetDifficulty = 1;
        } else if (rand < difficultyWeights[1] + difficultyWeights[2]) {
            targetDifficulty = 2;
        } else {
            targetDifficulty = 3;
        }
        
        // Filter problems by selected difficulty and not in history
        const eligibleProblems = problems.filter(p => 
            p.difficulty.level === targetDifficulty && 
            !problemHistory.has(p.stat.question__title_slug)
        );
        
        // If no eligible problems, fall back to any problem of target difficulty
        const targetProblems = eligibleProblems.length > 0 ? 
            eligibleProblems : 
            problems.filter(p => p.difficulty.level === targetDifficulty);
        
        const randomProblem = targetProblems[Math.floor(Math.random() * targetProblems.length)];
        
        // Update problem history
        problemHistory.add(randomProblem.stat.question__title_slug);
        if (problemHistory.size > maxHistorySize) {
            problemHistory.delete(Array.from(problemHistory)[0]);
        }
        
        // Store additional problem details
        const problemDetails = {
            title: randomProblem.stat.question__title,
            titleSlug: randomProblem.stat.question__title_slug,
            difficulty: randomProblem.difficulty.level,
            timestamp: Date.now()
        };
        
        // Store problem in chrome.storage for history
        chrome.storage.local.get(['problemHistory'], function(result) {
            const history = result.problemHistory || [];
            history.unshift(problemDetails);
            if (history.length > 50) history.pop(); // Keep last 50 problems
            chrome.storage.local.set({ problemHistory: history });
        });
        
        return problemDetails;
    } catch (error) {
        console.error('Error fetching random problem:', error);
        return null;
    }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleLock') {
        if (request.isLocked) {
            initiateLock();
        } else {
            removeLock();
        }
    } else if (request.action === 'getProblemHistory') {
        // Return problem history for popup display
        chrome.storage.local.get(['problemHistory'], function(result) {
            sendResponse({ history: result.problemHistory || [] });
        });
        return true; // Required for async response
    } else if (request.action === 'skipProblem') {
        // Allow skipping current problem (with cooldown)
        chrome.storage.local.get(['lastSkipTime'], function(result) {
            const now = Date.now();
            const lastSkip = result.lastSkipTime || 0;
            const skipCooldown = 5 * 60 * 1000; // 5 minutes cooldown
            
            if (now - lastSkip >= skipCooldown) {
                chrome.storage.local.set({ lastSkipTime: now });
                chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
                    if (tabs[0]) {
                        redirectToRandomProblem(tabs[0].id);
                    }
                });
                sendResponse({ success: true });
            } else {
                const remainingTime = Math.ceil((skipCooldown - (now - lastSkip)) / 1000);
                sendResponse({ 
                    success: false, 
                    message: `Please wait ${remainingTime} seconds before skipping again`
                });
            }
        });
        return true;
    }
});

// Function to initiate the lock
async function initiateLock() {
    const newProblem = await fetchRandomProblem();
    if (newProblem) {
        currentProblem = newProblem;
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                redirectToRandomProblem(tabs[0].id);
            }
        });
    }
}

// Function to check if enough time has passed since last navigation
function canNavigate() {
    const now = Date.now();
    if (isNavigating || now - lastNavigationTime < navigationDelay) {
        return false;
    }
    return true;
}

// Function to redirect to a random problem
async function redirectToRandomProblem(tabId = null) {
    if (!canNavigate()) return;
    
    isNavigating = true;
    lastNavigationTime = Date.now();
    
    const newProblem = await fetchRandomProblem();
    if (newProblem) {
        currentProblem = newProblem;
        
        // Update badge only when we get a new problem
        if (tabId) {
            // Update single tab
            setNewProblem(tabId, newProblem);
            updateBadgeForTab(tabId);
            chrome.tabs.update(tabId, {
                url: `https://leetcode.com/problems/${newProblem.titleSlug}`
            });
        } else {
            // Update all LeetCode tabs
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    if (tab.url?.includes('leetcode.com/problems/')) {
                        setNewProblem(tab.id, newProblem);
                        chrome.tabs.update(tab.id, {
                            url: `https://leetcode.com/problems/${newProblem.titleSlug}`
                        });
                    }
                });
                // Update badge for current active tab
                chrome.tabs.query({ active: true, currentWindow: true }, function(activeTabs) {
                    if (activeTabs[0]) {
                        updateBadgeForTab(activeTabs[0].id);
                    }
                });
            });
        }
    }
    
    setTimeout(() => {
        isNavigating = false;
    }, navigationDelay);
}

// Function to remove the lock
function removeLock() {
    currentProblem = null;
    isNavigating = false;
    lastNavigationTime = 0;
    tabLoadStates.clear();
    tabUrls.clear();
    newTabStates.clear();
    tabProblems.clear();
    problemStartTimes.clear();
    chrome.action.setBadgeText({ text: '' }); // Clear badge when lock is removed
}

// Monitor tab creation
chrome.tabs.onCreated.addListener(function(tab) {
    chrome.storage.local.get(['isLocked'], async function(result) {
        if (result.isLocked) {
            const newProblem = await fetchRandomProblem();
            if (newProblem) {
                currentProblem = newProblem;
                setNewProblem(tab.id, newProblem);
                newTabStates.set(tab.id, {
                    createdAt: Date.now(),
                    problemSlug: newProblem.titleSlug
                });
                
                chrome.tabs.update(tab.id, {
                    url: `https://leetcode.com/problems/${newProblem.titleSlug}`
                });
                
                // Update badge for new tab
                updateBadgeForTab(tab.id);
                
                setTimeout(() => {
                    newTabStates.delete(tab.id);
                }, 5000);
            }
        }
    });
});

// Monitor tab removal
chrome.tabs.onRemoved.addListener(function(tabId) {
    tabLoadStates.delete(tabId);
    tabUrls.delete(tabId);
    newTabStates.delete(tabId);
    tabProblems.delete(tabId);
    problemStartTimes.delete(tabId);
    refreshStates.delete(tabId);
    codeExecutionStates.delete(tabId);
    focusStates.delete(tabId);
});

// Function to set a new problem for a tab
function setNewProblem(tabId, problem) {
    currentProblem = problem;
    tabProblems.set(tabId, problem);
    problemStartTimes.set(tabId, Date.now());
}
