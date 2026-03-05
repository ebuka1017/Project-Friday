// ═══════════════════════════════════════════════════════════════════════
// electron/hud.js — HUD Window Manager
// Creates the transparent, always-on-top, draggable HUD overlay.
// Uses CSS-based click-through (not WS_EX_TRANSPARENT) so the panel
// itself remains interactive while the surrounding area passes clicks.
// ═══════════════════════════════════════════════════════════════════════

const { BrowserWindow } = require('electron');
const path = require('path');

let hudWindow = null;

/**
 * Create the HUD overlay window.
 * @returns {BrowserWindow}
 */
function createHUD() {
    hudWindow = new BrowserWindow({
        width: 320,
        height: 290,
        x: 20,
        y: 80,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        // CRITICAL: HUD must be focusable so users can click its buttons
        focusable: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Load the HUD renderer
    hudWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // transparent: true already makes transparent pixels click-through.
    // CSS pointer-events handles the rest. No setIgnoreMouseEvents needed.

    hudWindow.once('ready-to-show', () => {
        hudWindow.showInactive();
        console.log('[hud] Ready and visible');
    });

    hudWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[hud:log] ${message}`);
    });

    hudWindow.on('closed', () => {
        hudWindow = null;
    });

    return hudWindow;
}

/**
 * Hide the HUD.
 */
function hideHUD() {
    if (hudWindow && hudWindow.isVisible()) {
        hudWindow.hide();
        console.log('[hud] Hidden');
    }
}

/**
 * Toggle HUD visibility.
 */
function toggleHUD() {
    if (!hudWindow) return;
    if (hudWindow.isVisible()) {
        hudWindow.hide();
        console.log('[hud] Hidden');
    } else {
        hudWindow.showInactive();
        console.log('[hud] Shown');
    }
}

/**
 * Get the HUD window instance.
 */
function getWindow() {
    return hudWindow;
}

module.exports = { createHUD, toggleHUD, hideHUD, getWindow };
