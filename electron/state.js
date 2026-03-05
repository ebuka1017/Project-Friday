// ═══════════════════════════════════════════════════════════════════════
// electron/state.js — Shared Agent State Manager
// Single source of truth for agent state. Broadcasts changes to all
// renderer windows (HUD + main app) via IPC.
// ═══════════════════════════════════════════════════════════════════════

const { BrowserWindow } = require('electron');

const state = {
    // Voice / agent status: 'idle' | 'listening' | 'thinking' | 'speaking'
    status: 'idle',
    // Voice mode: 'ptt' | 'handsfree'
    voiceMode: 'ptt',
    // Theme: 'dark' | 'light'
    theme: 'light',
    // Engine connection
    engineConnected: false,
    // Conversation messages (transient, mostly for broadcast)
    messages: [],
    // Session management
    activeSessionId: null,
    sessions: [],
    // Browser Integration
    allowAllDomains: true, // Default to true per user request
    allowedDomains: ['wikipedia.org', 'github.com', 'developer.mozilla.org'],
};

/**
 * Update state and broadcast to all renderer windows.
 */
function setState(patch) {
    Object.assign(state, patch);
    broadcast('state:update', { ...state });
}

/**
 * Get current state snapshot.
 */
function getState() {
    return { ...state };
}

/**
 * Add a conversation message.
 */
function addMessage(role, text) {
    const msg = { role, text, time: Date.now() };
    state.messages.push(msg);
    // Keep last 200 messages
    if (state.messages.length > 200) state.messages.shift();
    broadcast('state:message', msg);
}

/**
 * Broadcast data to all open BrowserWindows.
 */
function broadcast(channel, data) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
            win.webContents.send(channel, data);
        }
    }
}

module.exports = { state, setState, getState, addMessage, broadcast };
