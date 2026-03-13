/**
 * Final test: Google AI endpoint with AUDIO modality
 */
const WebSocket = require('ws');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-native-audio-latest';

const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_KEY}`;
console.log(`Testing: ${MODEL} on Google AI with AUDIO modality\n`);

const ws = new WebSocket(url);

ws.on('open', () => {
    console.log('✅ WebSocket CONNECTED');

    const setup = {
        setup: {
            model: `models/${MODEL}`,
            generation_config: {
                response_modalities: ["AUDIO"],
                speech_config: {
                    voice_config: {
                        prebuilt_voice_config: {
                            voice_name: "Puck"
                        }
                    }
                }
            },
            system_instruction: {
                parts: [{ text: "You are a helpful assistant named Friday." }]
            }
        }
    };

    console.log(`Sending SETUP (${JSON.stringify(setup).length} bytes)...`);
    ws.send(JSON.stringify(setup));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.setupComplete) {
        console.log('🎉 SETUP COMPLETE — Live API session is ready!');
        console.log('Full response:', JSON.stringify(msg));
        ws.close(1000, 'test done');
    } else {
        console.log('📨 Response:', JSON.stringify(msg).substring(0, 300));
    }
});

ws.on('close', (code, reason) => {
    console.log(`WebSocket closed: ${code} — ${reason.toString() || 'no reason'}`);
});

ws.on('error', (err) => {
    console.error('❌ Error:', err.message);
});
