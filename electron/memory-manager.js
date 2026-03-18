// electron/memory-manager.js
const { ZepClient } = require('@getzep/zep-cloud');
const db = require('./db');

class MemoryManager {
    constructor() {
        this.zepClient = null;
        this._creatingThreads = new Set();
    }

    _initZep() {
        const apiKey = process.env.ZEP_API_KEY;
        if (apiKey && !this.zepClient) {
            this.zepClient = new ZepClient({ apiKey });
            console.log('[MemoryManager] Zep Cloud client initialized.');
        }
        return this.zepClient;
    }

    /**
     * Records a message to a Zep thread. Zep will automatically extract facts and entities.
     * @param {string} threadId - Unique ID for the conversation/task
     * @param {string} role - 'human' or 'ai'
     * @param {string} content - Message text
     */
    async addMessage(threadId, role, content) {
        const client = this._initZep();
        if (!client) return;

        try {
            await client.thread.addMessages(threadId, {
                messages: [{
                    role: role === 'ai' ? 'assistant' : 'user',
                    roleType: role === 'ai' ? 'assistant' : 'user',
                    content: content
                }]
            });
        } catch (err) {
            if (err.message.includes('404')) {
                // Fix BUG-011: Thread creation race
                if (this._creatingThreads.has(threadId)) {
                    await new Promise(r => setTimeout(r, 200));
                    return this.addMessage(threadId, role, content);
                }
                this._creatingThreads.add(threadId);

                try {
                    // Thread not found, create it with the first message
                    // 1. Try to create user first (idempotent-ish)
                    try {
                        await client.user.create({
                            userId: "default_user",
                            firstName: "Friday",
                            lastName: "User"
                        });
                    } catch (e) {}

                    // 2. Create thread
                    await client.thread.create({
                        threadId,
                        userId: "default_user",
                        messages: [{
                            role: role === 'ai' ? 'assistant' : 'user',
                            content: content
                        }]
                    });
                    return;
                } catch (createErr) {
                    console.error(`[MemoryManager] Zep thread creation failed for ${threadId}:`, createErr.message);
                } finally {
                    this._creatingThreads.delete(threadId);
                }
            }
            console.error(`[MemoryManager] Zep addMessage failed for ${threadId}:`, err.message);
            if (err.message.includes('403')) console.warn('[MemoryManager] 403 Forbidden: Check Zep API Key permissions.');
        }
    }

    /**
     * Saves a summary or specific fact to memory.
     */
    async saveToMemory(userId = "default_user", content, threadId = null) {
        const client = this._initZep();
        let zepSuccess = false;

        if (client) {
            try {
                if (threadId) {
                    // Prefer adding to thread for automatic extraction
                    await this.addMessage(threadId, 'ai', content);
                } else {
                    // Fallback to manual graph add
                    await client.graph.add({ userId, type: 'text', data: content });
                }
                zepSuccess = true;
            } catch (err) {
                console.error('[MemoryManager] Zep Cloud save failed:', err.message);
            }
        }

        // Always local fallback
        const localKey = `fact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        try {
            await db.setMemory(localKey, content, "Fact saved from conversation");
        } catch (e) {}

        return { success: zepSuccess };
    }

    /**
     * Retrieves assembly of relevant context (facts/entities) for a thread.
     */
    async searchMemory(userId = "default_user", query, threadId = null) {
        const ctx = await this.getStructuredContext(userId, threadId, query);
        // Fallback for current searchMemory signature users
        const facts = [...ctx.importantToKnow, ...ctx.pastConversations];
        return { success: true, facts, zepSuccess: true, structured: ctx };
    }

    /**
     * Helper to fetch ALL messages for a thread using pagination.
     */
    async _fetchAllMessages(client, threadId) {
        let allMessages = [];
        let cursor = 1;
        const limit = 100;
        let hasMore = true;
        let iterations = 0;
        const MAX_ITERATIONS = 500;

        while (hasMore && iterations++ < MAX_ITERATIONS) {
            try {
                const response = await client.thread.get(threadId, { cursor, limit });
                if (response && response.messages && response.messages.length > 0) {
                    allMessages = allMessages.concat(response.messages);
                    cursor += response.messages.length;
                    hasMore = response.messages.length === limit;
                } else {
                    hasMore = false;
                }
            } catch (err) {
                console.error(`[MemoryManager] Failed to fetch page for thread ${threadId}:`, err.message);
                hasMore = false;
            }
        }
        return allMessages;
    }

    /**
     * Helper to fetch ALL threads using pagination.
     */
    async _fetchAllThreads(client) {
        let allThreads = [];
        let pageNumber = 1;
        const pageSize = 100;
        let hasMore = true;

        while (hasMore) {
            try {
                const response = await client.thread.listAll({ pageNumber, pageSize });
                if (response && response.threads && response.threads.length > 0) {
                    allThreads = allThreads.concat(response.threads);
                    pageNumber++;
                    hasMore = response.threads.length === pageSize;
                } else {
                    hasMore = false;
                }
            } catch (err) {
                console.error(`[MemoryManager] Failed to fetch page ${pageNumber} of threads:`, err.message);
                hasMore = false;
            }
        }
        return allThreads;
    }

    /**
     * Returns structured memory components as requested by user.
     */
    async getStructuredContext(userId = "default_user", threadId = null, query = "") {
        const client = this._initZep();
        const response = {
            currentThread: [],
            pastConversations: [],
            importantToKnow: []
        };

        if (!client) return response;

        try {
            // 1. Current Thread Messages (UNLIMITED)
            if (threadId) {
                const messages = await this._fetchAllMessages(client, threadId);
                response.currentThread = messages.map(m => `${m.role}: ${m.content}`);
            }

            // 2. Important to Know (Knowledge Graph Facts)
            if (threadId) {
                const contextResponse = await client.thread.getUserContext(threadId);
                if (contextResponse && contextResponse.context) {
                    response.importantToKnow = [contextResponse.context];
                }
            } else {
                const graphResults = await client.graph.search({ userId, query, limit: 30 });
                if (graphResults && graphResults.edges) {
                    response.importantToKnow = graphResults.edges.map(e => e.fact);
                }
            }

            // 3. Past Conversations (UNLIMITED threads + transcripts)
            const allThreads = await this._fetchAllThreads(client);
            if (allThreads && allThreads.length > 0) {
                const pastThreads = allThreads.filter(t => t.threadId !== threadId);
                
                for (const t of pastThreads) {
                    try {
                        const messages = await this._fetchAllMessages(client, t.threadId);
                        if (messages && messages.length > 0) {
                            const transcript = messages
                                .map(m => `  ${m.role}: ${m.content}`)
                                .join('\n');
                            response.pastConversations.push(`CONVERSATION ${t.threadId}:\n${transcript}`);
                        }
                    } catch (e) {
                        response.pastConversations.push(`CONVERSATION ${t.threadId} (Metadata): Started ${t.createdAt}`);
                    }
                }
            }
        } catch (err) {
            console.error('[MemoryManager] getStructuredContext failed:', err.message);
        }

        return response;
    }

    /**
     * Synchronizes any unsynced local messages from SQLite to Zep Cloud.
     */
    async syncLocalToZep(userId = "default_user") {
        const client = this._initZep();
        if (!client) return;

        try {
            const db = require('./db');
            const unsynced = await db.getUnsyncedMessages();
            if (!unsynced || unsynced.length === 0) return;

            console.log(`[MemoryManager] Syncing ${unsynced.length} messages to Zep Cloud...`);

            // Group by session_id
            const groups = unsynced.reduce((acc, msg) => {
                if (!acc[msg.session_id]) acc[msg.session_id] = [];
                acc[msg.session_id].push({
                    role: msg.role,
                    content: msg.text,
                    createdAt: msg.created_at
                });
                return acc;
            }, {});

            for (const sessionId in groups) {
                try {
                    await client.thread.addMessages(sessionId, {
                        messages: groups[sessionId]
                    });
                    
                    // Mark all in group as synced
                    for (const msg of unsynced.filter(m => m.session_id === sessionId)) {
                        await db.markMessageSynced(msg.id);
                    }
                    console.log(`[MemoryManager] Synced session: ${sessionId}`);
                } catch (err) {
                    console.error(`[MemoryManager] Failed to sync session ${sessionId}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[MemoryManager] Sync failed:', err.message);
        }
    }
}

module.exports = new MemoryManager();
