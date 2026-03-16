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

        // Use local browser if connected, otherwise spawn AgentBrowser
        const browserServer = require('./browser-server');
        let browser;
        let useExtension = false;

        if (browserServer.isConnected()) {
            console.log(`[SubAgents][${jobId}] Extension detected. Using local browser context.`);
            browser = browserServer;
            useExtension = true;
        } else {
            browser = new AgentBrowser(jobId, isVisual ? 'Visual Assistant' : 'Deep Researcher');
        }

        this.tasks.set(jobId, { id: jobId, description: taskDescription, status: 'running', history: [], isVisual, browser, useExtension });

        const executeResiliently = async () => {
            const MAX_ATTEMPTS = 3;
            const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
            const deadline = Date.now() + TIMEOUT_MS;

            for (let i = 1; i <= MAX_ATTEMPTS; i++) {
                try {
                    if (Date.now() > deadline) throw new Error('Task timeout');
                    return await this._runAgentLoop(jobId, taskDescription, onUpdate, isVisual);
                } catch (err) {
                    console.warn(`[SubAgents] Attempt ${i} failed:`, err.message);
                    if (i === MAX_ATTEMPTS) throw err;
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
        }).finally(() => {
            const task = this.tasks.get(jobId);
            if (task && !task.useExtension && task.browser && typeof task.browser.close === 'function') {
                task.browser.close();
            }
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
        let browser = task.browser;
        let useExtension = task.useExtension;

        if (!useExtension) {
            await browser.init();
        }

        const soul = this._getSoul();
        const tools = [{ functionDeclarations: skillManager.getDefinitions() }];
        
        // Multi-modal support for visual tasks
        if (isVisual) {
            tools.unshift({ computer_use: { environment: "ENVIRONMENT_BROWSER" } });
        }

        const model = this._getModel("gemini-3-flash-preview", soul, tools);
        const chat = model.startChat();
        
        let turns = 0;
        let isDone = false;
        let resultSummary = "";

        // Initial prompt with Desktop State
        const initialState = await desktopService.getFullState({ browser });
        let messageParts = [
            { text: `TASK: ${taskDescription}\n\nCURRENT STATE:\n${JSON.stringify(initialState, null, 2)}` }
        ];

        if (isVisual) {
            const screenshot = useExtension ? await browser.captureScreenshot() : await browser.screenshot();
            if (screenshot) messageParts.push({ inlineData: { mimeType: "image/jpeg", data: screenshot } });
        }

        while (!isDone && turns < 20) {
            turns++;
            const result = await chat.sendMessage(messageParts);
            const response = result.response;
            const text = response.text();

            if (onUpdate) onUpdate({ jobId, type: 'thought', content: text });
            task.history.push({ role: 'model', text });

            const calls = response.functionCalls();
            if (!calls || calls.length === 0) break;

            const functionResponses = [];
            for (const call of calls) {
                if (onUpdate) onUpdate({ jobId, type: 'tool', name: call.name, args: call.args });
                
                try {
                    const skillRes = await skillManager.execute(call.name, call.args, { browser });
                    if (skillRes.isDone) {
                        isDone = true;
                        resultSummary = skillRes.summary;
                    }
                    functionResponses.push({ functionResponse: { name: call.name, response: skillRes } });
                } catch (err) {
                    functionResponses.push({ functionResponse: { name: call.name, response: { error: err.message } } });
                }
            }

            // 1. Send tool results turn
            const toolResult = await chat.sendMessage(functionResponses);
            const toolAckText = toolResult.response.text();
            if (onUpdate) onUpdate({ jobId, type: 'thought', content: toolAckText });
            task.history.push({ role: 'model', text: toolAckText });

            // 2. Send perception turn (State + Screenshot)
            const nextState = await desktopService.getFullState({ browser });
            messageParts = [
                { text: `STATE UPDATE:\n${JSON.stringify(nextState, null, 2)}` }
            ];
            
            if (isVisual) {
                const screenshot = useExtension ? await browser.captureScreenshot() : await browser.screenshot();
                if (screenshot) messageParts.push({ inlineData: { mimeType: "image/jpeg", data: screenshot } });
            }
            // The loop continues, and messageParts will be sent in the next iteration's chat.sendMessage(messageParts)
        }

        return resultSummary || "Task completed.";
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
