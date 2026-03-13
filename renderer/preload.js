// ═══════════════════════════════════════════════════════════════════════
// renderer/preload.js — Secure Context Bridge
// Shared between HUD and main app. Exposes state sync + agent controls.
// ═══════════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('friday', {
    // Get securely injected environment variables
    getGeminiKey: () => ipcRenderer.invoke('env:getGeminiKey'),
    getVertexToken: () => ipcRenderer.invoke('auth:getVertexToken'),
    getClerkKey: () => ipcRenderer.invoke('env:getClerkKey'),
    getClerkDomain: () => ipcRenderer.invoke('env:getClerkDomain'),
    getClerkAccountUrl: () => ipcRenderer.invoke('env:getClerkAccountUrl'),
    getGcpProject: () => ipcRenderer.invoke('env:getGcpProject'),
    getGcpLocation: () => ipcRenderer.invoke('env:getGcpLocation'),
    getGcpApiKey: () => ipcRenderer.invoke('env:getGcpApiKey'),
    setAuthStatus: (status) => ipcRenderer.invoke('auth:setStatus', status),

    // OS-Level Auth integrations
    authSignIn: () => ipcRenderer.invoke('auth:signIn'),
    authSignOut: () => ipcRenderer.invoke('auth:signOut'),
    onAuthSuccess: (callback) => ipcRenderer.on('auth:success', (_, data) => callback(data)),
    onAuthError: (callback) => ipcRenderer.on('auth:error', (_, data) => callback(data)),
    onAuthSignedOut: (callback) => ipcRenderer.on('auth:signed-out', () => callback()),

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

    // Get dynamic tool registry
    getAgentTools: () => ipcRenderer.invoke('app:getAgentTools'),
    getVoiceTools: () => ipcRenderer.invoke('app:getVoiceTools'),

    // Take a screenshot of the screen
    takeScreenshot: () => ipcRenderer.invoke('app:takeScreenshot'),

    // Get system information
    getSystemInfo: () => ipcRenderer.invoke('app:getSystemInfo'),

    // Notifications and Dialogs
    showNotification: (title, body) => ipcRenderer.invoke('app:showNotification', title, body),
    showMessageDialog: (options) => ipcRenderer.invoke('app:showMessageDialog', options),

    // Network and HTTP
    httpRequest: (options) => ipcRenderer.invoke('app:httpRequest', options),

    // Authentication / User Profile
    getUserProfile: () => ipcRenderer.invoke('app:getUserProfile'),

    // Web Search
    webSearch: (query) => ipcRenderer.invoke('app:webSearch', query),
    webDeepdive: (url) => ipcRenderer.invoke('app:webDeepdive', url),

    // Connectors
    openConnector: (type) => ipcRenderer.invoke('app:openConnector', type),

    // Productivity Tools
    gmailList: () => ipcRenderer.invoke('app:gmailList'),
    gmailRead: (id) => ipcRenderer.invoke('app:gmailRead', id),
    gmailSend: (args) => ipcRenderer.invoke('app:gmailSend', args),

    calendarGoogleList: () => ipcRenderer.invoke('app:calendarGoogleList'),
    calendarGoogleCreate: (event) => ipcRenderer.invoke('app:calendarGoogleCreate', event),

    driveList: (query) => ipcRenderer.invoke('app:driveList', query),
    driveRead: (fileId) => ipcRenderer.invoke('app:driveRead', fileId),

    outlookList: () => ipcRenderer.invoke('app:outlookList'),
    outlookSend: (args) => ipcRenderer.invoke('app:outlookSend', args),
    calendarOutlookList: () => ipcRenderer.invoke('app:calendarOutlookList'),

    // Check browser extension connection
    browserPing: () => ipcRenderer.invoke('browser:ping'),

    // Delegate background task to sub-agent
    delegateTask: (taskDescription) => ipcRenderer.invoke('app:delegateTask', taskDescription),
    browseVisual: (taskDescription) => ipcRenderer.invoke('app:browseVisual', taskDescription),

    // Minimize (hide) the HUD
    minimizeHUD: () => ipcRenderer.invoke('hud:minimize'),

    // Window Management for Main App
    minimize: () => ipcRenderer.invoke('app:minimize'),
    maximize: () => ipcRenderer.invoke('app:maximize'),
    close: () => ipcRenderer.invoke('app:close'),

    // ── Native File System Tools ──
    fsListDirectory: (path) => ipcRenderer.invoke('fs:listDirectory', path),
    fsReadFileStr: (path) => ipcRenderer.invoke('fs:readFileStr', path),
    fsWriteFileStr: (path, content) => ipcRenderer.invoke('fs:writeFileStr', path, content),

    // ── Browser Control (CDP) ───────────────────────────────────────
    browser: {
        connect: () => ipcRenderer.invoke('browser:connect'),
        disconnect: () => ipcRenderer.invoke('browser:disconnect'),
        navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
        evaluate: (expression) => ipcRenderer.invoke('browser:evaluate', expression),
        getDOM: () => ipcRenderer.invoke('browser:getDOM'),
        goBack: () => ipcRenderer.invoke('browser:goBack'),
        goForward: () => ipcRenderer.invoke('browser:goForward'),
        click: (selector) => ipcRenderer.invoke('browser:click', selector),
        type: (selector, text) => ipcRenderer.invoke('browser:type', selector, text),
        screenshot: () => ipcRenderer.invoke('browser:screenshot'),
        annotate: () => ipcRenderer.invoke('browser:annotate'),
        clearAnnotations: () => ipcRenderer.invoke('browser:clearAnnotations')
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
        getMemory: (key) => ipcRenderer.invoke('db:getMemory', key),
        getAllMemories: () => ipcRenderer.invoke('db:getAllMemories'),
        setSecret: (key, value) => ipcRenderer.invoke('db:setSecret', key, value),
        getSecret: (key) => ipcRenderer.invoke('db:getSecret', key)
    },

    // Extension Installer
    installExtension: () => ipcRenderer.invoke('install-extension'),
    detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),
    onExtensionStatus: (callback) => ipcRenderer.on('extension-install-status', (_, s) => callback(s)),

    // Clerk Backend Fetch
    clerkGetUser: (userId) => ipcRenderer.invoke('clerk-get-user', userId),
});
