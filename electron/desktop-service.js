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
                const osState = await pipeClient.send('get_desktop_state', {
                    include_tree: useAccessibility,
                    include_screenshot: useVision
                });
                state.os = osState;
            }

            // 2. Get Browser State (if an agent browser is provided)
            if (browser) {
                state.browser.activeTab = {
                    title: await browser.evaluate('document.title'),
                    url: await browser.evaluate('window.location.href')
                };
                if (useAccessibility) {
                    state.browser.dom = await browser.getDOM();
                }
            }

            this._cachedState = state;
            return state;
        } catch (err) {
            console.error('[DesktopService] State capture failed:', err);
            return { error: err.message, timestamp: state.timestamp };
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
