// electron/memory-manager.js
const { ZepClient } = require('@getzep/zep-cloud');
const db = require('./db');

class MemoryManager {
    constructor() {
        this.zepClient = null;
    }

    _initZep() {
        const apiKey = process.env.ZEP_API_KEY;
        if (apiKey && !this.zepClient) {
            this.zepClient = new ZepClient({ apiKey });
            console.log('[MemoryManager] Zep Cloud client initialized.');
        }
        return this.zepClient;
    }

    async saveToMemory(userId = "default_user", content) {
        // Save to Zep Cloud (Graph)
        let zepSuccess = false;
        let zepError = null;

        const client = this._initZep();
        if (client) {
            try {
                // Add fact to knowledge graph
                await client.graph.add({ userId, type: 'text', data: content });
                zepSuccess = true;
            } catch (err) {
                if (err.message.includes('404')) {
                    console.warn('[MemoryManager] Zep Cloud Graph/User not found (404). Check Zep Project settings.');
                } else {
                    console.error('[MemoryManager] Zep Cloud save failed:', err.message);
                }
                zepError = err.message;
            }
        } else {
            zepError = "ZEP_API_KEY not found in environment.";
        }

        // Always save to Local SQLite Memory as well
        const localKey = `fact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        try {
            await db.setMemory(localKey, content, "Fact saved from conversation");
            console.log(`[MemoryManager] Saved to local SQLite memory: ${localKey}`);
        } catch (dbErr) {
            console.error('[MemoryManager] SQLite save failed:', dbErr.message);
        }

        return {
            success: zepSuccess || !zepError, // Consider success if local worked
            zepSuccess,
            zepError
        };
    }

    async searchMemory(userId = "default_user", query) {
        let facts = [];
        let zepSuccess = false;
        let zepError = null;

        const client = this._initZep();
        if (client) {
            try {
                // Search the Zep knowledge graph
                const results = await client.graph.search({ userId, query, limit: 5 });
                if (results && results.edges) {
                    facts = results.edges.map(e => e.fact);
                }
                zepSuccess = true;
            } catch (err) {
                if (err.message.includes('404')) {
                    console.warn('[MemoryManager] Zep Cloud Graph/User not found (404). Check Zep Project settings.');
                } else {
                    console.error('[MemoryManager] Zep Cloud search failed:', err.message);
                }
                zepError = err.message;
            }
        } else {
            zepError = "ZEP_API_KEY not found in environment.";
        }

        // If Zep failed or didn't return much, search local SQLite
        if (facts.length === 0) {
            try {
                const localMemories = await db.getAllMemories();
                // Simple keyword search for local fallback
                const lowerQuery = query.toLowerCase();
                const matchedMemories = localMemories
                    .filter(m => m.value && typeof m.value === 'string' && m.value.toLowerCase().includes(lowerQuery))
                    .map(m => m.value);

                facts = facts.concat(matchedMemories);
            } catch (dbErr) {
                console.error('[MemoryManager] SQLite search failed:', dbErr.message);
            }
        }

        return {
            success: true,
            facts,
            zepSuccess,
            zepError
        };
    }
}

module.exports = new MemoryManager();
