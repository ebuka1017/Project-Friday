// ═══════════════════════════════════════════════════════════════════════
// renderer/hud.js — HUD Widget Renderer (state-synced)
// All state changes go through window.friday.setState() so the main app
// receives them too.
// ═══════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const micButton = document.getElementById('micButton');
    const voiceStatus = document.getElementById('voiceStatus');
    const voiceHint = document.getElementById('voiceHint');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsDrawer = document.getElementById('settingsDrawer');
    const voiceModeToggle = document.getElementById('voiceModeToggle');
    const themeBtn = document.getElementById('themeBtn');
    const minimizeBtn = document.getElementById('minimizeBtn');
    const openAppBtn = document.getElementById('openAppBtn');
    const systemsDot = document.getElementById('engineDot');
    const systemsStatusEl = document.getElementById('engineStatus');

    let isListening = false;

    // ── Init ────────────────────────────────────────────────────────────

    async function init() {
        // Load current shared state
        const state = await window.friday.getState();
        applyState(state);
        await checkSystems();
        setInterval(checkSystems, 5000);
    }

    async function checkSystems() {
        try {
            const s = await window.friday.status();
            systemsDot.classList.toggle('connected', s.connected);
            systemsStatusEl.textContent = s.connected ? 'Systems: ready' : 'Systems: offline';
            window.friday.setState({ systemsConnected: s.connected });
        } catch {
            systemsDot.classList.remove('connected');
            systemsStatusEl.textContent = 'Systems: error';
        }
    }

    // ── State Sync ──────────────────────────────────────────────────────

    function applyState(state) {
        // Apply theme
        document.documentElement.classList.toggle('theme-light', state.theme === 'light');

        // Apply voice mode
        voiceModeToggle.querySelectorAll('.toggle-opt').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === state.voiceMode);
        });
        updateVoiceHint(state.voiceMode);

        // Apply status
        updateStatusDisplay(state.status);

        // Apply listening state
        if (state.status === 'listening') {
            isListening = true;
            micButton.classList.add('listening');
        } else {
            isListening = false;
            micButton.classList.remove('listening');
        }
    }

    // Listen for state changes from other windows
    window.friday.onStateUpdate((state) => {
        applyState(state);
    });

    function updateStatusDisplay(status) {
        voiceStatus.className = 'voice-status';
        switch (status) {
            case 'idle': voiceStatus.textContent = 'Idle'; break;
            case 'listening':
                voiceStatus.textContent = 'Listening';
                voiceStatus.classList.add('status-listening');
                break;
            case 'thinking':
                voiceStatus.textContent = 'Thinking...';
                voiceStatus.classList.add('status-thinking');
                break;
            case 'speaking':
                voiceStatus.textContent = 'Speaking';
                voiceStatus.classList.add('status-speaking');
                break;
        }
    }

    function updateVoiceHint(mode) {
        if (mode === 'handsfree') {
            voiceHint.textContent = 'Tap to toggle listening';
            micButton.title = 'Tap to start/stop';
        } else {
            voiceHint.textContent = 'Press & hold to speak';
            micButton.title = 'Hold to speak';
        }
    }

    // ── Theme ───────────────────────────────────────────────────────────

    themeBtn.addEventListener('click', async () => {
        const state = await window.friday.getState();
        const newTheme = state.theme === 'dark' ? 'light' : 'dark';
        window.friday.setState({ theme: newTheme });
    });

    // ── Settings ────────────────────────────────────────────────────────

    settingsBtn.addEventListener('click', () => {
        const open = settingsDrawer.style.display !== 'none';
        settingsDrawer.style.display = open ? 'none' : 'block';
        settingsBtn.classList.toggle('active', !open);
    });

    // ── Voice Mode ──────────────────────────────────────────────────────

    voiceModeToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-opt');
        if (!btn) return;
        const mode = btn.dataset.mode;
        window.friday.setState({ voiceMode: mode });
        if (mode === 'ptt' && isListening) {
            isListening = false;
            micButton.classList.remove('listening');
            window.friday.setState({ status: 'idle' });
        }
    });

    // ── Minimize ────────────────────────────────────────────────────────

    minimizeBtn.addEventListener('click', () => window.friday.minimizeHUD());

    // ── Open App ────────────────────────────────────────────────────────

    openAppBtn.addEventListener('click', () => window.friday.openApp());

    // ── Mic: PTT ────────────────────────────────────────────────────────

    micButton.addEventListener('mousedown', async () => {
        console.log('[hud.js] Mic mousedown detected!');
        const state = await window.friday.getState();
        console.log('[hud.js] State voiceMode is:', state.voiceMode);
        if (state.voiceMode !== 'ptt') return;
        console.log('[hud.js] Sending startVoice() to preload');
        window.friday.startVoice();
    });

    micButton.addEventListener('mouseup', async () => {
        const state = await window.friday.getState();
        if (state.voiceMode !== 'ptt') return;
        window.friday.stopVoice();
    });

    micButton.addEventListener('mouseleave', async () => {
        const state = await window.friday.getState();
        if (state.voiceMode !== 'ptt' || state.status === 'idle') return;
        window.friday.stopVoice();
    });

    // ── Mic: Hands-Free ─────────────────────────────────────────────────

    micButton.addEventListener('click', async () => {
        console.log('[hud.js] Mic click detected!');
        const state = await window.friday.getState();
        console.log('[hud.js] State voiceMode is:', state.voiceMode);
        if (state.voiceMode !== 'handsfree') return;

        if (state.status === 'listening' || state.status === 'thinking' || state.status === 'speaking') {
            console.log('[hud.js] Stopping voice (handsfree)');
            window.friday.stopVoice();
        } else {
            console.log('[hud.js] Starting voice (handsfree)');
            window.friday.startVoice();
        }
    });

    window.__friday = { applyState };
    init();
})();
