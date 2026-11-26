const WebSocket = require('ws');
const { ipcMain } = require('electron');
const authService = require('./auth-service');
const { getState } = require('./state');

class VoiceProxy {
    constructor() {
        this.ws = null;
        this.getWindow = null;
        this._handlersRegistered = false;
    }

    setMainWindow(winOrGetter) {
        this.getWindow = typeof winOrGetter === 'function' ? winOrGetter : () => winOrGetter;
    }

    _sendToRenderer(channel, payload) {
        const win = this.getWindow ? this.getWindow() : null;
        if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send(channel, payload);
        }
    }

    init(mainWindowOrGetter) {
        this.setMainWindow(mainWindowOrGetter);
        if (this._handlersRegistered) return;
        this._handlersRegistered = true;

        ipcMain.handle('voice:connect', async (event, { host, apiVersion, model } = {}) => {
            const isAuth = authService.getStatus().isAuthenticated || Boolean(getState().currentUser);
            if (!isAuth) {
                throw new Error('Unauthorized: Please sign in to use voice features.');
            }

            const key = process.env.GEMINI_API_KEY;
            if (!key) throw new Error('GEMINI_API_KEY is missing');

            const targetHost = host || 'generativelanguage.googleapis.com';
            const version = apiVersion || 'v1alpha';
            const url = `wss://${targetHost}/ws/google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent?key=${key}`;

            if (this.ws) {
                try { this.ws.close(1000, 'Reconnecting'); } catch (e) {}
            }

            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                this._sendToRenderer('voice:onOpen');
            });

            this.ws.on('message', (data) => {
                this._sendToRenderer('voice:onMessage', data.toString());
            });

            this.ws.on('close', (code, reason) => {
                this._sendToRenderer('voice:onClose', {
                    code,
                    reason: reason ? reason.toString() : '',
                });
            });

            this.ws.on('error', (err) => {
                this._sendToRenderer('voice:onError', err.message);
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
                try { this.ws.close(1000, 'Client closed'); } catch (e) {}
                this.ws = null;
            }
            return true;
        });
    }
}

module.exports = new VoiceProxy();
