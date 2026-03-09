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

        this.wss.on('connection', (ws) => {
            console.log('[BrowserServer] Extension connected!');

            // Only allow one bridge connection at a time
            if (this.extensionSocket) {
                this.extensionSocket.close();
            }
            this.extensionSocket = ws;

            ws.on('message', (message) => {
                this.handleMessage(message);
            });

            ws.on('close', () => {
                console.log('[BrowserServer] Extension disconnected.');
                if (this.extensionSocket === ws) {
                    this.extensionSocket = null;
                    // Fail pending requests
                    for (const [id, req] of this.pendingRequests.entries()) {
                        req.reject(new Error('Browser disconnected'));
                        this.pendingRequests.delete(id);
                    }
                }
            });

            ws.on('error', (err) => {
                console.error('[BrowserServer] Socket error:', err);
            });
        });
    }

    handleMessage(data) {
        try {
            const msg = JSON.parse(data);

            // If it's a response to a command we sent
            if (msg.id && this.pendingRequests.has(msg.id)) {
                const req = this.pendingRequests.get(msg.id);
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

    sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.extensionSocket || this.extensionSocket.readyState !== WebSocket.OPEN) {
                return reject(new Error('Browser extension is not connected'));
            }

            const id = this.messageCounter++;
            this.pendingRequests.set(id, { resolve, reject });

            this.extensionSocket.send(JSON.stringify({ id, method, params }));

            // Timeout after 15 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Timeout waiting for ${method}`));
                }
            }, 15000);
        });
    }

    isConnected() {
        return this.extensionSocket !== null && this.extensionSocket.readyState === WebSocket.OPEN;
    }

    // ── Command Helpers ────────────────────────────────────────────────────────

    /** Navigates the active tab to a URL */
    async navigate(url) {
        return await this.sendRequest('navigate', { url });
    }

    /** Extracts HTML structure and text */
    async getDOM() {
        return await this.sendRequest('getDOM');
    }

    /** Evaluates stringified JS in the active tab */
    async evaluate(expression) {
        return await this.sendRequest('evaluate', { expression });
    }

    /** Draw Set-of-Marks bounding boxes for vision fallback */
    async annotateInteractiveElements() {
        const script = `
            (() => {
                document.querySelectorAll('.friday-som-label').forEach(el => el.remove());
                const interactiveSelectors = "button, a, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [tabindex]";
                const elements = Array.from(document.querySelectorAll(interactiveSelectors)).filter(el => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 4 && rect.height > 4 && rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
                });

                const boxes = [];
                elements.slice(0, 60).forEach((el, i) => {
                    const rect = el.getBoundingClientRect();
                    const cx = Math.floor(rect.left + rect.width / 2);
                    const cy = Math.floor(rect.top + rect.height / 2);
                    
                    const label = document.createElement('div');
                    label.className = 'friday-som-label';
                    label.textContent = i;
                    label.style.position = 'absolute';
                    label.style.left = (cx - 12 + window.scrollX) + 'px';
                    label.style.top = (cy - 12 + window.scrollY) + 'px';
                    label.style.width = '24px'; label.style.height = '24px';
                    label.style.backgroundColor = 'rgba(220, 30, 30, 0.9)';
                    label.style.color = 'white'; label.style.borderRadius = '50%';
                    label.style.display = 'flex'; label.style.alignItems = 'center';
                    label.style.justifyContent = 'center'; label.style.fontSize = '12px';
                    label.style.fontWeight = 'bold'; label.style.pointerEvents = 'none';
                    label.style.zIndex = '999999'; label.style.border = '2px solid white';
                    document.body.appendChild(label);

                    boxes.push({ id: i, cx, cy });
                });
                return boxes;
            })();
        `;
        return await this.evaluate(script);
    }

    /** Remove Set-of-Marks bounding boxes */
    async removeAnnotations() {
        return await this.evaluate(`document.querySelectorAll('.friday-som-label').forEach(el => el.remove());`);
    }

    /** Capture Chrome tab screenshot using CDP */
    async captureScreenshot() {
        const result = await this.sendCDP("Page.captureScreenshot", { format: "jpeg", quality: 80 });
        if (result && result.data) return result.data;
        return null;
    }

    /** Navigates back in history */
    async goBack() {
        return await this.sendRequest('goBack');
    }

    /** Navigates forward in history */
    async goForward() {
        return await this.sendRequest('goForward');
    }

    /** Send raw CDP command */
    async sendCDP(command, args = {}) {
        return await this.sendRequest('cdp', { command, args });
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

                    if (name && (name === targetLower || name.includes(targetLower))) {
                        candidates.push({ node, score: name === targetLower ? 0 : 1 });
                    }
                }

                if (candidates.length > 0) {
                    candidates.sort((a, b) => a.score - b.score);
                    const bestNode = candidates[0].node;

                    if (bestNode.backendDOMNodeId) {
                        const boxResult = await this.sendCDP("DOM.getBoxModel", { backendNodeId: bestNode.backendDOMNodeId });
                        const content = boxResult.model.content;
                        if (content && content.length >= 8) {
                            const x = content[0], y = content[1];
                            const w = content[2] - content[0], h = content[5] - content[1];
                            return { x: Math.floor(x + w / 2), y: Math.floor(y + h / 2) };
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

    /** Move mouse carefully and naturally */
    async humanMouseMove(x, y) {
        this.mouseX = this.mouseX || 640;
        this.mouseY = this.mouseY || 360;
        const steps = 10, durationMs = 80;
        const cx = this.mouseX, cy = this.mouseY;

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const t_eased = t * t * (3 - 2 * t);
            const ix = cx + (x - cx) * t_eased;
            const iy = cy + (y - cy) * t_eased;

            await this.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x: ix, y: iy });
            await new Promise(r => setTimeout(r, Math.floor(durationMs / steps)));
        }
        this.mouseX = x;
        this.mouseY = y;
    }

    /** Types with variable human delay */
    async humanType(text) {
        const CPM = 600, VARIANCE = 0.15;
        const baseDelay = 60000 / CPM;

        for (const char of text) {
            const variance = baseDelay * VARIANCE;
            const delay = baseDelay + (Math.random() * 2 - 1) * variance;
            await this.sendCDP("Input.dispatchKeyEvent", { type: "char", text: char });
            await new Promise(r => setTimeout(r, delay));
        }
    }

    /** Clicks a target using A11y and human movement */
    async clickTarget(target) {
        let coords = null;
        if (target.includes(",")) {
            const parts = target.split(",");
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                coords = { x: parseInt(parts[0]), y: parseInt(parts[1]) };
            }
        }

        if (!coords) coords = await this.resolveWebTarget(target);

        if (coords) {
            await this.humanMouseMove(coords.x, coords.y);
            await this.sendCDP("Input.dispatchMouseEvent", { type: "mousePressed", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
            await new Promise(r => setTimeout(r, 50));
            await this.sendCDP("Input.dispatchMouseEvent", { type: "mouseReleased", x: coords.x, y: coords.y, button: "left", clickCount: 1 });
            return true;
        }

        // Fallback to evaluating JS if it is a CSS selector
        if (target.startsWith("#") || target.startsWith(".") || target.startsWith("[") || target.includes(">")) {
            return await this.sendRequest('click', { selector: target });
        }

        throw new Error(`Target '${target}' not found in A11y tree. Please use take_annotated_screenshot tool to find its exact coordinates (x,y).`);
    }

    /** Types text into an element */
    async typeTarget(target, text) {
        let success = true;
        try {
            success = await this.clickTarget(target);
        } catch (e) {
            throw new Error(`Target '${target}' not found in A11y tree. Cannot type into it. Provide explicit coordinates (x,y) or use an annotated screenshot.`);
        }

        if (success) {
            await this.humanType(text);
            return true;
        }
        return false;
    }
}

// Singleton
module.exports = new BrowserServer();
