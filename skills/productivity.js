// skills/productivity.js — Atomic Productivity Skills
const productivityTools = require('../electron/productivity-tools');

module.exports = {
    gmail_list: {
        definition: {
            name: "gmail_list",
            description: "List recent emails from Gmail.",
            parameters: { type: "object", properties: {} }
        },
        execute: async (args, context) => {
            if (!context.user) throw new Error("AUTH_REQUIRED");
            return await productivityTools.gmailList(context.user.id);
        }
    },

    gmail_read: {
        definition: {
            name: "gmail_read",
            description: "Read a specific Gmail message.",
            parameters: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"]
            }
        },
        execute: async (args, context) => {
            if (!context.user) throw new Error("AUTH_REQUIRED");
            return await productivityTools.gmailRead(context.user.id, args.id);
        }
    },

    gmail_send: {
        definition: {
            name: "gmail_send",
            description: "Send an email via Gmail.",
            parameters: {
                type: "object",
                properties: {
                    to: { type: "string" },
                    subject: { type: "string" },
                    body: { type: "string" }
                },
                required: ["to", "subject", "body"]
            }
        },
        execute: async (args, context) => {
            if (!context.user) throw new Error("AUTH_REQUIRED");
            return await productivityTools.gmailSend(context.user.id, args);
        }
    }
    // ... Additional Calendar/Drive skills can be added similarly
};
