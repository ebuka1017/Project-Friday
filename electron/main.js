// ═══════════════════════════════════════════════════════════════════════
// electron/main.js — Friday Agent Entry Point
// Orchestrates app lifecycle, HUD, main window, sidecar, and shared state.
// ═══════════════════════════════════════════════════════════════════════

const { app, globalShortcut, ipcMain, BrowserWindow, session, shell, Tray, Menu, nativeImage } = require('electron');
const { createHUD, toggleHUD, hideHUD, getWindow } = require('./hud');
const sidecar = require('./sidecar-launcher');
const pipeClient = require('./pipe-client');
const { registerDeepLink, setMainWindow } = require('./auth-main');

// Register deep link early, before app ready
registerDeepLink();

const { setState, getState, addMessage } = require('./state');
const browserServer = require('./browser-server');
const subAgents = require('./sub-agents');
const { startMCPServer } = require('./mcp-server');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { installExtension, detectBrowsers } = require("./extensionInstaller");
require('dotenv').config();

// Override console to broadcast logs to renderer
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Global error handlers
process.on('uncaughtException', (err) => {
    originalConsoleError('[friday] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    originalConsoleError('[friday] Unhandled Rejection at:', promise, 'reason:', reason);
});

function broadcastLog(level, ...args) {
    let message = "";
    try {
        message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    } catch (e) {
        message = "[Serialization Error] " + args.join(' ');
    }

    if (level === 'log') originalConsoleLog(message);
    else if (level === 'warn') originalConsoleWarn(message);
    else if (level === 'error') originalConsoleError(message);

    const time = new Date().toISOString().split('T')[1].slice(0, 12);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('app:logLine', { time, level, message });
    }
}

console.log = (...args) => broadcastLog('log', ...args);
console.warn = (...args) => broadcastLog('warn', ...args);
console.error = (...args) => broadcastLog('error', ...args);

// CRITICAL for HUD: Allow the background/hidden main window to start WebRTC AudioContext without user DOM clicks
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let isAuthenticated = false; // Clerk Auth Gate

ipcMain.handle('auth:setStatus', (_, status) => {
    isAuthenticated = status;
    console.log(`[Auth] User authentication status set to: ${status}`);
    return true;
});

// Voice control routing (HUD -> Main Window)
ipcMain.handle('voice:start', () => {
    if (!isAuthenticated) {
        console.warn('[Auth] Blocked voice:start: User not authenticated');
        return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('voice:control', 'start');
    }
});

ipcMain.handle('voice:stop', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('voice:control', 'stop');
    }
});

// ── Browser Control (Extension Bridge) ───────────────────────────────────
ipcMain.handle('browser:connect', () => {
    return browserServer.isConnected();
});
ipcMain.handle('browser:disconnect', () => {
    // We basically just check status. The UI handles the toggle.
    return !browserServer.isConnected();
});
ipcMain.handle('browser:navigate', async (_, url) => {
    try {
        db.logAudit('browser_navigate', { url }).catch(e => console.error('[Audit]', e));
        return await browserServer.navigate(url);
    } catch (e) {
        console.error('[Browser] Navigate Error:', e);
        return false;
    }
});
ipcMain.handle('browser:evaluate', async (_, expression) => {
    try {
        db.logAudit('browser_evaluate', { expression }).catch(e => console.error('[Audit]', e));
        return await browserServer.evaluate(expression);
    } catch (e) {
        console.error('[Browser] Evaluate Error:', e);
        return null;
    }
});
ipcMain.handle('browser:getDOM', async () => {
    try {
        return await browserServer.getDOM();
    } catch (e) {
        console.error('[Browser] GetDOM Error:', e);
        return null;
    }
});

// ── System Tray ──────────────────────────────────────────────────────────

let tray = null;

function createTray() {
    // Load the custom Friday logo for the tray
    const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'logo.png');
    let icon = nativeImage.createFromPath(iconPath);
    icon = icon.resize({ width: 32, height: 32 }); // Best practice for Windows Tray

    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open Friday', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
        { type: 'separator' },
        {
            label: 'Quit Friday', click: () => {
                app.isQuiting = true;
                app.quit();
            }
        }
    ]);
    tray.setToolTip('Project Friday');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// ── App Lifecycle ────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.whenReady().then(async () => {
        console.log('[friday] App ready — initializing...');

        // Start Browser extension WebSocket bridge
        browserServer.start();

        // Start Model Context Protocol Server
        startMCPServer();

        const launched = sidecar.launch();
        if (!launched) {
            console.warn('[friday] Engine not available — running without native features');
        }

        if (launched) {
            try {
                await pipeClient.connect();
                console.log('[friday] Pipe connected to engine');
                setState({ engineConnected: true });
            } catch (err) {
                console.error('[friday] Pipe connection failed:', err.message);
                setState({ engineConnected: false });
            }
        }

        // Track pipe connection state
        pipeClient.on('event', (data) => {
            console.log('[friday] Engine event:', data);
        });

        // Initialize DB
        try {
            await db.init();
            console.log('[friday] Database initialized.');
        } catch (err) {
            console.error('[friday] Database initialization failed:', err);
        }

        createHUD();
        initMainWindow();
        showMainWindow(); // Show main window on app start
        registerHotkey();
        createTray();

        // Grant media permissions automatically so the hidden window doesn't crash on getUserMedia()
        session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
            if (permission === 'media') return true;
            return false;
        });
        session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (permission === 'media') callback(true);
            else callback(false);
        });

        // Initial session loading
        try {
            const sessions = await db.getSessions();
            if (sessions.length > 0) {
                setState({ sessions, activeSessionId: sessions[0].id });
            } else {
                const newSessionId = `session-${Date.now()}`;
                const title = "New Conversation";
                await db.createSession(newSessionId, title);
                setState({
                    sessions: [{ id: newSessionId, title, created_at: new Date().toISOString() }],
                    activeSessionId: newSessionId
                });
            }
        } catch (err) {
            console.error('[friday] Failed to load initial sessions:', err);
        }

        console.log('[friday] Initialization complete');
    });
}

// ── Main App Window ─────────────────────────────────────────────────────

function initMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) return;

    mainWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 800,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#f5efe4',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    setMainWindow(mainWindow);

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'app.html'));

    mainWindow.on('close', (e) => {
        // Prevent destruction so VoiceClient (WebRTC) stays alive in the background
        e.preventDefault();
        mainWindow.hide();
        console.log('[friday] Main window hidden (VoiceClient running in background)');

        // Option: Show HUD when main window closes
        const hud = getWindow();
        if (hud && !hud.isVisible()) {
            hud.showInactive();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        // Broadcast renderer logs back to itself for the Logs tab
        const time = new Date().toISOString().split('T')[1].slice(0, 12);
        const lvlStr = level === 1 ? 'log' : level === 2 ? 'warn' : 'error';
        mainWindow.webContents.send('app:logLine', { time, level: lvlStr, message: `[renderer] ${message}` });
        originalConsoleLog(`[app:log] ${message}`);
    });
}

function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        initMainWindow();
    }

    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('state:update', getState());

    hideHUD();
    console.log('[friday] Main window opened, HUD minimized');
}

// ── Global Hotkey ────────────────────────────────────────────────────────

function registerHotkey() {
    const handleHotkey = () => {
        if (!isAuthenticated) {
            console.log('[hotkey] Not authenticated. Showing main window to prompt login.');
            showMainWindow();
        } else {
            toggleHUD();
        }
    };

    const registered = globalShortcut.register('CommandOrControl+Q', handleHotkey);

    if (registered) {
        console.log('[hotkey] Ctrl+Q registered');
    } else {
        console.warn('[hotkey] Ctrl+Q taken — using Ctrl+Shift+Space');
        globalShortcut.register('CommandOrControl+Shift+Space', handleHotkey);
    }
}

// ── IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('sidecar:send', async (_, method, params) => {
    if (!isAuthenticated) return { error: 'Unauthorized: Please sign in first' };
    if (!pipeClient.isConnected) return { error: 'Engine not connected' };
    try {
        // Audit log destructive sidecar actions
        const actionableMethods = ['input.typeString', 'input.sendChord', 'input.clickAt'];
        if (actionableMethods.includes(method)) {
            db.logAudit(`sidecar_${method}`, params).catch(e => console.error('[Audit]', e));
        }
        return await pipeClient.send(method, params);
    }
    catch (err) { return { error: err.message }; }
});

ipcMain.on('hud:set-ignore-mouse', (event, ignore, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        win.setIgnoreMouseEvents(ignore, options);
    }
});

ipcMain.handle('sidecar:status', () => ({
    connected: pipeClient.isConnected,
    sidecarRunning: sidecar.isRunning(),
}));

ipcMain.handle('app:openMain', () => {
    showMainWindow();
    return { opened: true };
});

ipcMain.handle('app:hideMain', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
        console.log('[friday] Main window hidden (VoiceClient running in background)');
    }
    return { hidden: true };
});

ipcMain.handle('app:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
    }
});

ipcMain.handle('app:quit', () => {
    app.quit();
});

ipcMain.handle('app:openExternal', async (_, url) => {
    console.log('[friday] Opening in default browser:', url);
    await shell.openExternal(url);
    return { opened: true };
});

ipcMain.handle('app:copyToClipboard', (_, text) => {
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return true;
});

ipcMain.handle('app:getSkills', async () => {
    const fs = require('fs');
    const skillsDir = path.join(__dirname, '..', 'skills');
    try {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (e) {
        console.warn('[friday] Could not read skills directory:', e.message);
        return [];
    }
});

ipcMain.handle('app:takeScreenshot', async () => {
    try {
        const { desktopCapturer } = require('electron');
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 1920, height: 1080 }
        });
        if (sources.length > 0) {
            const screenshot = sources[0].thumbnail.toJPEG(70);
            const base64 = screenshot.toString('base64');
            console.log(`[friday] Screenshot taken (${Math.round(base64.length / 1024)}KB)`);
            return { data: base64, mimeType: 'image/jpeg' };
        }
        return { error: 'No screen source found' };
    } catch (e) {
        console.error('[friday] Screenshot failed:', e);
        return { error: e.message };
    }
});

ipcMain.handle('browser:ping', async () => {
    if (browserServer.isConnected()) {
        return { connected: true };
    }
    return { connected: false, error: 'Extension not connected' };
});

ipcMain.handle('tasks:list', () => subAgents.getAllTasks());

ipcMain.handle('app:delegateTask', (_, taskDescription) => {
    if (!isAuthenticated) return { error: 'Unauthorized: Please sign in first' };
    console.log(`[friday] Delegating task: ${taskDescription}`);
    const jobId = subAgents.startTask(taskDescription, (res) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('voice:subAgentComplete', res);
        }
    });
    return { jobId };
});

ipcMain.handle('hud:minimize', () => {
    hideHUD();
    return { hidden: true };
});

// State sync: renderer tells main process about state changes
ipcMain.handle('state:set', (_, patch) => {
    setState(patch);
    return getState();
});

ipcMain.handle('state:get', () => getState());

ipcMain.handle('state:addMessage', async (_, role, text) => {
    const msgId = `msg-${uuidv4()}`;
    const activeSessionId = getState().activeSessionId;

    addMessage(role, text);

    if (activeSessionId) {
        try {
            await db.saveMessage(msgId, activeSessionId, role, text);
        } catch (err) {
            console.error('[friday] Failed to save message to DB:', err);
        }
    }
    return { ok: true };
});

// ─── Extension Installer IPC ────────────────────────────────────────────────

ipcMain.handle("install-extension", async (event) => {
    const EXTENSION_DIR = app.isPackaged
        ? path.join(process.resourcesPath, "extension")
        : path.join(__dirname, "..", "extension");

    return await installExtension(EXTENSION_DIR, {
        onStatus: (s) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("extension-install-status", s);
            }
        },
    });
});

ipcMain.handle("detect-browsers", async () => {
    return Object.keys(detectBrowsers());
});


// ── Secure Env Keys ───────────────────────────────────────────────

ipcMain.handle('env:getGeminiKey', () => {
    return process.env.GEMINI_API_KEY;
});

ipcMain.handle('env:getClerkKey', () => {
    return process.env.CLERK_PUBLISHABLE_KEY || '';
});

// ── Database IPC ──────────────────────────────────────────────────

ipcMain.handle('db:getSessions', async () => {
    return await db.getSessions();
});

ipcMain.handle('db:getMessages', async (_, sessionId) => {
    return await db.getMessages(sessionId);
});

ipcMain.handle('db:createSession', async (_, title) => {
    const id = `session-${Date.now()}`;
    await db.createSession(id, title);
    return id;
});

ipcMain.handle('db:deleteSession', async (_, id) => {
    return await db.deleteSession(id);
});

ipcMain.handle('db:setMemory', async (_, key, value, desc) => {
    return await db.setMemory(key, value, desc);
});

ipcMain.handle('db:getMemory', async (_, key) => {
    return await db.getMemory(key);
});

ipcMain.handle('db:getAllMemories', async () => {
    return await db.getAllMemories();
});

// ── Cleanup ──────────────────────────────────────────────────────────────

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    pipeClient.disconnect();
    sidecar.kill();
    console.log('[friday] Shutdown complete');
});

app.on('window-all-closed', () => { });
