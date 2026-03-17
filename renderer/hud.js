// ═══════════════════════════════════════════════════════════════════════
// renderer/hud.js — Friday HUD Widget Renderer (state-synced)
// ═══════════════════════════════════════════════════════════════════════

import { enrichMessage } from './rich-media.js';

const micButton = document.getElementById('micButton');
const voiceStatus = document.getElementById('voiceStatus');
const voiceHint = document.getElementById('voiceHint');
const settingsBtn = document.getElementById('settingsBtn');
const settingsDrawer = document.getElementById('settingsDrawer');
const voiceModeToggle = document.getElementById('voiceModeToggle');
const themeBtn = document.getElementById('themeBtn');
const minimizeBtn = document.getElementById('minimizeBtn');
const openAppBtn = document.getElementById('openAppBtn');
const hudPanel = document.querySelector('.hud-panel');
const systemsDot = document.getElementById('engineDot');
const systemsStatusEl = document.getElementById('engineStatus');
const hudActivity = document.getElementById('hudActivity');

let isListening = false;

window.friday.onBrowserAgentUpdate((msg) => {
    // Handle MiroFish-style structured events
    if (msg.event) {
        const { event, data } = msg;
        if (event === 'agent_status') {
            addActivityItem({ role: 'action', text: `🌐 ${data.message}` });
        } else if (event === 'agent_thought') {
            addActivityItem({ role: 'thinking', text: `💭 ${data.reasoning}` });
        } else if (event === 'agent_step') {
            addActivityItem({ role: 'action', text: `👉 ${data.action} (${data.url})` });
        } else if (event === 'agent_done') {
            addActivityItem({ role: 'result', text: `✅ ${data.result}` });
        }
        return;
    }

    // Legacy/Simple updates
    if (msg.status === 'started') {
        addActivityItem({ role: 'action', text: `🌐 Starting browser agent: ${msg.task}` });
    } else if (msg.action) {
        addActivityItem({ role: 'action', text: `🌐 ${msg.action}` });
    } else if (msg.status === 'done') {
        addActivityItem({ role: 'result', text: `🌐 Task Complete: ${msg.result}` });
    }
});

// ── Init ────────────────────────────────────────────────────────────

async function init() {
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

        const extConnected = await window.friday.browser.isConnected();
        const extDot = document.getElementById('extensionDot');
        const extStatusEl = document.getElementById('extensionStatus');
        if (extDot && extStatusEl) {
            extDot.classList.toggle('connected', extConnected);
            extStatusEl.textContent = extConnected ? 'Extension: ready' : 'Extension: disconnected';
        }
    } catch (e) {
        systemsDot.classList.remove('connected');
        systemsStatusEl.textContent = 'Systems: error';
        console.error('[HUD] System check error:', e);
    }
}

// ── State Sync ──────────────────────────────────────────────────────

function applyState(state) {
    document.documentElement.classList.toggle('theme-light', state.theme === 'light');
    voiceModeToggle.querySelectorAll('.toggle-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === state.voiceMode);
    });
    updateVoiceHint(state.voiceMode);
    updateStatusDisplay(state.status);

    if (state.status === 'listening') {
        isListening = true;
        micButton.classList.add('listening');
    } else {
        isListening = false;
        micButton.classList.remove('listening');
    }
}

window.friday.onStateUpdate((state) => applyState(state));

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

// ── Event Handlers ─────────────────────────────────────────────────

themeBtn.addEventListener('click', async () => {
    const state = await window.friday.getState();
    window.friday.setState({ theme: state.theme === 'dark' ? 'light' : 'dark' });
});

settingsBtn.addEventListener('click', () => {
    const open = settingsDrawer.style.display !== 'none';
    settingsDrawer.style.display = open ? 'none' : 'block';
    settingsBtn.classList.toggle('active', !open);
});

voiceModeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-opt');
    if (!btn) return;
    window.friday.setState({ voiceMode: btn.dataset.mode });
});

minimizeBtn.addEventListener('click', () => window.friday.minimizeHUD());
openAppBtn.addEventListener('click', () => window.friday.openApp());

// PTT
micButton.addEventListener('mousedown', async () => {
    const state = await window.friday.getState();
    if (state.voiceMode === 'ptt') window.friday.startVoice();
});
micButton.addEventListener('mouseup', async () => {
    const state = await window.friday.getState();
    if (state.voiceMode === 'ptt') window.friday.stopVoice();
});
micButton.addEventListener('mouseleave', async () => {
    const state = await window.friday.getState();
    if (state.voiceMode === 'ptt' && state.status !== 'idle') window.friday.stopVoice();
});

// Hands-Free
micButton.addEventListener('click', async () => {
    const state = await window.friday.getState();
    if (state.voiceMode !== 'handsfree') return;
    if (['listening', 'thinking', 'speaking'].includes(state.status)) {
        window.friday.stopVoice();
    } else {
        window.friday.startVoice();
    }
});

// ── Activity Log ────────────────────────────────────────────────────

window.friday.onMessage((msg) => addActivityItem(msg));

async function addActivityItem({ role, text, data }) {
    const empty = hudActivity.querySelector('.activity-empty');
    if (empty) empty.remove();

    const row = document.createElement('div');
    row.className = `activity-row role-${role}`;

    if (role === 'thinking') {
        row.innerHTML = `<details><summary><span class="activity-icon">🧠</span>Thought Process</summary><div class="activity-content">${text}</div></details>`;
    } else if (role === 'action') {
        row.innerHTML = `<div class="activity-header"><span class="activity-icon">🔨</span><span class="activity-text">${text}</span></div>`;
    } else if (role === 'result') {
        row.innerHTML = `<div class="activity-header"><span class="activity-icon">✅</span><span class="activity-text">${text}</span>${data ? `<img src="data:image/jpeg;base64,${data}" class="activity-img" />` : ''}</div>`;
    } else if (role === 'friday') {
        row.innerHTML = `<div class="activity-header"><span class="activity-icon">💬</span><span class="activity-text">${text}</span></div>`;
        const textEl = row.querySelector('.activity-text');
        if (textEl) enrichMessage(textEl);
    } else if (role === 'interactive') {
        row.innerHTML = `
            <div class="activity-interactive">
                <p class="interactive-prompt">${text}</p>
                <div class="interactive-controls">
                    ${data.buttons ? data.buttons.map(b => `<button class="gen-ui-btn" onclick="handleGenUIClick('${b.id}')">${b.label}</button>`).join('') : ''}
                </div>
            </div>`;
    }

    hudActivity.prepend(row);
    while (hudActivity.children.length > 10) hudActivity.lastElementChild.remove();
}

window.handleGenUIClick = (id) => {
    window.friday.addMessage('user', `Clicked: ${id}`);
};

init();
