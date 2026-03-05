// ═══════════════════════════════════════════════════════════════════════
// renderer/preload.js — Secure Context Bridge
// Shared between HUD and main app. Exposes state sync + agent controls.
// ═══════════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('friday', {
    // Get securely injected environment variables
    getGeminiKey: () => ipcRenderer.invoke('env:getGeminiKey'),

    // Voice client controls for HUD
    startVoice: () => ipcRenderer.invoke('voice:start'),
    stopVoice: () => ipcRenderer.invoke('voice:stop'),

    // Send a command to the engine via Named Pipe
    sidecar: (method, params = {}) =>
        ipcRenderer.invoke('sidecar:send', method, params),

    // Get engine connection status
    status: () => ipcRenderer.invoke('sidecar:status'),

    // Open the main app window
    openApp: () => ipcRenderer.invoke('app:openMain'),

    // Hide the main app window (keeps it running in background)
    hideApp: () => ipcRenderer.invoke('app:hideMain'),

    // Open a URL in the system's default browser
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

    // Copy text to system clipboard
    copyToClipboard: (text) => ipcRenderer.invoke('app:copyToClipboard', text),

    // Get available skills list
    getSkills: () => ipcRenderer.invoke('app:getSkills'),

    // Take a screenshot of the screen
    takeScreenshot: () => ipcRenderer.invoke('app:takeScreenshot'),

    // Check browser extension connection
    browserPing: () => ipcRenderer.invoke('browser:ping'),

    // Delegate background task to sub-agent
    delegateTask: (taskDescription) => ipcRenderer.invoke('app:delegateTask', taskDescription),

    // Minimize (hide) the HUD
    minimize: () => ipcRenderer.invoke('hud:minimize'),

    // ── Browser Control (CDP) ───────────────────────────────────────
    browser: {
        connect: () => ipcRenderer.invoke('browser:connect'),
        disconnect: () => ipcRenderer.invoke('browser:disconnect'),
        navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
        evaluate: (expression) => ipcRenderer.invoke('browser:evaluate', expression),
        getDOM: () => ipcRenderer.invoke('browser:getDOM')
    },

    // ── Shared State ────────────────────────────────────────────────
    // Both HUD and main app use these to stay in sync

    // Update shared state (broadcasts to all windows)
    setState: (patch) => ipcRenderer.invoke('state:set', patch),

    // Get current state snapshot
    getState: () => ipcRenderer.invoke('state:get'),

    // Add a message to the conversation
    addMessage: (role, text) => ipcRenderer.invoke('state:addMessage', role, text),

    // Sub-Agents
    delegateTask: (taskDesc) => ipcRenderer.invoke('app:delegateTask', taskDesc),
    onSubAgentComplete: (callback) => ipcRenderer.on('voice:subAgentComplete', (_, result) => callback(result)),
    getAllTasks: () => ipcRenderer.invoke('tasks:list'),

    // Voice Control (HUD -> App)
    onVoiceControl: (callback) => ipcRenderer.on('voice:control', (_, action) => callback(action)),

    // System log stream
    onLogLine: (callback) => ipcRenderer.on('app:logLine', (_, log) => callback(log)),

    // Listen for state updates from main process
    onStateUpdate: (callback) => {
        ipcRenderer.on('state:update', (_, data) => callback(data));
    },

    // Listen for new conversation messages
    onMessage: (callback) => {
        ipcRenderer.on('state:message', (_, msg) => callback(msg));
    },

    // HUD mouse passthrough control
    setIgnoreMouse: (ignore, options) => ipcRenderer.send('hud:set-ignore-mouse', ignore, options),

    // Legacy event listener
    on: (channel, callback) => {
        const valid = ['thought-update', 'activity-update', 'state:update', 'state:message', 'voice:control'];
        if (valid.includes(channel)) {
            ipcRenderer.on(channel, (_, ...args) => callback(...args));
        }
    },
    // ── Database & Memory ──────────────────────────────────────────
    db: {
        getSessions: () => ipcRenderer.invoke('db:getSessions'),
        getMessages: (sessionId) => ipcRenderer.invoke('db:getMessages', sessionId),
        createSession: (title) => ipcRenderer.invoke('db:createSession', title),
        deleteSession: (id) => ipcRenderer.invoke('db:deleteSession', id),
        setMemory: (key, value, desc) => ipcRenderer.invoke('db:setMemory', key, value, desc),
        getMemory: (key) => ipcRenderer.invoke('db:getMemory', key)
    }
});
