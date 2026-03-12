// ═══════════════════════════════════════════════════════════════════════
// electron/cloud-connector.js — Bridge to Remote Agent Hub
// Connects to a central hub to allow remote agents to execute local tools.
// ═══════════════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const toolExecutor = require('./tool-executor');

class CloudConnector {
    constructor() {
        this.ws = null;
        this.reconnectTimer = null;
        this.hubUrl = process.env.GCP_REMOTE_HUB_URL;
    }

    start() {
        if (!this.hubUrl) {
            console.log('[CloudConnector] No GCP_REMOTE_HUB_URL defined. Skipping.');
            return;
        }
        this.connect();
    }

    connect() {
        console.log(`[CloudConnector] Connecting to remote hub: ${this.hubUrl}`);
        this.ws = new WebSocket(this.hubUrl);

        this.ws.on('open', () => {
            console.log('[CloudConnector] Connected to Cloud Agent Hub!');
            this.ws.send(JSON.stringify({ type: 'register', role: 'local-node', name: 'Friday-Windows' }));
        });

        this.ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data);
                if (message.type === 'tool_request') {
                    console.log(`[CloudConnector] Received remote tool request: ${message.name}`);
                    const result = await this.handleToolRequest(message.name, message.args);
                    this.ws.send(JSON.stringify({
                        type: 'tool_response',
                        requestId: message.requestId,
                        result
                    }));
                }
            } catch (err) {
                console.error('[CloudConnector] Failed to process hub message:', err);
            }
        });

        this.ws.on('close', () => {
            console.log('[CloudConnector] Connection lost. Reconnecting in 5s...');
            this.reconnectTimer = setTimeout(() => this.connect(), 5000);
        });

        this.ws.on('error', (err) => {
            console.error('[CloudConnector] WebSocket error:', err.message);
        });
    }

    async handleToolRequest(name, args) {
        try {
            // Check if it's a computer use action or a native tool
            if (name.startsWith('CU_')) {
                return await toolExecutor.executeComputerUseAction(name.replace('CU_', ''), args);
            }
            return await toolExecutor.executeNativeTool(name, args);
        } catch (err) {
            return { error: err.message };
        }
    }
}

module.exports = new CloudConnector();
