const WebSocket = require('ws');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const HOST = 'generativelanguage.googleapis.com';

// TEST MATRIX
const tests = [
    { name: 'v1alpha + setup + snake', url: `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`, payload: { setup: { model: MODEL } } },
    { name: 'v1beta + setup + snake', url: `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`, payload: { setup: { model: MODEL } } },
    { name: 'v1beta + config + camel', url: `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`, payload: { config: { model: MODEL } } },
    { name: 'v1beta + setup + snake + voice', url: `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`, payload: { setup: { model: MODEL, generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Puck" } } } } } } }
];

async function runTest(test) {
    return new Promise((resolve) => {
        console.log(`\n--- Testing: ${test.name} ---`);
        const ws = new WebSocket(test.url);
        let completed = false;

        ws.on('open', () => {
            console.log('Connected. Sending payload...');
            ws.send(JSON.stringify(test.payload));
        });

        ws.on('message', (data) => {
            console.log('Received:', data.toString());
            const msg = JSON.parse(data.toString());
            if (msg.setupComplete) {
                console.log('SUCCESS: Setup complete!');
                ws.close();
                completed = true;
                resolve(true);
            }
        });

        ws.on('close', (code, reason) => {
            if (!completed) {
                console.log(`FAILED: Closed with code ${code}. Reason: ${reason}`);
                resolve(false);
            }
        });

        ws.on('error', (err) => {
            console.log('ERROR:', err.message);
            resolve(false);
        });

        setTimeout(() => {
            if (!completed) {
                console.log('TIMEOUT');
                ws.close();
                resolve(false);
            }
        }, 5000);
    });
}

async function run() {
    for (const test of tests) {
        await runTest(test);
    }
}

run();
