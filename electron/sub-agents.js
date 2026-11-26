// ═══════════════════════════════════════════════════════════════════════
// electron/sub-agents.js — Friday Async Background Task Manager
// ═══════════════════════════════════════════════════════════════════════

const { GoogleGenerativeAI } = require('@google/generative-ai');
const skillManager = require('./skill-manager');
const desktopService = require('./desktop-service');
const { spawnPythonScript } = require('./python-runner');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const memoryManager = require('./memory-manager');
const CONSTANTS = require('../shared/constants');

class SubAgentManager {
    constructor() {
        this.tasks = new Map();
        this.taskCounter = 0;
        this._initBackends();
        skillManager.loadAll();
    }

    _initBackends() {
        if (process.env.GEMINI_API_KEY && !this.genAI) {
            this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            console.log('[SubAgents] AI Studio backend initialized.');
        }
    }

    _getModel(modelName, systemInstruction = '', tools = []) {
        this._initBackends();
        if (this.genAI) {
            return this.genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction,
                tools: tools,
            });
        }
        throw new Error('No AI backend configured (missing GEMINI_API_KEY)');
    }

    _getSoul(soulName = 'core') {
        try {
            const soulPath = path.join(process.cwd(), 'souls', `${soulName}.md`);
            return fs.readFileSync(soulPath, 'utf8');
        } catch (e) {
            return 'You are a Friday autonomous agent.';
        }
    }

    _recordHistory(task, entry) {
        task.history.push({
            time: new Date().toISOString(),
            ...entry,
        });
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

        // BUG-017: Evict old completed tasks to prevent unbounded memory growth
        if (this.tasks.size > 50) {
            const oldestId = Array.from(this.tasks.keys()).find(k => this.tasks.get(k).status !== 'running');
            if (oldestId) this.tasks.delete(oldestId);
        }

        const browserServer = require('./browser-server');
        const task = {
            id: jobId,
            description: taskDescription,
            status: 'running',
            history: [],
            isVisual,
            browser: browserServer,
            useExtension: true,
            result: null,
            error: null,
        };
        this.tasks.set(jobId, task);

        const executeTask = async () => {
            if (isVisual && !browserServer.isConnected()) {
                const msg = "Extension Disconnected: Please connect the Friday Chrome extension for visual browser tasks.";
                if (onUpdate) onUpdate({ jobId, type: 'status', content: msg });
                throw new Error(msg);
            }

            return await this._runAgentLoop(jobId, taskDescription, onUpdate, isVisual);
        };

        executeTask()
            .then(result => {
                task.status = 'completed';
                task.result = result;
                if (onComplete) onComplete({ jobId, result });
            })
            .catch(err => {
                task.status = 'failed';
                task.error = err.message;
                if (onComplete) onComplete({ jobId, error: err.message });
            });

        return jobId;
    }

    getAllTasks() {
        return Array.from(this.tasks.values()).map(t => ({
            id: t.id,
            description: t.description,
            status: t.status,
            isVisual: t.isVisual,
            result: t.result,
            error: t.error,
            history: t.history,
        }));
    }

    async _runAgentLoop(jobId, taskDescription, onUpdate, isVisual) {
        const task = this.tasks.get(jobId);
        const soul = this._getSoul();

        try {
            return await this._runAntigravitySidecar(task, jobId, taskDescription, soul, onUpdate);
        } catch (sidecarErr) {
            console.warn(`[SubAgents] Antigravity sidecar unavailable (${sidecarErr.message}), falling back to Gemini ReACT loop...`);
            if (onUpdate) {
                onUpdate({ jobId, type: 'status', content: 'Running native Gemini sub-agent loop...' });
            }
            return await this._runGeminiReactLoop(task, jobId, taskDescription, soul, onUpdate, isVisual);
        }
    }

    _runAntigravitySidecar(task, jobId, taskDescription, soul, onUpdate) {
        const scriptPath = path.join(__dirname, '../sidecar/antigravity_agent.py');
        console.log(`[SubAgents] Spawning Antigravity SDK sub-agent for job ${jobId}...`);

        return new Promise((resolve, reject) => {
            const pyProcess = spawnPythonScript(scriptPath);
            let finalResult = '';
            let stderrBuffer = '';
            let settled = false;

            const finishError = (err) => {
                if (settled) return;
                settled = true;
                reject(err);
            };

            const rl = readline.createInterface({
                input: pyProcess.stdout,
                terminal: false,
            });

            rl.on('line', (line) => {
                try {
                    const msg = JSON.parse(line.trim());
                    if (msg.event === 'agent_thought') {
                        if (onUpdate) onUpdate({ jobId, type: 'thought', content: msg.data.reasoning });
                        this._recordHistory(task, { type: 'thought', content: msg.data.reasoning });
                    } else if (msg.event === 'agent_step') {
                        if (onUpdate) onUpdate({ jobId, type: 'status', content: msg.data.action });
                        this._recordHistory(task, { type: 'status', content: msg.data.action });
                    } else if (msg.event === 'agent_status') {
                        if (onUpdate) onUpdate({ jobId, type: 'status', content: msg.data.message });
                    } else if (msg.status === 'done') {
                        finalResult = msg.result;
                    } else if (msg.status === 'error') {
                        finishError(new Error(msg.error));
                    }
                } catch {
                    // Ignore non-JSON output
                }
            });

            pyProcess.stderr.on('data', (data) => {
                const text = data.toString();
                stderrBuffer += text;
                console.error('[Antigravity SDK Error]', text);
            });

            pyProcess.on('error', (err) => finishError(err));

            pyProcess.on('exit', (code) => {
                if (settled) return;
                settled = true;
                if (code === 0) {
                    resolve(finalResult || 'Task completed successfully by Antigravity SDK.');
                } else {
                    const detail = stderrBuffer.trim().split('\n').pop() || `exit code ${code}`;
                    reject(new Error(`Antigravity SDK agent failed (${detail})`));
                }
            });

            pyProcess.stdin.write(JSON.stringify({
                task: taskDescription,
                system_instructions: soul,
            }) + '\n');
            pyProcess.stdin.end();
        });
    }

    async _runGeminiReactLoop(task, jobId, taskDescription, soul, onUpdate, isVisual) {
        const browser = task.browser;
        const tools = [{ functionDeclarations: skillManager.getDefinitions() }];
        const modelName = process.env.GEMINI_AGENT_MODEL || CONSTANTS.DEFAULT_GEMINI_AGENT_MODEL;
        const model = this._getModel(modelName, soul, tools);
        const chat = model.startChat();

        let turns = 0;
        let isDone = false;
        let resultSummary = '';

        const initialState = await desktopService.getFullState({
            useVision: isVisual,
            browser: browser && browser.isConnected() ? browser : null,
        });

        let messageParts = [
            { text: `TASK: ${taskDescription}\n\nCURRENT DESKTOP STATE:\n${JSON.stringify(initialState, null, 2)}` },
        ];

        if (isVisual && browser && browser.isConnected()) {
            const screenshot = await browser.captureScreenshot();
            if (screenshot) {
                messageParts.push({ inlineData: { mimeType: 'image/jpeg', data: screenshot } });
            }
        }

        while (!isDone && turns < 20) {
            turns++;
            const result = await chat.sendMessage(messageParts);
            const response = result.response;
            const text = response.text();

            if (text) {
                if (onUpdate) onUpdate({ jobId, type: 'thought', content: text });
                this._recordHistory(task, { type: 'thought', content: text });
                memoryManager.addMessage(jobId, 'ai', text).catch(() => {});
            }

            const calls = response.functionCalls();
            if (!calls || calls.length === 0) {
                resultSummary = text || resultSummary;
                break;
            }

            const functionResponses = [];
            for (const call of calls) {
                if (onUpdate) onUpdate({ jobId, type: 'tool', name: call.name, args: call.args });
                this._recordHistory(task, { type: 'tool', name: call.name, args: call.args });

                try {
                    const skillRes = await skillManager.execute(call.name, call.args, { browser });
                    if (skillRes && skillRes.isDone) {
                        isDone = true;
                        resultSummary = skillRes.summary;
                    }
                    functionResponses.push({ functionResponse: { name: call.name, response: skillRes } });
                } catch (err) {
                    functionResponses.push({ functionResponse: { name: call.name, response: { error: err.message } } });
                }
            }

            const toolResult = await chat.sendMessage(functionResponses);
            const toolAckText = toolResult.response.text();
            if (toolAckText) {
                if (onUpdate) onUpdate({ jobId, type: 'thought', content: toolAckText });
                this._recordHistory(task, { type: 'thought', content: toolAckText });
            }

            if (isDone) break;

            const nextState = await desktopService.getFullState({
                useVision: isVisual,
                browser: browser && browser.isConnected() ? browser : null,
            });
            messageParts = [{ text: `STATE UPDATE:\n${JSON.stringify(nextState, null, 2)}` }];
            if (isVisual && browser && browser.isConnected()) {
                const screenshot = await browser.captureScreenshot();
                if (screenshot) {
                    messageParts.push({ inlineData: { mimeType: 'image/jpeg', data: screenshot } });
                }
            }
        }

        if (resultSummary) {
            memoryManager
                .saveToMemory('default_user', `Task Result [${taskDescription}]: ${resultSummary}`, jobId)
                .catch(e => console.error('[SubAgents] Zep final save failed:', e));
        }

        return resultSummary || 'Task completed.';
    }

    getActiveTaskBrowsers() {
        const results = [];
        for (const [id, task] of this.tasks.entries()) {
            if (task.status === 'running' && task.browser) {
                const title = task.browser.window?.getTitle?.()
                    || (task.browser.isConnected?.() ? 'Chrome Extension Bridge' : 'Initializing...');
                results.push({
                    jobId: id,
                    agentName: task.browser.agentName || 'Sub-Agent',
                    title,
                });
            }
        }
        return results;
    }
}

module.exports = new SubAgentManager();
