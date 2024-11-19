document.addEventListener('DOMContentLoaded', async () => {
    // Get DOM elements
    const lockToggle = document.getElementById('lockToggle');
    const problemsSolved = document.getElementById('problemsSolved');
    const dailyGoal = document.getElementById('dailyGoal');
    const progressFill = document.getElementById('progressFill');
    const timeSpent = document.getElementById('timeSpent');
    const successRate = document.getElementById('successRate');
    const streak = document.getElementById('streak');
    const historyList = document.getElementById('historyList');
    
    // Settings elements
    const dailyGoalInput = document.getElementById('dailyGoalInput');
    const timerDuration = document.getElementById('timerDuration');
    const enableTimer = document.getElementById('enableTimer');
    const showHints = document.getElementById('showHints');
    const allowSkips = document.getElementById('allowSkips');
    const skipCooldown = document.getElementById('skipCooldown');
    const difficultyPreset = document.getElementById('difficultyPreset');

    // Tab switching
    const tabs = document.querySelectorAll('.tab');
    const contentSections = document.querySelectorAll('.content-section');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show corresponding content
            contentSections.forEach(section => {
                section.classList.remove('active');
                if (section.id === targetTab) {
                    section.classList.add('active');
                }
            });
        });
    });

    // Load initial state
    const loadState = async () => {
        const state = await chrome.storage.local.get([
            'isLocked',
            'problemsSolved',
            'dailyGoal',
            'timeSpent',
            'successRate',
            'streak',
            'problemHistory',
            'settings'
        ]);

        // Update toggle state
        lockToggle.checked = state.isLocked || false;

        // Update statistics
        problemsSolved.textContent = state.problemsSolved || 0;
        dailyGoal.textContent = state.dailyGoal || 5;
        const progress = ((state.problemsSolved || 0) / (state.dailyGoal || 5)) * 100;
        progressFill.style.width = `${Math.min(100, progress)}%`;
        timeSpent.textContent = `${state.timeSpent || 0} min`;
        successRate.textContent = `${state.successRate || 0}%`;
        streak.textContent = state.streak || 0;

        // Update settings
        const settings = state.settings || {
            dailyGoal: 5,
            timerDuration: 30,
            enableTimer: true,
            showHints: true,
            allowSkips: true,
            skipCooldown: 5,
            difficultyPreset: 'balanced'
        };

        dailyGoalInput.value = settings.dailyGoal;
        timerDuration.value = settings.timerDuration;
        enableTimer.checked = settings.enableTimer;
        showHints.checked = settings.showHints;
        allowSkips.checked = settings.allowSkips;
        skipCooldown.value = settings.skipCooldown;
        difficultyPreset.value = settings.difficultyPreset;

        // Update history
        updateHistory(state.problemHistory || []);
    };

    // Update history list
    const updateHistory = (history) => {
        historyList.innerHTML = '';
        history.slice(0, 50).forEach(problem => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            
            const difficultyClass = {
                1: 'easy',
                2: 'medium',
                3: 'hard'
            }[problem.difficulty];

            historyItem.innerHTML = `
                <a href="https://leetcode.com/problems/${problem.titleSlug}" 
                   class="problem-title" 
                   target="_blank">
                    ${problem.title}
                </a>
                <div class="problem-info">
                    <span class="difficulty-badge difficulty-${difficultyClass}">
                        ${['Easy', 'Medium', 'Hard'][problem.difficulty - 1]}
                    </span>
                    <span>${problem.timeSpent} min</span>
                </div>
            `;
            
            historyList.appendChild(historyItem);
        });
    };

    // Save settings
    const saveSettings = async () => {
        const settings = {
            dailyGoal: parseInt(dailyGoalInput.value),
            timerDuration: parseInt(timerDuration.value),
            enableTimer: enableTimer.checked,
            showHints: showHints.checked,
            allowSkips: allowSkips.checked,
            skipCooldown: parseInt(skipCooldown.value),
            difficultyPreset: difficultyPreset.value
        };

        await chrome.storage.local.set({ settings });
        
        // Update background script
        chrome.runtime.sendMessage({
            type: 'updateSettings',
            settings
        });
    };

    // Event listeners for settings changes
    [dailyGoalInput, timerDuration, enableTimer, showHints, 
     allowSkips, skipCooldown, difficultyPreset].forEach(element => {
        element.addEventListener('change', saveSettings);
    });

    // Toggle lock state
    lockToggle.addEventListener('change', async () => {
        const isLocked = lockToggle.checked;
        await chrome.storage.local.set({ isLocked });
        
        chrome.runtime.sendMessage({
            type: 'toggleLock',
            isLocked
        });
    });

    // Listen for state updates from background script
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'stateUpdate') {
            loadState();
        }
    });

    // Initial load
    loadState();
});
