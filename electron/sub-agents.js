// ═══════════════════════════════════════════════════════════════════════
// electron/sub-agents.js — Friday Async Background Task Manager
// ═══════════════════════════════════════════════════════════════════════

const { GoogleGenerativeAI } = require('@google/generative-ai');
const AgentBrowser = require('./agent-browser');
const skillManager = require('./skill-manager');
const desktopService = require('./desktop-service');
const { getState } = require('./state');
const fs = require('fs');
const path = require('path');

const memoryManager = require('./memory-manager');

class SubAgentManager {
    constructor() {
        this.tasks = new Map();
        this.taskCounter = 0;
        this._initBackends();
        skillManager.loadAll();
    }

    _initBackends() {
        if (process.env.GEMINI_API_KEY) {
            this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            console.log('[SubAgents] AI Studio backend initialized.');
        }
    }

    _getModel(modelName, systemInstruction = '', tools = []) {
        if (this.genAI) {
            return this.genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction,
                tools: tools
            });
        }
        throw new Error('No AI backend configured');
    }

    _getSoul(soulName = 'core') {
        try {
            const soulPath = path.join(process.cwd(), 'souls', `${soulName}.md`);
            return fs.readFileSync(soulPath, 'utf8');
        } catch (e) {
            return 'You are a Friday autonomous agent.';
        }
    }

    startTask(taskDescription, onComplete, onUpdate) {
        return this._startGenericTask(taskDescription, onComplete, onUpdate, false);
    }

    startVisualTask(taskDescription, onComplete, onUpdate) {
        return this._startGenericTask(taskDescription, onComplete, onUpdate, true);
    }

    _startGenericTask(taskDescription, onComplete, onUpdate, isVisual) {
        this.taskCounter++;
        const jobId = `job-${this.taskCounter}`;

        // BUG-017: Evict old tasks to prevent memory leak
        if (this.tasks.size > 50) {
            const oldestId = Array.from(this.tasks.keys()).find(k => this.tasks.get(k).status !== 'running');
            if (oldestId) this.tasks.delete(oldestId);
        }

        // Strictly use the extension bridge as per user request
        const browserServer = require('./browser-server');
        const browser = browserServer;
        const useExtension = true;

        this.tasks.set(jobId, { id: jobId, description: taskDescription, status: 'running', history: [], isVisual, browser, useExtension });

        const executeResiliently = async () => {
            const MAX_ATTEMPTS = 3;
            // Check for extension connection BEFORE starting
            if (!browserServer.isConnected()) {
                if (onUpdate) onUpdate({ jobId, type: 'status', content: "Extension Disconnected: Please go to the Friday Chrome extension and click 'Connect' to proceed." });
                // We don't throw yet, maybe the user connects it while we are in the retry loop
            }

            for (let i = 1; i <= MAX_ATTEMPTS; i++) {
                try {
                    if (!browserServer.isConnected()) {
                        throw new Error("Extension not connected. Please connect the Friday Chrome extension.");
                    }
                    return await this._runAgentLoop(jobId, taskDescription, onUpdate, isVisual);
                } catch (err) {
                    console.warn(`[SubAgents] Attempt ${i} failed:`, err.message);
                    if (onUpdate) onUpdate({ jobId, type: 'status', content: `Attempt ${i} failed: ${err.message}` });
                    if (i === MAX_ATTEMPTS) throw err;
                    // Wait 5s before retrying, giving user time to connect
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        };

        executeResiliently().then(result => {
            const task = this.tasks.get(jobId);
            if (task) { task.status = 'completed'; task.result = result; }
            onComplete({ jobId, result });
        }).catch(err => {
            const task = this.tasks.get(jobId);
            if (task) { task.status = 'failed'; task.error = err.message; }
            onComplete({ jobId, error: err.message });
        });

        return jobId;
    }

    getAllTasks() {
        return Array.from(this.tasks.values()).map(t => ({
            id: t.id,
            description: t.description,
            status: t.status,
            isVisual: t.isVisual
        }));
    }

    async _runAgentLoop(jobId, taskDescription, onUpdate, isVisual) {
        const task = this.tasks.get(jobId);
        const soul = this._getSoul();
        
        const { spawn } = require('child_process');
        const uvPath = 'C:\\Users\\RCCG JESUS EMBASSY\\.cargo\\bin\\uv.exe';
        const scriptPath = path.join(__dirname, '../sidecar/antigravity_agent.py');
        
        console.log(`[SubAgents] Spawning Antigravity SDK sub-agent for job ${jobId}...`);
        
        return new Promise((resolve, reject) => {
            const pyProcess = spawn(uvPath, ['run', 'python', scriptPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, PYTHONPATH: process.cwd() }
            });
            
            let finalResult = '';
            
            const readline = require('readline');
            const rl = readline.createInterface({
                input: pyProcess.stdout,
                terminal: false
            });
            
            rl.on('line', (line) => {
                try {
                    const msg = JSON.parse(line.trim());
                    if (msg.event === 'agent_thought') {
                        if (onUpdate) onUpdate({ jobId, type: 'thought', content: msg.data.reasoning });
                        task.history.push({ role: 'model', text: msg.data.reasoning });
                    } else if (msg.event === 'agent_step') {
                        if (onUpdate) onUpdate({ jobId, type: 'status', content: msg.data.action });
                    } else if (msg.event === 'agent_status') {
                        if (onUpdate) onUpdate({ jobId, type: 'status', content: msg.data.message });
                    } else if (msg.status === 'done') {
                        finalResult = msg.result;
                    } else if (msg.status === 'error') {
                        reject(new Error(msg.error));
                    }
                } catch (e) {
                    // Ignore non-JSON output
                }
            });
            
            pyProcess.stderr.on('data', (data) => {
                console.error(`[Antigravity SDK Error]`, data.toString());
            });
            
            pyProcess.on('exit', (code) => {
                if (code === 0) {
                    resolve(finalResult || 'Task completed successfully by Antigravity SDK.');
                } else {
                    reject(new Error(`Antigravity SDK agent exited with code ${code}`));
                }
            });
            
            // Send the task configuration as JSON input
            pyProcess.stdin.write(JSON.stringify({
                task: taskDescription,
                system_instructions: soul
            }) + '\n');
        });
    }
    getActiveTaskBrowsers() {
        const results = [];
        for (const [id, task] of this.tasks.entries()) {
            if (task.status === 'running' && task.browser) {
                results.push({
                    jobId: id,
                    agentName: task.browser.agentName || 'Sub-Agent',
                    title: task.browser.window ? task.browser.window.getTitle() : 'Initializing...'
                });
            }
        }
        return results;
    }
}

module.exports = new SubAgentManager();
