// ═══════════════════════════════════════════════════════════════════════
// electron/sub-agents.js — Friday Async Background Task Manager
// Uses Gemini 1.5 Pro REST API to run headless tasks asynchronously
// without blocking the main live voice session.
// ═══════════════════════════════════════════════════════════════════════

const { GoogleGenerativeAI } = require('@google/generative-ai');
const browserServer = require('./browser-server');
const toolsRegistry = require('../shared/tools-registry');
const toolExecutor = require('./tool-executor');
const { getState } = require('./state');

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
    }

    _getModel(modelName, systemInstruction = '', tools = []) {
        // Fallback to AI Studio
        if (this.genAI) {
            return this.genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction,
                tools: tools
            });
        }

        throw new Error('No AI backend (GEMINI_API_KEY) configured');
    }


    getAllTasks() {
        return Array.from(this.tasks.values());
    }

    /**
     * Start an async background task.
     * @param {string} taskDescription What the sub-agent should do.
     * @param {function} onComplete Callback when the task finishes.
     * @param {function} onUpdate Callback for real-time updates (thoughts, tools, images).
     * @returns {string} jobId
     */
    startTask(taskDescription, onComplete, onUpdate) {
        return this._startGenericTask(taskDescription, onComplete, onUpdate, false);
    }

    /**
     * Start a visual browsing task (Computer Use).
     */
    startVisualTask(taskDescription, onComplete, onUpdate) {
        return this._startGenericTask(taskDescription, onComplete, onUpdate, true);
    }

    _startGenericTask(taskDescription, onComplete, onUpdate, isVisual) {
        // No longer pre-checking model here as it's created in the loop


        this.taskCounter++;
        const jobId = `job-${this.taskCounter}-${Date.now().toString().slice(-6)}`;

        this.tasks.set(jobId, { id: jobId, description: taskDescription, status: 'running', history: [], isVisual });

        console.log(`[SubAgents] Starting ${isVisual ? 'VISUAL' : 'text'} task [${jobId}]: ${taskDescription}`);

        const loop = isVisual 
            ? this._runVisualAgentLoop(jobId, taskDescription, onUpdate) 
            : this._runAgentLoop(jobId, taskDescription, onUpdate);

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

    async _runVisualAgentLoop(jobId, taskDescription, onUpdate) {
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
                const thought = { time: new Date().toISOString(), type: 'thought', content: textResponse };
                task.history.push(thought);
                if (onUpdate) onUpdate({ jobId, ...thought });
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
                    const toolCall = { time: new Date().toISOString(), type: 'tool', name: name, args: args };
                    task.history.push(toolCall);
                    if (onUpdate) onUpdate({ jobId, ...toolCall });
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
                    toolRes = await Promise.race([
                        toolExecutor.executeComputerUseAction(name, args),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Computer use action timed out (45s)')), 45000))
                    ]);
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
            if (onUpdate && screenshotB64) {
                onUpdate({ jobId, type: 'screenshot', data: screenshotB64 });
            }
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

    async _runAgentLoop(jobId, taskDescription, onUpdate) {
        // Load tools from shared registry
        const toolList = toolsRegistry.getSubAgentTools();
        // Deduplicate tools by name to prevent "Duplicate function declaration" errors
        const uniqueTools = Array.from(new Map(toolList.map(t => [t.name, t])).values());
        const tools = [{
            functionDeclarations: uniqueTools
        }];

        const systemInstruction = `# ════════════════════════════════════════════════════════
# FRIDAY SUB-AGENT — System Prompt v1.0
# ════════════════════════════════════════════════════════

## IDENTITY
You are a headless Friday Sub-Agent, specialized in background automation and research.
You have direct access to the user's desktop, filesystem, and Chromium browser via CDP.
Your goal is to complete the assigned task asynchronously and call 'finish_task' with the result.

## SYSTEM CONTEXT
Current Screen Resolution: ${getState().screenResolution?.width}x${getState().screenResolution?.height}px.
Use these dimensions for coordinate calculations.

## TOOL AWARENESS
Your available tools are: ${uniqueTools.map(t => t.name).join(', ')}.
CRITICAL: NEVER hallucinate a tool name. If a tool you want to use is not in the list above, you CANNOT use it.

## OPERATIONAL GUIDELINES
1. **CONTROL OVER SEARCH**: You have DIRECT control over the user's PC and a Chromium browser. 
   - DO NOT perform keyword searches for websites you already know (e.g., "Google YouTube"). Instead, use 'navigate_browser' with the direct URL.
   - Use 'web_search' ONLY for research and finding unknown links.
   - For all desktop tasks, use 'desktop_dump_tree' and 'desktop_find_element' to identify targets, then 'desktop_type_string' or 'desktop_click_at'.
2. **Direct Action Preferred**: Use 'navigate_browser', 'web_click', 'evaluate_browser_js', or 'fs_write_file' to perform actions directly. 
3. **Efficiency**: Combine steps when possible. Use 'evaluate_browser_js' for complex scraping or multi-click sequences.
4. **Completion**: You MUST call 'finish_task' when the task is done. The user is waiting for your report.

## ERROR HANDLING
- If a page fails to load, try once more or search for the correct URL.
- If a UI element is missing, use 'read_browser_dom' or 'take_screenshot' to understand why.
- NEVER claim success unless 'result' message from tool confirms it.
`;

        console.log(`[SubAgents] Initializing agent loop with tools:`, tools[0].functionDeclarations.map(f => f.name));
        const model = this._getModel("gemini-3-flash-preview", systemInstruction, tools);

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
                const thought = { time: new Date().toISOString(), type: 'thought', content: textResponse };
                task.history.push(thought);
                if (onUpdate) onUpdate({ jobId, ...thought });
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
                const toolCall = { time: new Date().toISOString(), type: 'tool', name: name, args: args };
                task.history.push(toolCall);
                if (onUpdate) onUpdate({ jobId, ...toolCall });
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
