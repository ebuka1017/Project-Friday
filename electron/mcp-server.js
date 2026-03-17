// ═══════════════════════════════════════════════════════════════════════
// electron/mcp-server.js — Friday Model Context Protocol Server
// Exposes Friday's native desktop & browser capabilities to external
// AI clients (like Claude Desktop) over Standard I/O.
// ═══════════════════════════════════════════════════════════════════════

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const pipeClient = require('./pipe-client');
const browserServer = require('./browser-server');
const { shell } = require('electron');

class FridayMCPServer {
    constructor() {
        this.server = new Server(
            { name: "Friday Native Engine", version: "0.1.0" },
            { capabilities: { tools: {} } }
        );

        this.setupHandlers();
    }

    setupHandlers() {
        // 1. List Available Tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "desktop_type_string",
                        description: "Type a string into the currently focused application on the desktop.",
                        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
                    },
                    {
                        name: "desktop_send_chord",
                        description: "Send a keyboard shortcut. Examples: 'Ctrl+C', 'Alt+Tab', 'Win+E', 'Enter'.",
                        inputSchema: { type: "object", properties: { keys: { type: "string" } }, required: ["keys"] }
                    },
                    {
                        name: "desktop_click_at",
                        description: "Click at specific screen coordinates.",
                        inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }
                    },
                    {
                        name: "desktop_find_element",
                        description: "Find a UI element by name using Windows UI Automation.",
                        inputSchema: { type: "object", properties: { name: { type: "string" }, controlType: { type: "string" } }, required: ["name"] }
                    },
                    {
                        name: "desktop_dump_tree",
                        description: "Get a tree of UI elements of the currently focused window.",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "browser_navigate",
                        description: "Navigate the active browser tab to a URL.",
                        inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
                    },
                    {
                        name: "browser_get_dom",
                        description: "Read the current browser page title, URL, and DOM text.",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "browser_click",
                        description: "Click a target on the browser page (text, selector, or x,y).",
                        inputSchema: { type: "object", properties: { target: { type: "string", description: "Text or CSS selector or x,y coordinates" } }, required: ["target"] }
                    },
                    {
                        name: "browser_type",
                        description: "Type text into a target on the browser page.",
                        inputSchema: { type: "object", properties: { target: { type: "string" }, text: { type: "string" } }, required: ["target", "text"] }
                    },
                    {
                        name: "browser_press_key",
                        description: "Press a key on the browser page (e.g., Enter, Escape).",
                        inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] }
                    },
                    {
                        name: "browser_capture_screenshot",
                        description: "Capture a screenshot of the active browser tab.",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "evaluate_browser_js",
                        description: "Execute JavaScript in the active browser tab.",
                        inputSchema: { type: "object", properties: { script: { type: "string" } }, required: ["script"] }
                    },
                    {
                        name: "open_default_browser",
                        description: "Open a URL in the user's default system browser.",
                        inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
                    }
                ]
            };
        });

        // 2. Handle Tool Execution
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            let resultText = "";
            let isError = false;

            try {
                if (this.authCheck && !this.authCheck()) {
                    throw new Error("Unauthorized: Please sign in to the Friday app first.");
                }

                // Check extension connectivity for browser tools
                if (name.includes('browser') && name !== 'open_default_browser' && !browserServer.isConnected()) {
                    throw new Error("Extension Disconnected: Please connect the Friday Chrome extension to use this tool.");
                }

                if (!pipeClient.isConnected && name.startsWith('desktop_')) {
                    throw new Error("Desktop sidecar engine is not connected.");
                }

                // Desktop Tools
                if (name === 'desktop_type_string') {
                    const res = await pipeClient.send('input.typeString', { text: args.text });
                    resultText = JSON.stringify(res);
                } else if (name === 'desktop_send_chord') {
                    const res = await pipeClient.send('input.sendChord', { keys: args.keys });
                    resultText = JSON.stringify(res);
                } else if (name === 'desktop_click_at') {
                    const res = await pipeClient.send('input.clickAt', { x: args.x, y: args.y });
                    resultText = JSON.stringify(res);
                } else if (name === 'desktop_find_element') {
                    const params = { name: args.name };
                    if (args.controlType) params.controlType = args.controlType;
                    const res = await pipeClient.send('uia.findElement', params);
                    resultText = JSON.stringify(res);
                } else if (name === 'desktop_dump_tree') {
                    const res = await pipeClient.send('uia.dumpTree', {});
                    resultText = JSON.stringify(res);
                }
                // Browser Tools
                else if (name === 'browser_navigate') {
                    const res = await browserServer.navigate(args.url);
                    resultText = JSON.stringify(res);
                } else if (name === 'browser_get_dom') {
                    const res = await browserServer.getDOM();
                    resultText = JSON.stringify(res);
                } else if (name === 'browser_click') {
                    const res = await browserServer.clickTarget(args.target);
                    resultText = JSON.stringify(res);
                } else if (name === 'browser_type') {
                    const res = await browserServer.typeTarget(args.target, args.text);
                    resultText = JSON.stringify(res);
                } else if (name === 'browser_press_key') {
                    const res = await browserServer.pressKey(args.key);
                    resultText = JSON.stringify(res);
                } else if (name === 'browser_capture_screenshot') {
                    const res = await browserServer.captureScreenshot();
                    resultText = res ? "Screenshot captured (base64 data)" : "Failed to capture screenshot";
                } else if (name === 'evaluate_browser_js') {
                    const res = await browserServer.evaluate(args.script);
                    resultText = JSON.stringify(res);
                } else if (name === 'open_default_browser') {
                    await shell.openExternal(args.url);
                    resultText = `Successfully opened ${args.url} in default browser`;
                } else {
                    throw new Error(`Unknown tool: ${name}`);
                }
            } catch (err) {
                isError = true;
                resultText = `Error: ${err.message}`;
            }

            return {
                content: [{ type: "text", text: resultText }],
                isError
            };
        });
    }

    async start() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('[MCPServer] Friday Model Context Protocol Server running on stdio');
    }
}

let instance = null;
function startMCPServer(authCheck) {
    if (!instance) {
        instance = new FridayMCPServer();
        instance.authCheck = authCheck;
        instance.start().catch(e => console.error('[MCPServer] Start Error:', e));
    }
    return instance;
}

module.exports = { startMCPServer };
