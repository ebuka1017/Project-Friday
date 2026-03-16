// skills/browser-manager.js — Unified Browser Context Management
const subAgents = require('../electron/sub-agents');
const browserServer = require('../electron/browser-server');

module.exports = {
    list_browsers: {
        definition: {
            name: "list_browsers",
            description: "List all active browser contexts, including the user's real browser (extension) and background agent browsers.",
            parameters: { type: "object", properties: {} }
        },
        execute: async () => {
            const agentBrowsers = subAgents.getActiveTaskBrowsers();
            const mainConnected = browserServer.isConnected();
            
            return {
                main: mainConnected ? { status: "connected", type: "system_browser" } : { status: "disconnected" },
                agents: agentBrowsers
            };
        }
    }
};
