// ═══════════════════════════════════════════════════════════════════════
// electron/browser-server.js — Extension WebSocket Bridge
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
}

// Singleton
module.exports = new BrowserServer();
