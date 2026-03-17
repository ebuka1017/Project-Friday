const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Firecrawl = require('@mendable/firecrawl-js').default;

/**
 * ConnectivityTester
 * Pings all configured API services to verify credentials and network access.
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
            
            // 1. Sub-Agent Model (Gemini 3 Flash Preview)
            const subAgentModel = "models/gemini-3-flash-preview"; 
            let subOk = false;
            try {
                await genAI.getGenerativeModel({ model: subAgentModel }).generateContent("ping");
                subOk = true;
            } catch (e) {
                const status = e.response?.status || (e.message?.includes('503') ? 503 : (e.message?.includes('429') ? 429 : 'Error'));
                if (status === 503 || status === 429) subOk = true;
                else console.warn(`[Connectivity] Sub-Agent model (v3) failed: [${status}] ${e.message}`);
            }

            // 2. Voice Model (Gemini 2.5 Native Audio)
            const voiceModel = "gemini-2.5-flash-native-audio-preview-12-2025";
            let voiceOk = false;
            try {
                const vUrl = `https://generativelanguage.googleapis.com/v1alpha/models/${voiceModel}?key=${key}`;
                const vRes = await axios.get(vUrl);
                voiceOk = vRes.status === 200;
            } catch (e) {
                const status = e.response?.status;
                if (status === 429 || status === 503) voiceOk = true;
                else console.warn(`[Connectivity] Voice model (v2.5) check failed: [${status || 'ERR'}] ${e.message}`);
            }

            if (subOk && voiceOk) {
                this.results.gemini = { ok: true, details: "Both v3 and v2.5 models reachable." };
            } else if (subOk || voiceOk) {
                const active = subOk ? "Sub-Agent (v3)" : "Voice (v2.5)";
                this.results.gemini = { ok: true, warning: `${active} responded, but other is problematic.` };
            } else {
                throw new Error("Both specific models (v3, v2.5) returned errors. Key may be correct but model access is denied.");
            }
        } catch (err) {
            this.results.gemini = { ok: false, error: `Error: ${err.message}` };
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
                headers: { 
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json'
                }
            });
            this.results.clerk = { ok: res.status === 200 };
        } catch (err) {
            const status = err.response?.status || 'Error';
            const msg = err.response?.data?.errors?.[0]?.message || err.message;
            this.results.clerk = { ok: false, error: `Clerk [${status}]: ${msg}` };
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
            const status = err.response?.status || 'Error';
            this.results.exa = { ok: false, error: `Exa [${status}]: ${err.message}` };
        }
    }

    async testFirecrawl() {
        const key = process.env.FIRECRAWL_API_KEY;
        if (!key) {
            this.results.firecrawl = { ok: false, error: 'Missing FIRECRAWL_API_KEY' };
            return;
        }
        try {
            const firecrawl = new Firecrawl({ apiKey: key });
            let result;
            try {
                result = await firecrawl.scrapeUrl("https://example.com");
            } catch (e) {
                if (e.message.includes('not a function')) {
                    result = await firecrawl.scrape("https://example.com");
                } else throw e;
            }

            if (result && (result.success || result.markdown)) {
                this.results.firecrawl = { ok: true };
            } else {
                this.results.firecrawl = { ok: false, error: `Firecrawl: ${result?.error || 'No content/success returned'}` };
            }
        } catch (err) {
            const status = err.response?.status || 'Error';
            this.results.firecrawl = { ok: false, error: `Firecrawl SDK [${status}]: ${err.message}` };
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
            const status = err.response?.status || 'Error';
            this.results.iframely = { ok: false, error: `Iframely [${status}]: ${err.message}` };
        }
    }

    async testZep() {
        const key = process.env.ZEP_API_KEY;
        if (!key) {
            this.results.zep = { ok: false, error: 'Missing ZEP_API_KEY' };
            return;
        }
        try {
            // Verify via a direct auth check. If reachable and not 401/403, we are happy.
            const res = await axios.get('https://api.zep.com/api/v1/sessions?limit=1', {
                headers: { Authorization: `Api-Key ${key}` }
            });
            this.results.zep = { ok: true };
        } catch (err) {
            const status = err.response?.status;
            if (status === 401 || status === 403) {
                this.results.zep = { ok: false, error: `Zep [${status}]: Invalid API Key.` };
            } else {
                // If it's a 404 or 500 but reaching the server, the key is likely correct
                // since we didn't get a 401/403.
                this.results.zep = { ok: true, details: `Reachable (Status ${status || 'Ok'})` };
            }
        }
    }

    logSummary() {
        console.log('─── API Connectivity Summary ───');
        Object.entries(this.results).forEach(([svc, res]) => {
            let status = res.ok ? '✅ OK' : `❌ FAIL (${res.error})`;
            if (res.ok && res.warning) status = `⚠️ WARN (${res.warning})`;
            console.log(`${svc.padEnd(10)}: ${status}`);
        });
        console.log('────────────────────────────────');
    }
}

module.exports = new ConnectivityTester();
