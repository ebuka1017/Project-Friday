// skills/browser.js — Atomic Browser Skills
const desktopService = require('../electron/desktop-service');

module.exports = {
    browser_navigate: {
        definition: {
            name: "browser_navigate",
            description: "Navigate to a URL in the browser.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string" }
                },
                required: ["url"]
            }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Extension Disconnected: Connect the Friday Chrome extension.");
            return await context.browser.navigate(args.url);
        }
    },

    browser_get_dom: {
        definition: {
            name: "browser_get_dom",
            description: "Read the content of the current browser page.",
            parameters: { type: "object", properties: {} }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Extension Disconnected.");
            return await context.browser.getDOM();
        }
    },

    browser_click: {
        definition: {
            name: "browser_click",
            description: "Click an element (text, selector, or x,y).",
            parameters: {
                type: "object",
                properties: {
                    target: { type: "string" }
                },
                required: ["target"]
            }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Extension Disconnected.");
            return await context.browser.clickTarget(args.target);
        }
    },

    browser_type: {
        definition: {
            name: "browser_type",
            description: "Type text into a target.",
            parameters: {
                type: "object",
                properties: {
                    target: { type: "string" },
                    text: { type: "string" }
                },
                required: ["target", "text"]
            }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Extension Disconnected.");
            return await context.browser.typeTarget(args.target, args.text);
        }
    },

    browser_capture_screenshot: {
        definition: {
            name: "browser_capture_screenshot",
            description: "Capture a screenshot of the active tab.",
            parameters: { type: "object", properties: {} }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Extension Disconnected.");
            return await context.browser.screenshot();
        }
    },
    
    browser_open_tab: {
        definition: {
            name: "browser_open_tab",
            description: "Open a new tab with the specified URL.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string" }
                },
                required: ["url"]
            }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Extension Disconnected.");
            return await context.browser.createTab(args.url);
        }
    }
};
