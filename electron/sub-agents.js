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
        let browser = task.browser;

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

        // 1. Fetch relevant Zep memory for this task
        let zepContext = "";
        try {
            const memoryResults = await memoryManager.searchMemory("default_user", taskDescription);
            if (memoryResults && memoryResults.facts && memoryResults.facts.length > 0) {
                zepContext = `\nRELEVANT PAST CONTEXT:\n${memoryResults.facts.map(f => `- ${f}`).join('\n')}`;
            }
        } catch (memErr) { console.warn('[SubAgents] Zep context fetch failed:', memErr); }

        // Initial prompt with Desktop State + Zep Context
        const initialState = await desktopService.getFullState({ browser });
        let messageParts = [
            { text: `TASK: ${taskDescription}\n${zepContext}\n\nCURRENT STATE:\n${JSON.stringify(initialState, null, 2)}` }
        ];

        if (isVisual) {
            const screenshot = await browser.captureScreenshot();
            if (screenshot) messageParts.push({ inlineData: { mimeType: "image/jpeg", data: screenshot } });
        }

        while (!isDone && turns < 20) {
            turns++;
            
            // Heartbeat check for extension
            if (!browser.isConnected()) {
                throw new Error("Extension disconnected during task execution. Please reconnect.");
            }

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
                const screenshot = await browser.captureScreenshot();
                if (screenshot) messageParts.push({ inlineData: { mimeType: "image/jpeg", data: screenshot } });
            }
        }

        // AUTOMATIC SYNC TO ZEP
        if (resultSummary) {
            memoryManager.saveToMemory("default_user", `Task Result [${taskDescription}]: ${resultSummary}`).catch(e => console.error('[SubAgents] Zep save failed:', e));
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
