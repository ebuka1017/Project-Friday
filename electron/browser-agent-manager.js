const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class BrowserAgentManager {
    constructor() {
        this.process = null;
        this.chromeProcess = null;
        this.onUpdate = null; // Callback for real-time updates
    }

    setUpdateCallback(cb) {
        this.onUpdate = cb;
    }

    async isChromeRunning() {
        return new Promise((resolve) => {
            const http = require('http');
            const req = http.get('http://127.0.0.1:9222/json/version', (res) => {
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
            console.log('[BrowserAgentManager] Chrome is already running on port 9222.');
            return;
        }
        
        // Complying with user request: STOP THE AGENT FROM OPENING AN ELECTRON CHROMIUM BROWSER
        throw new Error("Browser not found on port 9222. Please ensure Chrome is running correctly or use the Friday Chrome Extension to bridge your active tab.");
    }

    start() {
        if (this.process) return;

        const pyPath = 'python';
        const scriptPath = path.join(__dirname, '../sidecar/browser_agent.py');
        
        console.log('[BrowserAgentManager] Spawning Python sidecar...');
        this.process = spawn(pyPath, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONPATH: process.cwd() }
        });

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
            const handler = (data) => {
                const lines = data.toString().trim().split('\n');
                for (const line of lines) {
                    try {
                        const msg = JSON.parse(line);
                        if (msg.status === 'done' || msg.status === 'error') {
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
            setTimeout(() => {
                this.process.stdout.off('data', handler);
                reject(new Error('Browser agent task timeout (5 mins)'));
            }, 5 * 60 * 1000);
        });
    }
}

module.exports = new BrowserAgentManager();
