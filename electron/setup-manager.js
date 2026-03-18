const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

class SetupManager {
    constructor() {
        this.setupWindow = null;
        const StoreClass = Store.default || Store;
        this.store = new StoreClass({
            name: 'friday-config',
            encryptionKey: 'friday-safe-storage' // In a real app, this would be more unique or generated
        });
    }

    hasKeys() {
        return !!this.store.get('api_keys.gemini');
    }

    getKeys() {
        return this.store.get('api_keys');
    }

    async showSetupDialog() {
        if (this.setupWindow) {
            this.setupWindow.focus();
            return;
        }

        return new Promise((resolve) => {
            this.setupWindow = new BrowserWindow({
                width: 500,
                height: 600,
                frame: false,
                transparent: true,
                resizable: false,
                alwaysOnTop: true,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false // Simplified for setup window
                }
            });

            this.setupWindow.loadFile(path.join(__dirname, '../renderer/setup.html'));

            ipcMain.once('setup:submit', (event, keys) => {
                this.store.set('api_keys', keys);
                if (this.setupWindow) {
                    this.setupWindow.close();
                    this.setupWindow = null;
                }
                resolve(keys);
            });

            this.setupWindow.on('closed', () => {
                this.setupWindow = null;
            });
        });
    }
}

module.exports = new SetupManager();
