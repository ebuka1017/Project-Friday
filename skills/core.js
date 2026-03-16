// skills/core.js — Core Agent Skills
module.exports = {
    finish_task: {
        definition: {
            name: "finish_task",
            description: "Call this when the task is successfully completed.",
            parameters: {
                type: "object",
                properties: {
                    summary: { type: "string", description: "Summary of what was done" }
                },
                required: ["summary"]
            }
        },
        execute: async (args) => {
            return { success: true, summary: args.summary, isDone: true };
        }
    },

    delegate_task: {
        definition: {
            name: "delegate_task",
            description: "Spawn a background sub-agent for a complex sub-task.",
            parameters: {
                type: "object",
                properties: {
                    taskDescription: { type: "string" }
                },
                required: ["taskDescription"]
            }
        },
        execute: async (args) => {
            // This is actually handled in the sub-agent manager itself typically,
            // but we can define it here and handle it in the loop.
            return { success: true, delegatedTask: args.taskDescription };
        }
    }
};
