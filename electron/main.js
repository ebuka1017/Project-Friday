// ═══════════════════════════════════════════════════════════════════════
// electron/main.js — Friday Agent Entry Point
// Orchestrates app lifecycle, HUD, main window, sidecar, and shared state.
// ═══════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, shell, Notification, dialog, protocol, Tray, Menu, screen, globalShortcut, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
require('dotenv').config();

let mainWindow = null; // Global reference for logging
let currentUser = null;
let isAuthenticated = false;

// ─── Environment Initialization ──────────────────────────────────────────────
const browserAgentManager = require('./browser-agent-manager');
const { createHUD, toggleHUD, hideHUD, getWindow } = require('./hud');
const sidecar = require('./sidecar-launcher');
const pipeClient = require('./pipe-client');
const searchTools = require('./search-tools');
const productivityTools = require('./productivity-tools');
// const path = require('path'); // This was moved up

// ─── Environment Initialization ──────────────────────────────────────────────
// ── Environment Initialization ──────────────────────────────────────────────
const envPath = process.env.NODE_ENV === 'development' || !app.isPackaged
    ? path.join(__dirname, '..', '.env')
    : path.join(process.resourcesPath, '.env');

require('dotenv').config({ path: envPath });

// Override console to broadcast logs to renderer
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function broadcastLog(level, ...args) {
    let message = "";
    try {
        message = args.map(a => {
            if (a instanceof Error) return `${a.message}\n${a.stack}`;
            return typeof a === 'object' ? JSON.stringify(a) : String(a);
        }).join(' ');
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
// ──────────────────────────────────────────────────────────────────────────────

const { registerDeepLink, setMainWindow, handleDeepLinkUrl } = require('./auth-main');

// Register deep link early, before app ready
registerDeepLink();

const { setState, getState, addMessage, broadcast } = require('./state');
const browserServer = require('./browser-server');
const subAgents = require('./sub-agents');
const AgentBrowser = require('./agent-browser');
const memoryManager = require('./memory-manager');
const mainAgentBrowser = new AgentBrowser('main', 'Friday');
const { startMCPServer } = require('./mcp-server');
const isAuth = () => isAuthenticated;
startMCPServer(isAuth);
const db = require('./db');
const { v4: uuidv4 } = require('uuid');
const { installExtension, detectBrowsers } = require("./extensionInstaller");
require('./clerk-fetch-user'); // Initialize the clerk fetch user ipc
const toolsRegistry = require('../shared/tools-registry');
const fsTools = require('./fs-tools');
const sysinfoTools = require('./sysinfo-tools');
const notificationTools = require('./notification-tools');
const networkTools = require('./network-tools');
const connectivityTester = require('./connectivity-tester');

// API Connectivity Checks
if (process.env.GEMINI_API_KEY) {
    // Delay slightly to ensure logs capture in renderer
    setTimeout(() => {
        connectivityTester.testAll().catch(e => console.error('[Connectivity] Startup test failed:', e));
    }, 1000);
} else {
    console.warn('[friday] GEMINI_API_KEY is MISSING after load');
}

// CRITICAL for HUD: Allow the background/hidden main window to start WebRTC AudioContext without user DOM clicks
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ── Auth & Session State ──────────────────────────────────────────────────

ipcMain.handle('auth:setStatus', (_, status, user) => {
    isAuthenticated = status;
    currentUser = user || null;
    setState({ currentUser }); // Sync to shared state for sub-agents
    console.log(`[Auth] User status: ${status}, User: ${currentUser?.email || 'none'}`);
    return true;
});

ipcMain.handle('app:getUserProfile', async () => {
    if (!isAuthenticated || !currentUser) return { error: 'Not signed in' };
    return currentUser;
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

// Window Management (Redundant batch removed, consolidated below)

ipcMain.handle('app:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
    }
});

// ── Browser Control (Strict Extension Bridge) ───────────────────────────
ipcMain.handle('browser:connect', () => {
    return browserServer.isConnected();
});
ipcMain.handle('browser:isConnected', () => {
    return browserServer.isConnected();
});
ipcMain.handle('browser:disconnect', () => {
    return !browserServer.isConnected();
});

// Helper to ensure extension is connected before any browser action
async function ensureExtension() {
    if (!browserServer.isConnected()) {
        throw new Error("Extension Disconnected: Please connect the Friday Chrome extension to proceed.");
    }
}

ipcMain.handle('browser:navigate', async (_, url) => {
    try {
        await ensureExtension();
        db.logAudit('browser_navigate', { url }).catch(e => console.error('[Audit]', e));
        return await browserServer.navigate(url);
    } catch (e) {
        console.error('[Browser] Navigate Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:createTab', async (_, url) => {
    try {
        await ensureExtension();
        db.logAudit('browser_createtab', { url }).catch(e => console.error('[Audit]', e));
        return await browserServer.createTab(url);
    } catch (e) {
        console.error('[Browser] CreateTab Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:evaluate', async (_, expression) => {
    try {
        await ensureExtension();
        db.logAudit('browser_evaluate', { expression }).catch(e => console.error('[Audit]', e));
        return await browserServer.evaluate(expression);
    } catch (e) {
        console.error('[Browser] Evaluate Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:getDOM', async () => {
    try {
        await ensureExtension();
        return await browserServer.getDOM();
    } catch (e) {
        console.error('[Browser] GetDOM Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:goBack', async () => {
    try {
        await ensureExtension();
        db.logAudit('browser_goback').catch(e => console.error('[Audit]', e));
        return await browserServer.goBack();
    } catch (e) {
        console.error('[Browser] GoBack Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:goForward', async () => {
    try {
        await ensureExtension();
        db.logAudit('browser_goforward').catch(e => console.error('[Audit]', e));
        return await browserServer.goForward();
    } catch (e) {
        console.error('[Browser] GoForward Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:click', async (_, target) => {
    try {
        await ensureExtension();
        db.logAudit('browser_click', { target }).catch(e => console.error('[Audit]', e));
        return await browserServer.click(target);
    } catch (e) {
        console.error('[Browser] Click Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:type', async (_, target, text) => {
    try {
        await ensureExtension();
        db.logAudit('browser_type', { target, text }).catch(e => console.error('[Audit]', e));
        return await browserServer.typeTarget(target, text);
    } catch (e) {
        console.error('[Browser] Type Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:pressKey', async (_, key) => {
    try {
        await ensureExtension();
        db.logAudit('browser_press_key', { key }).catch(e => console.error('[Audit]', e));
        return await browserServer.pressKey(key);
    } catch (e) {
        console.error('[Browser] PressKey Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('browser:screenshot', async () => {
    try {
        await ensureExtension();
        db.logAudit('browser_screenshot').catch(e => console.error('[Audit]', e));
        return await browserServer.screenshot();
    } catch (e) {
        console.error('[Browser] Screenshot Error:', e.message);
        return { error: e.message };
    }
});
ipcMain.handle('browser:annotate', async () => {
    try { return await browserServer.annotateInteractiveElements(); }
    catch (e) { console.error('[Browser] Annotate Error:', e.message); return null; }
});
ipcMain.handle('browser:clearAnnotations', async () => {
    try { return await browserServer.removeAnnotations(); }
    catch (e) { console.error('[Browser] ClearAnnotations Error:', e.message); return null; }
});

ipcMain.handle('app:getSystemInfo', async () => {
    try {
        db.logAudit('get_system_info').catch(e => console.error('[Audit]', e));
        return await sysinfoTools.getSystemInfo();
    } catch (e) {
        console.error('[SysInfo] IPC Error:', e.message);
        return { error: e.message };
    }
});

ipcMain.handle('app:showNotification', async (_, title, body) => {
    try {
        db.logAudit('show_notification', { title }).catch(e => console.error('[Audit]', e));
        return notificationTools.showNotification(title, body);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('app:showMessageDialog', async (_, options) => {
    try {
        db.logAudit('show_message_dialog', { title: options.title }).catch(e => console.error('[Audit]', e));
        return await notificationTools.showMessageDialog(options);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('app:httpRequest', async (_, options) => {
    try {
        db.logAudit('http_request', { url: options.url, method: options.method }).catch(e => console.error('[Audit]', e));
        return await networkTools.httpRequest(options);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('app:webSearch', async (_, query) => {
    try {
        db.logAudit('web_search', { query }).catch(e => console.error('[Audit]', e));
        return await searchTools.webSearch(query);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('app:webDeepdive', async (_, url) => {
    try {
        db.logAudit('web_deepdive', { url }).catch(e => console.error('[Audit]', e));
        return await searchTools.webDeepdive(url);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('app:openConnector', async () => {
    // Direct users to Clerk's hosted profile page to manage social connections
    // The user's specific instance URL as requested:
    const clerkAccountUrl = 'https://singular-alien-87.accounts.dev/user';
    await shell.openExternal(clerkAccountUrl);
    return { success: true };
});

// ── Rich Media Metadata Fetchers ──────────────────────────────────────────
const cheerio = require('cheerio');
const axios = require('axios');

ipcMain.handle('app:fetchLinkPreview', async (event, url) => {
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FridayBot/1.0)' },
            timeout: 5000
        });
        const html = response.data;
        const $ = cheerio.load(html);
        
        const og = p => $(`meta[property="${p}"]`).attr('content') || $(`meta[name="${p}"]`).attr('content') || '';
        
        return {
            title: og('og:title') || $('title').text() || url,
            description: og('og:description') || og('description') || '',
            image: og('og:image') || '',
            site: og('og:site_name') || '',
            favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`,
        };
    } catch (e) {
        console.error('[RichMedia] Link preview error:', e.message);
        return { title: url, error: e.message };
    }
});

ipcMain.handle('app:fetchIframely', async (event, url) => {
    const key = process.env.IFRAMELY_KEY;
    if (!key) return null;
    try {
        const response = await axios.get(`https://cdn.iframe.ly/api/iframely?url=${encodeURIComponent(url)}&key=${key}&omit_script=1`);
        return response.data;
    } catch (e) {
        console.error('[RichMedia] Iframely error:', e.message);
        return null;
    }
});

// ── Productivity Tools ──

ipcMain.handle('app:gmailList', async () => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.gmailList(currentUser.id);
});

ipcMain.handle('app:gmailRead', async (_, id) => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.gmailRead(currentUser.id, id);
});

ipcMain.handle('app:gmailSend', async (_, args) => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.gmailSend(currentUser.id, args);
});

ipcMain.handle('app:calendarGoogleList', async () => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.calendarGoogleList(currentUser.id);
});

ipcMain.handle('app:calendarGoogleCreate', async (_, event) => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.calendarGoogleCreate(currentUser.id, event);
});

ipcMain.handle('app:driveList', async (_, query) => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.driveList(currentUser.id, query);
});

ipcMain.handle('app:driveRead', async (_, fileId) => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.driveRead(currentUser.id, fileId);
});

ipcMain.handle('app:outlookList', async () => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.outlookList(currentUser.id);
});

ipcMain.handle('app:outlookSend', async (_, args) => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.outlookSend(currentUser.id, args);
});

ipcMain.handle('app:calendarOutlookList', async () => {
    if (!currentUser) return { error: 'Not authenticated' };
    return await productivityTools.calendarOutlookList(currentUser.id);
});

// ── Shared Tools Registry ────────────────────────────────────────────────
ipcMain.handle('app:getAgentTools', () => {
    return toolsRegistry.getAllTools();
});

ipcMain.handle('app:getVoiceTools', () => {
    return toolsRegistry.getVoiceTools();
});

// ── Memory Management (Zep Cloud & Local) ────────────────────────────────
ipcMain.handle('memory:save', async (_, content) => {
    if (!currentUser) return { success: false, error: 'Not authenticated' };
    return await memoryManager.saveToMemory(currentUser.id, content);
});

ipcMain.handle('memory:search', async (_, query) => {
    if (!currentUser) return { success: false, error: 'Not authenticated' };
    return await memoryManager.searchMemory(currentUser.id, query);
});

// ── Native File System Tools ─────────────────────────────────────────────
ipcMain.handle('fs:listDirectory', async (_, path) => {
    try {
        db.logAudit('fs_list_directory', { path }).catch(e => console.error('[Audit]', e));
        return await fsTools.listDirectory(path);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs:readFileStr', async (_, path) => {
    try {
        db.logAudit('fs_read_file', { path }).catch(e => console.error('[Audit]', e));
        return await fsTools.readFileStr(path);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs:writeFileStr', async (_, path, content) => {
    try {
        db.logAudit('fs_write_file', { path }).catch(e => console.error('[Audit]', e));
        return await fsTools.writeFileStr(path, content);
    } catch (e) {
        return { success: false, error: e.message };
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
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        setState({ screenResolution: { width, height } });
        console.log(`[friday] Screen resolution detected: ${width}x${height}`);

        createHUD();
        console.log('[friday] App ready — initializing...');

        // Start Browser extension WebSocket bridge
        browserServer.start();

        // Start Model Context Protocol Server
        startMCPServer();

        // Initialize browser agent update bridge (No auto-warmup per user request)
        try {
            browserAgentManager.setUpdateCallback((msg) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('browser-agent-update', msg);
                }
            });
        } catch (err) {
            console.error('[Main] Failed to setup browser agent bridge:', err);
        }

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

        // Sync local memory to Zep Cloud if online
        if (process.env.ZEP_API_KEY) {
            const userId = getState().currentUser?.id || 'default_user';
            memoryManager.syncLocalToZep(userId).catch(e => console.error('[Memory] Background sync failed:', e.message));
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


ipcMain.handle('run-browser-task', async (event, task) => {
    return new Promise((resolve) => {
        subAgents.startTask(task,
            (res) => resolve(res),
            (update) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('voice:subAgentUpdate', update);
                }
            }
        );
    });
});

// ── MiroFish Sidecar Tools ──────────────────────────────────────────

const spawnSidecar = (script, input) => {
    return new Promise((resolve) => {
        const py = spawn('python', [path.join(__dirname, '../sidecar', script)], {
            env: { ...process.env, PYTHONPATH: process.cwd() }
        });
        let result = '';
        py.stdout.on('data', d => result += d.toString());
        py.stderr.on('data', d => console.error(`[${script} Error]`, d.toString()));
        py.on('close', () => {
            try { resolve(JSON.parse(result.trim())); }
            catch(e) { resolve({ error: 'Failed to parse model output' }); }
        });
        py.stdin.write(JSON.stringify(input) + '\n');
        py.stdin.end();
    });
};

ipcMain.handle('app:saveToMemory', async (_, content) => {
    const state = getState();
    const id = state.currentUser ? state.currentUser.id : 'default_user';
    return await memoryManager.saveToMemory(id, content);
});

ipcMain.handle('app:searchMemory', async (_, query) => {
    const state = getState();
    const id = state.currentUser ? state.currentUser.id : 'default_user';
    return await memoryManager.searchMemory(id, query);
});

ipcMain.handle('app:analyzeDocument', async (_, text) => {
    return await spawnSidecar('ontology.py', { action: 'extract', text });
});

// ── Generic IPC Handlers ──

// ── IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('sidecar:send', async (_, method, params) => {
    if (!isAuthenticated) return { error: 'Unauthorized: Please sign in first' };
    if (!pipeClient.isConnected) return { error: 'Engine not connected' };
    try {
        const actionableMethods = ['input.typeString', 'input.sendChord', 'input.clickAt', 'process.kill'];
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

ipcMain.handle('app:maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
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

ipcMain.handle('app:browseVisual', (_, taskDescription) => {
    if (!isAuthenticated) return { error: 'Unauthorized: Please sign in first' };
    console.log(`[friday] Delegating VISUAL task: ${taskDescription}`);
    const jobId = subAgents.startVisualTask(
        taskDescription, 
        (res) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice:subAgentComplete', res);
            }
        },
        (update) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice:subAgentUpdate', update);
            }
        }
    );
    return { jobId };
});

ipcMain.handle('app:delegateTask', (_, taskDescription) => {
    if (!isAuthenticated) return { error: 'Unauthorized: Please sign in first' };
    console.log(`[friday] Delegating task: ${taskDescription}`);
    const jobId = subAgents.startTask(
        taskDescription, 
        (res) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice:subAgentComplete', res);
            }
        },
        (update) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice:subAgentUpdate', update);
            }
        }
    );
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

ipcMain.handle('state:addMessage', async (_, role, text, image) => {
    const msgId = `msg-${uuidv4()}`;
    const activeSessionId = getState().activeSessionId;

    addMessage(role, text, image);

    if (activeSessionId) {
        try {
            await db.saveMessage(msgId, activeSessionId, role, text, image);
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
ipcMain.handle('env:getClerkDomain', () => process.env.CLERK_DOMAIN || 'clerk.algospend.tech');
ipcMain.handle('env:getClerkAccountUrl', () => process.env.CLERK_ACCOUNT_URL || `https://accounts.algospend.tech/user`);



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

ipcMain.handle('db:setMemory', (_, key, val, desc) => db.setMemory(key, val, desc));
ipcMain.handle('db:getMemory', (_, key) => db.getMemory(key));
ipcMain.handle('db:getAllMemories', () => db.getAllMemories());
ipcMain.handle('db:setSecret', (_, key, val) => db.setSecret(key, val));
ipcMain.handle('db:getSecret', (_, key) => db.getSecret(key));

// ── Jarvis Ambient Vision Loop ─────────────────────────────────────────────
// Periodically capture full screen and broadcast via state:vision
// This provides a "see what I see" stream for the agent to use as context.
const backgroundVisionLoop = setInterval(async () => {
    const currentState = getState();
    // Only capture if we are in an active session (status or engine connected)
    if (currentState.status !== 'idle' || pipeClient.isConnected) {
       try {
           const { desktopCapturer } = require('electron');
           const sources = await desktopCapturer.getSources({
               types: ['screen'],
               thumbnailSize: { width: 1280, height: 720 } // Leaner for background
           });
           if (sources.length > 0) {
               const b64 = sources[0].thumbnail.toJPEG(60).toString('base64');
               broadcast('state:vision', { data: b64 });
           }
       } catch (err) { /* Silent fail */ }
    }
}, 10000); // Jarvis pulses every 10 seconds

// ── Cleanup ──────────────────────────────────────────────────────────────

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    pipeClient.disconnect();
    sidecar.kill();
    console.log('[friday] Shutdown complete');
});

app.on('window-all-closed', () => { });
