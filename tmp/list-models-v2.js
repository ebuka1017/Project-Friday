const axios = require('axios');
require('dotenv').config();

async function main() {
    const key = process.env.GEMINI_API_KEY;
    try {
        const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const models = response.data.models;
        console.log('Available Models:');
        models.forEach(m => console.log(`- ${m.name}: ${m.displayName}`));
    } catch (e) {
        console.error('Error:', e.response?.data || e.message);
    }
}
main();
