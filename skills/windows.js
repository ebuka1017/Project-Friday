// skills/windows.js — Strategic Window Management
const pipeClient = require('../electron/pipe-client');

module.exports = {
    list_windows: {
        definition: {
            name: "list_windows",
            description: "List all visible windows on the desktop with their titles and handles.",
            parameters: { type: "object", properties: {} }
        },
        execute: async () => {
            const res = await pipeClient.send('window.list');
            return res;
        }
    },

    focus_window: {
        definition: {
            name: "focus_window",
            description: "Focus a window using its handle (obtained from list_windows).",
            parameters: {
                type: "object",
                properties: {
                    handle: { type: "number", description: "The window handle (HWND)" }
                },
                required: ["handle"]
            }
        },
        execute: async (args) => {
            return await pipeClient.send('window.focus', { handle: args.handle });
        }
    },

    close_window: {
        definition: {
            name: "close_window",
            description: "Close a window gracefully using its handle.",
            parameters: {
                type: "object",
                properties: {
                    handle: { type: "number", description: "The window handle (HWND)" }
                },
                required: ["handle"]
            }
        },
        execute: async (args) => {
            return await pipeClient.send('window.close', { handle: args.handle });
        }
    }
};
