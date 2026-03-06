const axios = require('axios');

/**
 * Performs a neural web search using the Exa.ai API.
 * @param {string} query - The search query.
 */
async function webSearch(query) {
    const apiKey = process.env.EXA_API_KEY;

    if (!apiKey) {
        return {
            error: "EXA_API_KEY not found in environment.",
            instructions: "No Exa API key is configured. Please inform the user to add 'EXA_API_KEY' to their .env file."
        };
    }

    try {
        const response = await axios.post('https://api.exa.ai/search', {
            query: query,
            useAutoprompt: true,
            numResults: 5
        }, {
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json'
            }
        });

        return {
            results: (response.data.results || []).map(res => ({
                title: res.title,
                url: res.url,
                score: res.score,
                publishedDate: res.publishedDate
            }))
        };
    } catch (err) {
        console.error('[Exa] Error:', err.response?.data || err.message);
        return { error: err.response?.data?.message || err.message };
    }
}

/**
 * Performs a deep-dive scrape of a URL using Firecrawl.
 * @param {string} url - The URL to scrape.
 */
async function webDeepdive(url) {
    const apiKey = process.env.FIRECRAWL_API_KEY;

    if (!apiKey) {
        return {
            error: "FIRECRAWL_API_KEY not found in environment.",
            instructions: "No Firecrawl API key is configured. Please inform the user to add 'FIRECRAWL_API_KEY' to their .env file."
        };
    }

    try {
        const response = await axios.post('https://api.firecrawl.dev/v1/scrape', {
            url: url,
            formats: ['markdown']
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data.success) {
            return {
                metadata: response.data.data.metadata,
                markdown: response.data.data.markdown.substring(0, 15000) // Caps to 15k chars for LLM context
            };
        } else {
            return { error: response.data.error || 'Scrape failed' };
        }
    } catch (err) {
        console.error('[Firecrawl] Error:', err.response?.data || err.message);
        return { error: err.response?.data?.error || err.message };
    }
}

module.exports = {
    webSearch,
    webDeepdive
};
