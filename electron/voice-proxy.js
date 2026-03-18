const WebSocket = require('ws');
const { ipcMain } = require('electron');

class VoiceProxy {
    constructor() {
        this.ws = null;
    }

    init(mainWindow) {
        ipcMain.handle('voice:connect', async (event, { host, apiVersion, model }) => {
            // Security: Check if main app state is authenticated
            const { getState } = require('./state');
            if (!getState().currentUser) {
                throw new Error('Unauthorized: Please sign in to use voice features.');
            }

            const key = process.env.GEMINI_API_KEY;
            if (!key) throw new Error('GEMINI_API_KEY is missing');

            const url = `wss://${host}/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContent?key=${key}`;
            
            if (this.ws) {
                try { this.ws.close(); } catch(e) {}
            }

            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('voice:onOpen');
                }
            });

            this.ws.on('message', (data) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('voice:onMessage', data.toString());
                }
            });

            this.ws.on('close', (code, reason) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('voice:onClose', { code, reason: reason.toString() });
                }
            });

            this.ws.on('error', (err) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('voice:onError', err.message);
                }
            });

            return true;
        });

        ipcMain.handle('voice:send', (event, data) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(data);
                return true;
            }
            return false;
        });

        ipcMain.handle('voice:close', () => {
            if (this.ws) {
                try { this.ws.close(); } catch(e) {}
                this.ws = null;
            }
            return true;
        });
    }
}

module.exports = new VoiceProxy();
