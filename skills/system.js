// skills/system.js — Atomic System Skills
const sysinfoTools = require('../electron/sysinfo-tools');
const notificationTools = require('../electron/notification-tools');
const networkTools = require('../electron/network-tools');

module.exports = {
    get_system_info: {
        definition: {
            name: "get_system_info",
            description: "Get OS, CPU, RAM, and Battery status.",
            parameters: { type: "object", properties: {} }
        },
        execute: async () => {
            return await sysinfoTools.getSystemInfo();
        }
    },

    show_notification: {
        definition: {
            name: "show_notification",
            description: "Show a system notification.",
            parameters: {
                type: "object",
                properties: {
                    title: { type: "string" },
                    body: { type: "string" }
                },
                required: ["title", "body"]
            }
        },
        execute: async (args) => {
            return notificationTools.showNotification(args.title, args.body);
        }
    },

    http_request: {
        definition: {
            name: "http_request",
            description: "Perform a raw HTTP request.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string" },
                    method: { type: "string", default: "GET" }
                },
                required: ["url"]
            }
        },
        execute: async (args) => {
            return await networkTools.httpRequest(args);
        }
    }
};
