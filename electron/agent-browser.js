// ═══════════════════════════════════════════════════════════════════════
// electron/agent-browser.js — Dedicated Visible Browser for Agents
// Spawns and controls a real Electron BrowserWindow for each agent,
// allowing the user to follow along and avoiding tab-clash.
// ═══════════════════════════════════════════════════════════════════════

const { BrowserWindow, webContents } = require('electron');
const path = require('path');

class AgentBrowser {
    constructor(jobId, agentName = 'Sub-Agent') {
        this.jobId = jobId;
        this.agentName = agentName;
        this.window = null;
        this.attached = false;
        this.isNavigating = false;
    }

    async init() {
        if (this.window) return;

        this.window = new BrowserWindow({
            width: 1200,
            height: 900,
            title: `Friday Assistant: ${this.agentName} (${this.jobId})`,
            show: true,
            autoHideMenuBar: true,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        // Add a badge/overlay style in the future?
        this.window.loadURL('about:blank');

        return new Promise((resolve, reject) => {
            try {
                this.window.webContents.debugger.attach('1.3');
                this.attached = true;
                this.window.webContents.debugger.sendCommand('Page.enable');
                this.window.webContents.debugger.sendCommand('Network.enable');
                this.window.webContents.debugger.sendCommand('Runtime.enable');
                this.window.webContents.debugger.sendCommand('DOM.enable');
                this.window.webContents.debugger.sendCommand('Accessibility.enable');
                resolve();
            } catch (err) {
                console.error(`[AgentBrowser] Failed to attach debugger for ${this.jobId}:`, err);
                reject(err);
            }
        });
    }

    async navigate(url, timeoutMs = 10000) {
        if (!this.window) await this.init();
        
        console.log(`[AgentBrowser][${this.jobId}] Navigating to: ${url}`);
        this.isNavigating = true;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.isNavigating = false;
                resolve({ success: true, note: `Navigation timeout (${timeoutMs}ms), proceeding anyway.` });
            }, timeoutMs);

            this.window.webContents.once('did-finish-load', () => {
                clearTimeout(timeout);
                this.isNavigating = false;
                resolve({ success: true });
            });

            this.window.loadURL(url).catch(err => {
                clearTimeout(timeout);
                this.isNavigating = false;
                reject(err);
            });
        });
    }

    /** Wait for document.readyState === 'complete' */
    async waitForLoad() {
        if (!this.window) return;
        let ready = false;
        let attempts = 0;
        while (!ready && attempts < 10) {
            try {
                const res = await this.evaluate("document.readyState");
                if (res === 'complete') ready = true;
            } catch (e) {}
            if (!ready) {
                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }
        }
    }

    async evaluate(expression) {
        if (!this.window) throw new Error('Browser not initialized');
        return new Promise((resolve, reject) => {
            this.window.webContents.debugger.sendCommand('Runtime.evaluate', {
                expression,
                returnByValue: true
            }, (err, res) => {
                if (err) return reject(new Error(err.message));
                if (res.exceptionDetails) return reject(new Error(res.exceptionDetails.exception.description));
                resolve(res.result.value);
            });
        });
    }

    async getDOM() {
        await this.waitForLoad();
        const script = `
            (() => {
                return {
                    title: document.title,
                    url: window.location.href,
                    text: document.body.innerText.substring(0, 5000)
                };
            })()
        `;
        return await this.evaluate(script);
    }

    async click(selector) {
        await this.waitForLoad();
        // Resolve coordinates via A11y or JS
        const script = `
            (function() {
                const el = document.querySelector("${selector.replace(/"/g, '\\"')}");
                if (!el) return false;
                el.scrollIntoView({ block: 'center' });
                el.click();
                return true;
            })()
        `;
        const success = await this.evaluate(script);
        if (!success) throw new Error(`Element not found: ${selector}`);
        return { success: true };
    }

    async type(selector, text) {
        await this.waitForLoad();
        const safeSelector = selector.replace(/"/g, '\\"');
        const safeText = text.replace(/"/g, '\\"').replace(/\\n/g, '\\\\n');
        
        const script = `
            (function() {
                const el = document.querySelector("${safeSelector}");
                if (!el) return false;
                el.scrollIntoView({ block: 'center' });
                el.focus();
                el.value = "${safeText}";
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            })()
        `;
        const success = await this.evaluate(script);
        if (!success) throw new Error(`Element not found: ${selector}`);
        return { success: true };
    }

    async screenshot() {
        if (!this.window) return null;
        try {
            const image = await this.window.webContents.capturePage();
            return image.toJPEG(70).toString('base64');
        } catch (e) {
            console.error('[AgentBrowser] Capture failed:', e);
            return null;
        }
    }

    close() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.close();
        }
        this.window = null;
        this.attached = false;
    }
}

module.exports = AgentBrowser;
