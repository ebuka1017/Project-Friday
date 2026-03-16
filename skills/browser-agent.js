/**
 * skills/browser-agent.js
 * Bridges the Gemini tool call to the Electron IPC handler for the Python sidecar.
 */

module.exports = {
    browse_web: {
        definition: {
            name: "browse_web",
            description: "Delegates a web browsing task to an autonomous browser agent.",
            parameters: {
                type: "object",
                properties: {
                    task: { type: "string", description: "The task to perform." }
                },
                required: ["task"]
            }
        },
        execute: async ({ task }) => {
            console.log(`[Skill:browse_web] Delegating task: ${task}`);
            try {
                const manager = require('../electron/browser-agent-manager');
                const result = await manager.runTask(task);
                return result;
            } catch (err) {
                return { error: err.message };
            }
        }
    }
};
