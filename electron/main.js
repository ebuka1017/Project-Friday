// ═══════════════════════════════════════════════════════════════════════
// electron/main.js — Friday Agent Entry Point
// Orchestrates app lifecycle, HUD, main window, sidecar, and shared state.
// ═══════════════════════════════════════════════════════════════════════

const { app, globalShortcut, ipcMain, BrowserWindow, session, shell } = require('electron');
const { createHUD, toggleHUD, hideHUD, getWindow } = require('./hud');
const sidecar = require('./sidecar-launcher');
const pipeClient = require('./pipe-client');
const { setState, getState, addMessage } = require('./state');
const browserServer = require('./browser-server');
const path = require('path');
require('dotenv').config();

// CRITICAL for HUD: Allow the background/hidden main window to start WebRTC AudioContext without user DOM clicks
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Securely provide API Key to renderer (only provide if it exists)
ipcMain.handle('env:getGeminiKey', () => process.env.GEMINI_API_KEY || null);

let mainWindow = null;

// Voice control routing (HUD -> Main Window)
ipcMain.handle('voice:start', () => {
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
        return await browserServer.navigate(url);
    } catch (e) {
        console.error('[Browser] Navigate Error:', e);
        return false;
    }
});
ipcMain.handle('browser:evaluate', async (_, expression) => {
    try {
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

// ── App Lifecycle ────────────────────────────────────────────────────────

app.whenReady().then(async () => {
    console.log('[friday] App ready — initializing...');

    // Start Browser extension WebSocket bridge
    browserServer.start();

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

    createHUD();
    initMainWindow(); // Initialize VoiceClient silently in the background
    registerHotkey();

    // Grant media permissions automatically so the hidden window doesn't crash on getUserMedia()
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        if (permission === 'media') return true;
        return false;
    });
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media') callback(true);
        else callback(false);
    });

    console.log('[friday] Initialization complete');
});

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
        console.log(`[app:log] ${message}`);
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
    const registered = globalShortcut.register('CommandOrControl+Q', () => {
        toggleHUD();
    });

    if (registered) {
        console.log('[hotkey] Ctrl+Q registered');
    } else {
        console.warn('[hotkey] Ctrl+Q taken — using Ctrl+Shift+Space');
        globalShortcut.register('CommandOrControl+Shift+Space', () => toggleHUD());
    }
}

// ── IPC Handlers ────────────────────────────────────────────────────────

ipcMain.handle('sidecar:send', async (_, method, params) => {
    if (!pipeClient.isConnected) return { error: 'Engine not connected' };
    try { return await pipeClient.send(method, params); }
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

ipcMain.handle('app:openExternal', async (_, url) => {
    console.log('[friday] Opening in default browser:', url);
    await shell.openExternal(url);
    return { opened: true };
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

ipcMain.handle('state:addMessage', (_, role, text) => {
    addMessage(role, text);
    return { ok: true };
});

// ── Cleanup ──────────────────────────────────────────────────────────────

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    pipeClient.disconnect();
    sidecar.kill();
    console.log('[friday] Shutdown complete');
});

app.on('window-all-closed', () => { });
