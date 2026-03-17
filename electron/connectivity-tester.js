const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ZepClient } = require('@getzep/zep-cloud');

/**
 * ConnectivityTester
 * Pings all configured API services to verify credentials and network access on startup.
 */
class ConnectivityTester {
    constructor() {
        this.results = {};
    }

    async testAll() {
        console.log('[Connectivity] Starting API connectivity checks...');
        
        await Promise.allSettled([
            this.testGemini(),
            this.testClerk(),
            this.testExa(),
            this.testFirecrawl(),
            this.testIframely(),
            this.testZep()
        ]);

        console.log('[Connectivity] Checks complete.');
        this.logSummary();
        return this.results;
    }

    async testGemini() {
        const key = process.env.GEMINI_API_KEY;
        if (!key) {
            this.results.gemini = { ok: false, error: 'Missing GEMINI_API_KEY' };
            return;
        }
        try {
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            // Simple ping with a tiny prompt
            await model.generateContent({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] });
            this.results.gemini = { ok: true };
        } catch (err) {
            this.results.gemini = { ok: false, error: err.message };
        }
    }

    async testClerk() {
        const key = process.env.CLERK_CLIENT_SECRET;
        if (!key) {
            this.results.clerk = { ok: false, error: 'Missing CLERK_CLIENT_SECRET' };
            return;
        }
        try {
            const res = await axios.get('https://api.clerk.com/v1/users?limit=1', {
                headers: { Authorization: `Bearer ${key}` }
            });
            this.results.clerk = { ok: res.status === 200 };
        } catch (err) {
            this.results.clerk = { ok: false, error: err.message };
        }
    }

    async testExa() {
        const key = process.env.EXA_API_KEY;
        if (!key) {
            this.results.exa = { ok: false, error: 'Missing EXA_API_KEY' };
            return;
        }
        try {
            const res = await axios.post('https://api.exa.ai/search', {
                query: 'test',
                numResults: 1
            }, {
                headers: { 'x-api-key': key }
            });
            this.results.exa = { ok: res.status === 200 };
        } catch (err) {
            this.results.exa = { ok: false, error: err.message };
        }
    }

    async testFirecrawl() {
        const key = process.env.FIRECRAWL_API_KEY;
        if (!key) {
            this.results.firecrawl = { ok: false, error: 'Missing FIRECRAWL_API_KEY' };
            return;
        }
        try {
            // Using a simple GET check if possible, or a tiny scrape
            const res = await axios.get('https://api.firecrawl.dev/v1/team-usage', {
                headers: { Authorization: `Bearer ${key}` }
            });
            this.results.firecrawl = { ok: res.status === 200 };
        } catch (err) {
            this.results.firecrawl = { ok: false, error: err.message };
        }
    }

    async testIframely() {
        const key = process.env.IFRAMELY_KEY;
        if (!key) {
            this.results.iframely = { ok: false, error: 'Missing IFRAMELY_KEY' };
            return;
        }
        try {
            const res = await axios.get(`https://iframe.ly/api/iframely?url=https://google.com&key=${key}`);
            this.results.iframely = { ok: res.status === 200 };
        } catch (err) {
            this.results.iframely = { ok: false, error: err.message };
        }
    }

    async testZep() {
        const key = process.env.ZEP_API_KEY;
        if (!key) {
            this.results.zep = { ok: false, error: 'Missing ZEP_API_KEY' };
            return;
        }
        try {
            const client = new ZepClient({ apiKey: key });
            // Simple model list or similar call
            await client.graph.search({ userId: "system_test", query: "test", limit: 1 });
            this.results.zep = { ok: true };
        } catch (err) {
            this.results.zep = { ok: false, error: err.message };
        }
    }

    logSummary() {
        console.log('─── API Connectivity Summary ───');
        Object.entries(this.results).forEach(([svc, res]) => {
            const status = res.ok ? '✅ OK' : `❌ FAIL (${res.error})`;
            console.log(`${svc.padEnd(10)}: ${status}`);
        });
        console.log('────────────────────────────────');
    }
}

module.exports = new ConnectivityTester();
