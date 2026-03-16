// skills/browser.js — Atomic Browser Skills
const desktopService = require('../electron/desktop-service');

module.exports = {
    navigate: {
        definition: {
            name: "navigate",
            description: "Navigate to a URL in the agent's browser.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string" }
                },
                required: ["url"]
            }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Browser not available in this context.");
            return await context.browser.navigate(args.url);
        }
    },

    read_page: {
        definition: {
            name: "read_page",
            description: "Read the content of the current browser page.",
            parameters: { type: "object", properties: {} }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Browser not available.");
            return await context.browser.getDOM();
        }
    },

    click_element: {
        definition: {
            name: "click_element",
            description: "Click an element in the browser by CSS selector or accessible name.",
            parameters: {
                type: "object",
                properties: {
                    selector: { type: "string", description: "CSS selector or 'x,y' coordinates." }
                },
                required: ["selector"]
            }
        },
        execute: async (args, context) => {
            if (!context.browser) throw new Error("Browser not available.");
            return await context.browser.click(args.selector);
        }
    }
};
