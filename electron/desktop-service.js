// ═══════════════════════════════════════════════════════════════════════
// electron/desktop-service.js — Unified Perception Provider
// Merges OS-level UIA data (via Sidecar) and Browser DOM data.
// ═══════════════════════════════════════════════════════════════════════

const pipeClient = require('./pipe-client');
const { getState } = require('./state');

class DesktopService {
    constructor() {
        this._cachedState = null;
    }

    /**
     * Get a unified snapshot of the desktop and browser state.
     * @param {object} options - { useVision, useAccessibility, browser }
     */
    async getFullState(options = {}) {
        const { useVision = true, useAccessibility = true, browser = null } = options;
        
        const state = {
            timestamp: new Date().toISOString(),
            os: {
                activeWindow: null,
                windows: [],
                tree: null,
                screenshot: null
            },
            browser: {
                activeTab: null,
                dom: null
            }
        };

        try {
            // 1. Get OS State via Sidecar
            if (pipeClient.isConnected) {
                // Sidecar doesn't have "get_desktop_state" as a single call anymore.
                // We split it into UIA dump and Window list.
                const [tree, windows] = await Promise.all([
                    useAccessibility ? pipeClient.send('uia.dumpTree') : Promise.resolve(null),
                    pipeClient.send('window.list')
                ]);
                
                state.os.tree = tree;
                state.os.windows = windows;
                
                if (windows && windows.length > 0) {
                    state.os.activeWindow = windows.find(w => w.isFocused) || windows[0];
                }
            }

            // 2. Capture Vision (Always useful for multi-modal)
            if (useVision) {
                // We use the electron utility to capture screen
                const { desktopCapturer } = require('electron');
                const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 }});
                if (sources.length > 0) {
                    state.os.screenshot = sources[0].thumbnail.toJPEG(70).toString('base64');
                }
            }

            // 3. Get Browser State (if an agent browser is provided)
            if (browser) {
                try {
                    state.browser.activeTab = {
                        title: await browser.evaluate('document.title'),
                        url: await browser.evaluate('window.location.href')
                    };
                    if (useAccessibility) {
                        state.browser.dom = await browser.getDOM();
                    }
                } catch (be) {
                    console.warn('[DesktopService] Browser state capture partial failure:', be.message);
                }
            }

            this._cachedState = state;
            return state;
        } catch (err) {
            const errorMsg = err.message || JSON.stringify(err);
            console.error('[DesktopService] State capture failed:', errorMsg, err.stack);
            return { error: errorMsg, timestamp: state.timestamp };
        }
    }

    /**
     * Finds a UI element regardless of whether it's in a native app or the browser.
     */
    async findInteractiveElement(selector, browser = null) {
        // If it looks like a coordinate, return it
        if (/^\d+,\d+$/.test(selector)) {
            const [x, y] = selector.split(',').map(Number);
            return { type: 'coordinate', x, y };
        }

        // 1. Try Browser first if available
        if (browser) {
            try {
                const browserEl = await browser.evaluate(`
                    (() => {
                        const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
                        if (!el) return null;
                        const rect = el.getBoundingClientRect();
                        return { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
                    })()
                `);
                if (browserEl) return { type: 'browser', ...browserEl };
            } catch (e) {}
        }

        // 2. Try OS-level Search
        if (pipeClient.isConnected) {
            try {
                const osEl = await pipeClient.send('find_element', { name: selector });
                if (osEl && osEl.x) return { type: 'os', ...osEl };
            } catch (e) {}
        }

        return null;
    }
}

module.exports = new DesktopService();
