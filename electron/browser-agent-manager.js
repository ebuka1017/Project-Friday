const path = require('path');
const { spawnPythonScript } = require('./python-runner');
const CONSTANTS = require('../shared/constants');

class BrowserAgentManager {
    constructor() {
        this.process = null;
        this.chromeProcess = null;
        this.onUpdate = null; // Callback for real-time updates
        this.debugPort = Number(process.env.CHROME_DEBUG_PORT) || CONSTANTS.CHROME_DEBUG_PORT;
    }

    setUpdateCallback(cb) {
        this.onUpdate = cb;
    }

    async isChromeRunning() {
        return new Promise((resolve) => {
            const http = require('http');
            const req = http.get(`http://127.0.0.1:${this.debugPort}/json/version`, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.setTimeout(500, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    async launchChromeWithDebugging(force = false) {
        const running = await this.isChromeRunning();
        if (running) {
            console.log(`[BrowserAgentManager] Chrome is already running on port ${this.debugPort}.`);
            return;
        }
        
        // Complying with user request: STOP THE AGENT FROM OPENING AN ELECTRON CHROMIUM BROWSER
        throw new Error(`Browser not found on port ${this.debugPort}. Please ensure Chrome is running correctly or use the Friday Chrome Extension to bridge your active tab.`);
    }

    start() {
        if (this.process) return;

        const scriptPath = path.join(__dirname, '../sidecar/browser_agent.py');

        console.log('[BrowserAgentManager] Spawning Python sidecar...');
        this.process = spawnPythonScript(scriptPath);

        this.process.stdout.on('data', (data) => {
            const raw = data.toString().trim();
            const lines = raw.split('\n');
            lines.forEach(line => {
                try {
                    const msg = JSON.parse(line);
                    if (this.onUpdate) this.onUpdate(msg);
                } catch (e) {}
            });
        });

        this.process.stderr.on('data', (d) => {
            console.error('[BrowserAgentManager Error]', d.toString());
        });

        this.process.on('exit', () => {
            console.log('[BrowserAgentManager] Process exited.');
            this.process = null;
        });
    }

    async runTask(task) {
        // Ensure Chrome is up first
        await this.launchChromeWithDebugging(true);
        
        if (!this.process) this.start();

        return new Promise((resolve, reject) => {
            let timeoutId = null;
            const handler = (data) => {
                const lines = data.toString().trim().split('\n');
                for (const line of lines) {
                    try {
                        const msg = JSON.parse(line);
                        if (msg.status === 'done' || msg.status === 'error') {
                            clearTimeout(timeoutId);
                            this.process.stdout.off('data', handler);
                            resolve(msg);
                            return;
                        }
                    } catch (e) {}
                }
            };

            this.process.stdout.on('data', handler);
            this.process.stdin.write(JSON.stringify({ task }) + '\n');
            
            // Safety timeout
            timeoutId = setTimeout(() => {
                this.process.stdout.off('data', handler);
                reject(new Error('Browser agent task timeout (5 mins)'));
            }, 5 * 60 * 1000);
        });
    }
}

module.exports = new BrowserAgentManager();
