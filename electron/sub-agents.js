// ═══════════════════════════════════════════════════════════════════════
// electron/sub-agents.js — Async Background Task Manager
// Uses Gemini 1.5 Pro REST API to run headless tasks asynchronously
// without blocking the main live voice session.
// ═══════════════════════════════════════════════════════════════════════

const { GoogleGenerativeAI } = require('@google/generative-ai');
const pipeClient = require('./pipe-client');
const browserServer = require('./browser-server');
const { shell } = require('electron');

class SubAgentManager {
    constructor() {
        this.tasks = new Map();
        this.taskCounter = 0;
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
        if (!process.env.GEMINI_API_KEY) {
            onComplete({ error: 'GEMINI_API_KEY not set' });
            return null;
        }

        this.taskCounter++;
        const jobId = `job-${this.taskCounter}-${Date.now().toString().slice(-6)}`;

        this.tasks.set(jobId, { id: jobId, description: taskDescription, status: 'running', history: [] });

        console.log(`[SubAgents] Starting task [${jobId}]: ${taskDescription}`);

        // Run asynchronously
        this._runAgentLoop(jobId, taskDescription)
            .then(result => {
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

    async _runAgentLoop(jobId, taskDescription) {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        // Define exact same tools as the main agent (without screenshot for now)
        const tools = [{
            functionDeclarations: [
                {
                    name: "desktop_type_string",
                    description: "Type a string into the currently focused application on the desktop.",
                    parameters: { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] }
                },
                {
                    name: "desktop_send_chord",
                    description: "Send a keyboard shortcut. Examples: 'Ctrl+C', 'Alt+Tab', 'Win+E', 'Enter'.",
                    parameters: { type: "OBJECT", properties: { keys: { type: "STRING" } }, required: ["keys"] }
                },
                {
                    name: "desktop_click_at",
                    description: "Click at specific screen coordinates.",
                    parameters: { type: "OBJECT", properties: { x: { type: "NUMBER" }, y: { type: "NUMBER" } }, required: ["x", "y"] }
                },
                {
                    name: "desktop_find_element",
                    description: "Find a UI element by name using Windows UI Automation.",
                    parameters: { type: "OBJECT", properties: { name: { type: "STRING" }, controlType: { type: "STRING" } }, required: ["name"] }
                },
                {
                    name: "desktop_dump_tree",
                    description: "Get a tree of UI elements of the currently focused window.",
                    parameters: { type: "OBJECT", properties: {} }
                },
                {
                    name: "navigate_browser",
                    description: "Navigate the active browser tab to a URL.",
                    parameters: { type: "OBJECT", properties: { url: { type: "STRING" } }, required: ["url"] }
                },
                {
                    name: "read_browser_dom",
                    description: "Read the current browser page title, URL, and DOM text.",
                    parameters: { type: "OBJECT", properties: {} }
                },
                {
                    name: "evaluate_browser_js",
                    description: "Execute JavaScript in the active browser tab.",
                    parameters: { type: "OBJECT", properties: { script: { type: "STRING" } }, required: ["script"] }
                },
                {
                    name: "open_default_browser",
                    description: "Open a URL in the user's default system browser.",
                    parameters: { type: "OBJECT", properties: { url: { type: "STRING" } }, required: ["url"] }
                },
                {
                    name: "finish_task",
                    description: "Call this when the task is successfully completed.",
                    parameters: { type: "OBJECT", properties: { summary: { type: "STRING", description: "Summary of what was done" } }, required: ["summary"] }
                }
            ]
        }];

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: "You are a headless background worker agent. You have native access to the user's desktop and browser. Complete the task assigned to you asynchronously. You MUST call the finish_task tool when you are completely done.",
            tools: tools
        });

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
            // Send empty message to just "continue" and get next output
            const result = await chat.sendMessage("");
            const response = result.response;

            const task = this.tasks.get(jobId);
            const textResponse = response.text();
            if (task && textResponse) {
                task.history.push({ time: new Date().toISOString(), type: 'thought', content: textResponse });
            }

            const functionCalls = response.functionCalls();

            if (!functionCalls || functionCalls.length === 0) {
                // If the model didn't call any functions, it just talked.
                // We'll assume it's done or needs to be prompted again.
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

            // Execute the tool natively
            let toolRes = {};
            try {
                toolRes = await this._executeNativeTool(name, args);
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

    async _executeNativeTool(name, args) {
        // Desktop
        if (name === 'desktop_type_string') {
            return await pipeClient.send('input.typeString', { text: args.text });
        } else if (name === 'desktop_send_chord') {
            return await pipeClient.send('input.sendChord', { keys: args.keys });
        } else if (name === 'desktop_click_at') {
            return await pipeClient.send('input.clickAt', { x: args.x, y: args.y });
        } else if (name === 'desktop_find_element') {
            const params = { name: args.name };
            if (args.controlType) params.controlType = args.controlType;
            return await pipeClient.send('uia.findElement', params);
        } else if (name === 'desktop_dump_tree') {
            return await pipeClient.send('uia.dumpTree', {});
        }
        // Browser
        else if (name === 'navigate_browser') {
            return await browserServer.navigate(args.url);
        } else if (name === 'read_browser_dom') {
            return await browserServer.getDOM();
        } else if (name === 'evaluate_browser_js') {
            return await browserServer.evaluate(args.script);
        } else if (name === 'open_default_browser') {
            await shell.openExternal(args.url);
            return { success: true };
        }

        throw new Error(`Unknown tool: ${name}`);
    }
}

module.exports = new SubAgentManager();
