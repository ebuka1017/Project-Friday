// ═══════════════════════════════════════════════════════════════════════
// electron/browser-server.js — Friday WebSocket Bridge
// Hosts a local ws server that the Friday Chrome extension connects to.
// Relays commands (navigate, DOM) from IPC to the extension debugger.
// ═══════════════════════════════════════════════════════════════════════

const WebSocket = require('ws');

class BrowserServer {
    constructor() {
        this.wss = null;
        this.extensionSocket = null;
        this.port = 8765;
        this.messageCounter = 1;
        this.pendingRequests = new Map();
    }

    start() {
        if (this.wss) return;

        this.wss = new WebSocket.Server({ port: this.port, host: '127.0.0.1' });
        console.log(`[BrowserServer] Listening for extension on ws://127.0.0.1:${this.port}`);

        this.wss.on('connection', (ws, req) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const clientId = url.searchParams.get('clientId') || 'unknown';
            const secret = url.searchParams.get('secret');

            // Security: Verify extension secret
            if (secret !== global.extensionSecret) {
                console.error(`[BrowserServer] Unauthorized connection attempt from ${clientId}`);
                ws.close(4001, 'Unauthorized');
                return;
            }

            const hadExisting = !!this.extensionSocket;

            // Silently close old socket if it exists
            if (this.extensionSocket) {
                try { this.extensionSocket.close(4000, 'replaced'); } catch (e) {}
                // BUG-007: Reject pending requests on replacement to avoid hanging
                for (const [id, req] of this.pendingRequests.entries()) {
                    req.reject(new Error('Connection replaced'));
                    this.pendingRequests.delete(id);
                }
            }

            this.extensionSocket = ws;
            this.extensionSocket.clientId = clientId;

            // Only log the first connection, not every service worker restart
            if (!hadExisting) {
                console.log(`[BrowserServer] Extension connected (ID: ${clientId})`);
            }

            ws.on('message', (message) => {
                this.handleMessage(message);
            });

            ws.on('close', (code) => {
                if (this.extensionSocket === ws) {
                    this.extensionSocket = null;
                    if (code !== 4000) {
                        console.log(`[BrowserServer] Extension disconnected`);
                    }
                    for (const [id, req] of this.pendingRequests.entries()) {
                        req.reject(new Error('Browser disconnected'));
                        this.pendingRequests.delete(id);
                    }
                }
            });

            ws.on('error', () => {});
        });
    }

    handleMessage(data) {
        try {
            const msg = JSON.parse(data);

            // If it's a response to a command we sent
            if (msg.id && this.pendingRequests.has(msg.id)) {
                const req = this.pendingRequests.get(msg.id);
                if (req.timeoutId) clearTimeout(req.timeoutId); // BUG-013: Clear timeout
                this.pendingRequests.delete(msg.id);

                if (msg.error) req.reject(new Error(msg.error));
                else req.resolve(msg.result);
            } else if (msg.event) {
                // Future: handle unsolicited events from the extension (like page loads)
                console.log(`[BrowserServer] Event: ${msg.event}`, msg.data);
            }
        } catch (err) {
            console.error('[BrowserServer] Failed to handle message:', err);
        }
    }

    sendRequest(method, params = {}, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            if (!this.extensionSocket || this.extensionSocket.readyState !== WebSocket.OPEN) {
                return reject(new Error('Browser extension is not connected'));
            }

            this.pendingRequests.set(id, { resolve, reject });

            this.extensionSocket.send(JSON.stringify({ id, method, params }));

            // BUG-013: Store timeoutId to clear it later and prevent leak
            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Timeout waiting for ${method} (${timeoutMs}ms)`));
                }
            }, timeoutMs);
            
            this.pendingRequests.get(id).timeoutId = timeoutId;
        });
    }

    isConnected() {
        return this.extensionSocket !== null && this.extensionSocket.readyState === WebSocket.OPEN;
    }

    // ── Command Helpers ────────────────────────────────────────────────────────

    /** Navigates the active tab to a URL */
    async navigate(url) {
        return await this.sendCDP("Page.navigate", { url });
    }

    /** Opens a new tab with the specified URL */
    async createTab(url) {
        return await this.sendRequest('browser_create_tab', { url });
    }

    /** Extracts HTML structure and text */
    async getDOM() {
        // Fallback for current sub-agents.js
        const script = `
            (() => {
                return {
                    title: document.title,
                    url: window.location.href,
                    text: document.body.innerText.substring(0, 5000)
                };
            })()
        `;
        const res = await this.evaluate(script);
        return res;
    }

    /** Evaluates stringified JS in the active tab */
    async evaluate(expression) {
        const res = await this.sendCDP("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true
        });
        if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception.description);
        return res.result.value;
    }

    /** Capture Chrome tab screenshot using CDP */
    async captureScreenshot() {
        const result = await this.sendCDP("Page.captureScreenshot", { format: "jpeg", quality: 80 });
        if (result && result.data) return result.data;
        return null;
    }

    /** Aliased to screenshot to match AgentBrowser */
    async screenshot() {
        return await this.captureScreenshot();
    }

    /** Navigates back in history */
    async goBack() {
        return await this.evaluate("window.history.back()");
    }

    /** Navigates forward in history */
    async goForward() {
        return await this.evaluate("window.history.forward()");
    }

    /** Send raw CDP command */
    async sendCDP(command, args = {}) {
        return await this.sendRequest('cdp', { command, args });
    }

    // ── chrome-devtools-mcp Compatible Tools ──────────────────────────────

    async clickAt(x, y) {
        await this.sendCDP("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await new Promise(r => setTimeout(r, 50));
        await this.sendCDP("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        return { success: true };
    }

    async hover(x, y) {
        await this.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        return { success: true };
    }

    async type(text) {
        for (const char of text) {
            await this.sendCDP("Input.dispatchKeyEvent", { type: "char", text: char });
            await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
        }
        return { success: true };
    }

    async pressKey(key) {
        // Simplified key mapping for common keys
        const command = { type: "keyDown", key };
        await this.sendCDP("Input.dispatchKeyEvent", command);
        await new Promise(r => setTimeout(r, 50));
        command.type = "keyUp";
        await this.sendCDP("Input.dispatchKeyEvent", command);
        return { success: true };
    }

    /** Resolve target using Phase 1 (A11y) with retries */
    async resolveWebTarget(target, retries = 3) {
        for (let i = 0; i < retries; i++) {
            // Phase 1: Accessibility tree
            try {
                const axTree = await this.sendCDP("Accessibility.getFullAXTree");
                const nodes = axTree.nodes || [];

                const targetLower = target.toLowerCase();
                let candidates = [];

                for (let node of nodes) {
                    let name = node.name && node.name.value ? node.name.value.toLowerCase() : "";
                    let role = node.role && node.role.value ? node.role.value : "";
                    
                    if (name && (name === targetLower || name.includes(targetLower))) {
                        candidates.push({ node, score: name === targetLower ? 0 : 1 });
                    }
                }

                if (candidates.length > 0) {
                    candidates.sort((a, b) => a.score - b.score);
                    const bestNode = candidates[0].node;

                    if (bestNode.backendDOMNodeId) {
                        try {
                            const boxResult = await this.sendCDP("DOM.getBoxModel", { backendNodeId: bestNode.backendDOMNodeId });
                            const content = boxResult.model.content;
                            if (content && content.length >= 8) {
                                const x = content[0], y = content[1];
                                const w = content[2] - content[0], h = content[5] - content[1];
                                return { x: Math.floor(x + w / 2), y: Math.floor(y + h / 2) };
                            }
                        } catch (e) {
                            // Fallback to JS if getBoxModel fails (some nodes are tricky)
                            const nodeIdRes = await this.sendCDP("DOM.requestNode", { backendNodeId: bestNode.backendDOMNodeId });
                            const describeRes = await this.sendCDP("DOM.describeNode", { nodeId: nodeIdRes.nodeId });
                            // This is complex, JS is often safer
                        }
                    }
                }
            } catch (e) {
                console.error("[BrowserServer] A11y Resolve Error:", e);
            }
            if (i < retries - 1) await new Promise(r => setTimeout(r, 1000));
        }
        return null;
    }

    /** Clicks a target using A11y or CSS selector fallback */
    async clickTarget(target) {
        let coords = null;
        if (typeof target === 'string' && target.includes(",")) {
            const parts = target.split(",");
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                coords = { x: parseInt(parts[0]), y: parseInt(parts[1]) };
            }
        }

        if (!coords) coords = await this.resolveWebTarget(target);

        if (coords) {
            return await this.clickAt(coords.x, coords.y);
        }

        // Fallback to evaluating JS if it is a CSS selector
        const script = `
            (() => {
                const el = document.querySelector("${target.replace(/"/g, '\\"')}");
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            })()
        `;
        const jsCoords = await this.evaluate(script);
        if (jsCoords) {
            return await this.clickAt(jsCoords.x, jsCoords.y);
        }

        throw new Error(`Target '${target}' not found. Try coordinates or a clearer selector.`);
    }

    /** Types text into an element */
    async typeTarget(target, text) {
        await this.clickTarget(target);
        return await this.type(text);
    }
}

// Singleton
module.exports = new BrowserServer();
