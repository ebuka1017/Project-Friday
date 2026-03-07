// ═══════════════════════════════════════════════════════════════════════
// electron/sub-agents.js — Async Background Task Manager
// Uses Gemini 1.5 Pro REST API to run headless tasks asynchronously
// without blocking the main live voice session.
// ═══════════════════════════════════════════════════════════════════════

const searchTools = require('./search-tools');
const productivityTools = require('./productivity-tools');
const notificationTools = require('./notification-tools');
const networkTools = require('./network-tools');
const sysinfoTools = require('./sysinfo-tools');
const { getState } = require('./state');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const browserServer = require('./browser-server');
const toolsRegistry = require('../shared/tools-registry');
const pipeClient = require('./pipe-client');
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
        return this._startGenericTask(taskDescription, onComplete, false);
    }

    /**
     * Start a visual browsing task (Computer Use).
     */
    startVisualTask(taskDescription, onComplete) {
        return this._startGenericTask(taskDescription, onComplete, true);
    }

    _startGenericTask(taskDescription, onComplete, isVisual) {
        if (!process.env.GEMINI_API_KEY) {
            onComplete({ error: 'GEMINI_API_KEY not set' });
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
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-computer-use-preview-10-2025",
            // Note: The specific format for computer_use tool in Node SDK 
            // is often passed as a tool with 'computer_use' property.
            tools: [{
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
            }]
        });

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

                // Execute Computer Use action
                let toolRes = {};
                try {
                    toolRes = await this._executeComputerUseAction(name, args);
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

    async _executeComputerUseAction(name, args) {
        // Computer Use model uses 0-999 coordinates.
        // We need to scale them to the actual viewport size.
        // For now, we assume 1280x720 or 1440x900 if not specified.
        // Future: get actual viewport from browserServer.
        const width = 1240; // Approx inner width
        const height = 820; // Approx inner height

        const scale = (val, max) => Math.floor((val / 1000) * max);

        if (name === "click_at" || name === "hover_at") {
            const x = scale(args.x, width);
            const y = scale(args.y, height);
            return await browserServer.clickTarget(`${x},${y}`);
        } else if (name === "type_text_at") {
            const x = scale(args.x, width);
            const y = scale(args.y, height);
            return await browserServer.typeTarget(`${x},${y}`, args.text);
        } else if (name === "navigate") {
            return await browserServer.navigate(args.url);
        } else if (name === "go_back") {
            return await browserServer.goBack();
        } else if (name === "go_forward") {
            return await browserServer.goForward();
        } else if (name === "scroll_document") {
            // Mapping direction to CDP scroll or script
            const script = `window.scrollBy({ top: ${args.direction === 'down' ? 500 : (args.direction === 'up' ? -500 : 0)}, left: ${args.direction === 'right' ? 500 : (args.direction === 'left' ? -500 : 0)}, behavior: 'smooth' });`;
            await browserServer.evaluate(script);
            return { success: true };
        } else if (name === "open_web_browser") {
            return { success: true, message: "Browser already open." };
        } else if (name === "wait_5_seconds") {
            await new Promise(r => setTimeout(r, 5000));
            return { success: true };
        }

        return { error: `Computer Use action ${name} not implemented.` };
    }

    async _runAgentLoop(jobId, taskDescription) {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        // Load tools from shared registry
        const tools = [{
            functionDeclarations: toolsRegistry.getSubAgentTools()
        }];

        const model = genAI.getGenerativeModel({
            model: "gemini-3.1-flash-lite-preview",
            systemInstruction: "You are a headless background worker agent. You have native access to the user's desktop and browser. Complete the task assigned to you asynchronously. You MUST call the finish_task tool when you are completely done. Be efficient and use tools directly whenever possible.\n\nSEARCH STRATEGY:\n- If the task explicitly requires showing the user a search result, use `navigate_browser` or `open_default_browser`.\n- For all other research needed to complete your task, use `web_search` to keep the user's workspace clean.",
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
        const state = getState();
        const userId = state.currentUser?.id;

        // Desktop
        if (name === 'desktop_type_string') {
            return await pipeClient.send('input.typeString', { text: args.text });
        } else if (name === 'desktop_send_chord') {
            return await pipeClient.send('input.sendChord', { keys: args.chord });
        } else if (name === 'desktop_click_at') {
            return await pipeClient.send('input.clickAt', { x: args.x, y: args.y });
        } else if (name === 'desktop_find_element') {
            const params = { name: args.name };
            if (args.controlType) params.controlType = args.controlType;
            return await pipeClient.send('uia.findElement', params);
        } else if (name === 'desktop_dump_tree') {
            return await pipeClient.send('uia.dumpTree', {});
        } else if (name === 'process_list') {
            return await pipeClient.send('process.list', {});
        } else if (name === 'process_kill') {
            return await pipeClient.send('process.kill', { pid: args.pid });
        }
        // Window Management
        else if (name === 'window_list') {
            return await pipeClient.send('window.list', {});
        } else if (name === 'window_focus') {
            return await pipeClient.send('window.focus', { handle: args.handle });
        } else if (name === 'window_close') {
            return await pipeClient.send('window.close', { handle: args.handle });
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
        } else if (name === 'browser_back') {
            return await browserServer.goBack();
        } else if (name === 'browser_forward') {
            return await browserServer.goForward();
        } else if (name === 'web_click') {
            return await browserServer.clickTarget(args.selector);
        } else if (name === 'web_type') {
            return await browserServer.typeTarget(args.selector, args.text);
        }
        // File System
        else if (name === 'fs_list_directory') {
            return await fsTools.listDirectory(args.path);
        } else if (name === 'fs_read_file') {
            return await fsTools.readFileStr(args.path);
        } else if (name === 'fs_write_file') {
            return await fsTools.writeFileStr(args.path, args.content);
        }
        // World / Search
        else if (name === 'web_search') {
            return await searchTools.webSearch(args.query);
        } else if (name === 'web_deepdive') {
            return await searchTools.webDeepdive(args.url);
        }
        // Productivity (Gmail)
        else if (name === 'gmail_list') {
            if (!userId) return { error: 'AUTH_REQUIRED: User not signed in' };
            return await productivityTools.gmailList(userId);
        } else if (name === 'gmail_read') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.gmailRead(userId, args.id);
        } else if (name === 'gmail_send') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.gmailSend(userId, args);
        }
        // Google Cal
        else if (name === 'calendar_google_list') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.calendarGoogleList(userId);
        } else if (name === 'calendar_google_create') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.calendarGoogleCreate(userId, args);
        }
        // Google Drive
        else if (name === 'drive_list') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.driveList(userId, args.query);
        } else if (name === 'drive_read') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.driveRead(userId, args.fileId);
        }
        // Outlook
        else if (name === 'outlook_list') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.outlookList(userId);
        } else if (name === 'outlook_send') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.outlookSend(userId, args);
        } else if (name === 'calendar_outlook_list') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.calendarOutlookList(userId);
        }
        // System / Notification
        else if (name === 'get_system_info') {
            return await sysinfoTools.getSystemInfo();
        } else if (name === 'show_notification') {
            return notificationTools.showNotification(args.title, args.body);
        } else if (name === 'show_message_dialog') {
            return await notificationTools.showMessageDialog(args);
        } else if (name === 'http_request') {
            return await networkTools.httpRequest(args);
        } else if (name === 'get_user_profile') {
            const profile = await getState().currentUser;
            return profile || { error: 'Not signed in' };
        }

        throw new Error(`Unknown tool: ${name}`);
    }
}

module.exports = new SubAgentManager();
