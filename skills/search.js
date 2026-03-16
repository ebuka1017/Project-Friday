// skills/search.js — Advanced Web Research Skills
const searchTools = require('../electron/search-tools');

module.exports = {
    web_search: {
        definition: {
            name: "web_search",
            description: "Search the web for real-time information. Returns a list of titles and URLs.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The search query." }
                },
                required: ["query"]
            }
        },
        execute: async (args) => {
            return await searchTools.webSearch(args.query);
        }
    },

    web_deepdive: {
        definition: {
            name: "web_deepdive",
            description: "Scrape a specific URL into clean Markdown for deep analysis.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string" }
                },
                required: ["url"]
            }
        },
        execute: async (args) => {
            return await searchTools.webDeepdive(args.url);
        }
    }
};
