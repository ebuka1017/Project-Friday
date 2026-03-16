// skills/desktop.js — Atomic OS Control Skills
const desktopService = require('../electron/desktop-service');
const pipeClient = require('../electron/pipe-client');

module.exports = {
    get_desktop_state: {
        definition: {
            name: "get_desktop_state",
            description: "Capture the current state of the desktop, including open windows, accessibility tree, and a screenshot.",
            parameters: {
                type: "object",
                properties: {
                    use_vision: { type: "boolean", description: "Whether to include a screenshot." },
                    use_accessibility: { type: "boolean", description: "Whether to include the UI tree." }
                }
            }
        },
        execute: async (args, context) => {
            return await desktopService.getFullState({
                useVision: args.use_vision !== false,
                useAccessibility: args.use_accessibility !== false,
                browser: context.browser
            });
        }
    },

    click_at: {
        definition: {
            name: "click_at",
            description: "Click at specific screen coordinates (x, y).",
            parameters: {
                type: "object",
                properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    button: { type: "string", enum: ["left", "right", "middle"], default: "left" },
                    clicks: { type: "number", default: 1 }
                },
                required: ["x", "y"]
            }
        },
        execute: async (args) => {
            return await pipeClient.send('input.clickAt', { 
                x: args.x, 
                y: args.y, 
                button: args.button || 'left',
                clicks: args.clicks || 1
            });
        }
    },

    type_text: {
        definition: {
            name: "type_text",
            description: "Type text into the currently focused field.",
            parameters: {
                type: "object",
                properties: {
                    text: { type: "string" },
                    press_enter: { type: "boolean", default: false }
                },
                required: ["text"]
            }
        },
        execute: async (args) => {
            const res = await pipeClient.send('input.typeString', { text: args.text });
            if (args.press_enter) {
                await pipeClient.send('input.sendChord', { keys: 'Enter' });
            }
            return res;
        }
    }
};
