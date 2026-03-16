// ═══════════════════════════════════════════════════════════════════════
// electron/tool-executor.js — Unified Tool Execution Bridge
// ═══════════════════════════════════════════════════════════════════════

const skillManager = require('./skill-manager');
const { getState } = require('./state');
const { logAction } = require('./session-log');
const strategyCache = require('./strategy-cache');
const browserServer = require('./browser-server');

class LocalToolExecutor {
    constructor() {
        skillManager.loadAll();
    }

    /**
     * Executes a tool regardless of whether it's Computer Use or Native.
     */
    async executeTool(name, args, context = {}) {
        const state = getState();
        const browser = context.browser || browserServer;
        const ctx = { ...context, browser, user: state.currentUser };

        try {
            // Log attempt
            logAction({ tool: name, status: 'started', description: JSON.stringify(args).slice(0, 100) });

            // Execute via SkillManager
            const result = await skillManager.execute(name, args, ctx);

            // Log success
            logAction({ tool: name, status: 'success', result });
            strategyCache.recordOutcome(name, !result.error);

            return result;
        } catch (err) {
            console.error(`[ToolExecutor] Execution failed for ${name}:`, err.message);
            logAction({ tool: name, status: 'failed', description: err.message });
            strategyCache.recordOutcome(name, false);
            return { error: err.message };
        }
    }

    // Proxy for legacy calls if needed
    async executeNativeTool(name, args, context = {}) {
        return this.executeTool(name, args, context);
    }

    async executeComputerUseAction(name, args, context = {}) {
        return this.executeTool(name, args, context);
    }
}

module.exports = new LocalToolExecutor();
