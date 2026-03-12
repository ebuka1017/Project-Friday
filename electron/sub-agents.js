// ═══════════════════════════════════════════════════════════════════════
// electron/sub-agents.js — Friday Async Background Task Manager
// Uses Gemini 1.5 Pro REST API to run headless tasks asynchronously
// without blocking the main live voice session.
// ═══════════════════════════════════════════════════════════════════════

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { VertexAI } = require('@google-cloud/vertexai');
const browserServer = require('./browser-server');
const toolsRegistry = require('../shared/tools-registry');
const toolExecutor = require('./tool-executor');

class SubAgentManager {
    constructor() {
        this.tasks = new Map();
        this.taskCounter = 0;
        this._initBackends();
    }

    _initBackends() {
        // AI Studio (Standard)
        if (process.env.GEMINI_API_KEY) {
            this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            console.log('[SubAgents] AI Studio backend initialized.');
        }

        // GCP Vertex AI
        if (process.env.GCP_PROJECT_ID && process.env.GCP_LOCATION) {
            this.vertexAI = new VertexAI({
                project: process.env.GCP_PROJECT_ID,
                location: process.env.GCP_LOCATION
            });
            console.log(`[SubAgents] Vertex AI backend initialized (Project: ${process.env.GCP_PROJECT_ID}).`);
        }
    }

    _getModel(modelName, systemInstruction = '', tools = []) {
        // Prefer Vertex AI if configured
        if (this.vertexAI) {
            return this.vertexAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction,
                tools: tools
            });
        }

        // Fallback to AI Studio
        if (this.genAI) {
            return this.genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction,
                tools: tools
            });
        }

        throw new Error('No AI backend (GEMINI_API_KEY or GCP_PROJECT_ID) configured');
    }

    getAllTasks() {
        return Array.from(this.tasks.values());
    }

    /**
     * Start an async background task.
     * @param {string} taskDescription What the sub-agent should do.
     * @param {function} onComplete Callback when the task finishes.
     * @returns {string} jobId
     */
    startTask(taskDescription, onComplete) {
        return this._startGenericTask(taskDescription, onComplete, false);
    }

    /**
     * Start a visual browsing task (Computer Use).
     */
    startVisualTask(taskDescription, onComplete) {
        return this._startGenericTask(taskDescription, onComplete, true);
    }

    _startGenericTask(taskDescription, onComplete, isVisual) {
        try {
            // Standardizing on Gemini 2.0 Flash for speed and reliability in background tasks.
            // Complex visual tasks can use 1.5 Pro if needed, but 2.0 Flash Exp is the current target.
            this._getModel(isVisual ? "gemini-2.0-flash-exp" : "gemini-2.0-flash-exp");
        } catch (e) {
            onComplete({ error: e.message });
            return null;
        }

        this.taskCounter++;
        const jobId = `job-${this.taskCounter}-${Date.now().toString().slice(-6)}`;

        this.tasks.set(jobId, { id: jobId, description: taskDescription, status: 'running', history: [], isVisual });

        console.log(`[SubAgents] Starting ${isVisual ? 'VISUAL' : 'text'} task [${jobId}]: ${taskDescription}`);

        const loop = isVisual ? this._runVisualAgentLoop(jobId, taskDescription) : this._runAgentLoop(jobId, taskDescription);

        loop.then(result => {
            console.log(`[SubAgents] Task [${jobId}] completed.`);
            const task = this.tasks.get(jobId);
            if (task) {
                task.status = 'completed';
                task.result = result;
                task.history.push({ time: new Date().toISOString(), type: 'system', content: `Task completed. Result: ${result}` });
            }
            onComplete({ jobId, result });
        })
            .catch(err => {
                console.error(`[SubAgents] Task [${jobId}] failed:`, err);
                const task = this.tasks.get(jobId);
                if (task) {
                    task.status = 'failed';
                    task.error = err.message;
                    task.history.push({ time: new Date().toISOString(), type: 'error', content: `Task failed: ${err.message}` });
                }
                onComplete({ jobId, error: err.message });
            });

        return jobId;
    }

    async _runVisualAgentLoop(jobId, taskDescription) {
        const model = this._getModel("gemini-2.5-computer-use-preview-10-2025", '', [{
            computer_use: {
                environment: "ENVIRONMENT_BROWSER"
            }
        }, {
            functionDeclarations: [
                {
                    name: "finish_task",
                    description: "Call this when the task is successfully completed.",
                    parameters: {
                        type: "object",
                        properties: {
                            summary: { type: "string", description: "Summary of what was done" }
                        },
                        required: ["summary"]
                    }
                }
            ]
        }]);

        const chat = model.startChat();
        const MAX_TURNS = 15;
        let turns = 0;
        let isDone = false;
        let finalSummary = "Task finished without explicit summary.";

        // Initial state
        let screenshotB64 = await browserServer.captureScreenshot();
        let message = {
            role: "user",
            parts: [
                { text: `Task: ${taskDescription}` },
                {
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: screenshotB64
                    }
                }
            ]
        };

        while (!isDone && turns < MAX_TURNS) {
            turns++;
            const result = await chat.sendMessage(message.parts);
            const response = result.response;

            const task = this.tasks.get(jobId);
            const textResponse = response.text();
            if (task && textResponse) {
                task.history.push({ time: new Date().toISOString(), type: 'thought', content: textResponse });
            }

            const functionCalls = response.functionCalls();
            if (!functionCalls || functionCalls.length === 0) {
                if (textResponse) finalSummary = textResponse;
                break;
            }

            const functionResponses = [];
            for (const call of functionCalls) {
                const name = call.name;
                const args = call.args;

                if (task) {
                    task.history.push({ time: new Date().toISOString(), type: 'tool', name: name, args: args });
                }

                console.log(`[SubAgents] Visual Job ${jobId} called ${name}`, args);

                if (name === 'finish_task') {
                    isDone = true;
                    finalSummary = args.summary;
                    functionResponses.push({
                        functionResponse: {
                            name: name,
                            response: { success: true }
                        }
                    });
                    continue;
                }

                // Execute Computer Use action via ToolExecutor
                let toolRes = {};
                try {
                    toolRes = await toolExecutor.executeComputerUseAction(name, args);
                } catch (err) {
                    toolRes = { error: err.message };
                }

                functionResponses.push({
                    functionResponse: {
                        name: name,
                        response: toolRes
                    }
                });
            }

            if (isDone) break;

            // Capture NEW state for the next turn
            screenshotB64 = await browserServer.captureScreenshot();
            message = {
                role: "user",
                parts: [
                    ...functionResponses,
                    {
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: screenshotB64
                        }
                    }
                ]
            };
        }

        return finalSummary;
    }

    async _runAgentLoop(jobId, taskDescription) {
        // Load tools from shared registry
        const tools = [{
            functionDeclarations: toolsRegistry.getSubAgentTools()
        }];

        const systemInstruction = "You are a headless background worker agent. You have native access to the user's desktop and browser. Complete the task assigned to you asynchronously. You MUST call the finish_task tool when you are completely done. Be efficient and use tools directly whenever possible.\n\nSEARCH STRATEGY:\n- If the task explicitly requires showing the user a search result, use `navigate_browser` or `open_default_browser`.\n- For all other research needed to complete your task, use `web_search` to keep the user's workspace clean.";

        const model = this._getModel("gemini-3.1-flash-lite-preview", systemInstruction, tools);

        const chat = model.startChat({
            history: [
                { role: "user", parts: [{ text: `Task: ${taskDescription}` }] }
            ]
        });

        const MAX_TURNS = 15;
        let turns = 0;
        let isDone = false;
        let finalSummary = "Task finished without explicit summary.";

        while (!isDone && turns < MAX_TURNS) {
            turns++;
            const result = await chat.sendMessage("Continue executing the plan.");
            const response = result.response;

            const task = this.tasks.get(jobId);
            const textResponse = response.text();
            if (task && textResponse) {
                task.history.push({ time: new Date().toISOString(), type: 'thought', content: textResponse });
            }

            const functionCalls = response.functionCalls();

            if (!functionCalls || functionCalls.length === 0) {
                if (textResponse) {
                    finalSummary = textResponse;
                }
                break;
            }

            // Handle the first function call
            const call = functionCalls[0];
            const name = call.name;
            const args = call.args;

            if (task) {
                task.history.push({ time: new Date().toISOString(), type: 'tool', name: name, args: args });
            }

            console.log(`[SubAgents] Job ${jobId} called ${name}`, args);

            if (name === 'finish_task') {
                isDone = true;
                finalSummary = args.summary;
                break;
            }

            // Execute the tool natively via ToolExecutor
            let toolRes = {};
            try {
                toolRes = await Promise.race([
                    toolExecutor.executeNativeTool(name, args),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Tool execution timed out (30s)')), 30000))
                ]);
            } catch (err) {
                toolRes = { error: err.message };
            }

            // Send tool result back to model
            await chat.sendMessage([{
                functionResponse: {
                    name: name,
                    response: toolRes
                }
            }]);
        }

        if (turns >= MAX_TURNS) {
            return `Task timed out after ${MAX_TURNS} steps. Partial results: ${finalSummary}`;
        }

        return finalSummary;
    }
}

module.exports = new SubAgentManager();
