const WebSocket = require('ws');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const HOST = 'generativelanguage.googleapis.com';

const agentTools = [
    { name: "navigate_browser", description: "Go to a URL. Must be in allowlist.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
    { name: "read_browser_dom", description: "Read page content (title, URL, text).", parameters: { type: "object", properties: {} } },
    { name: "web_click", description: "Click an element on the webpage (CSS selector or name).", parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
    { name: "web_type", description: "Type text into an input field on the webpage.", parameters: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } }, required: ["selector", "text"] } },
    { name: "open_default_browser", description: "Open URL in system browser.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
    { name: "desktop_type_string", description: "Type text into focused app.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    { name: "desktop_send_chord", description: "Send shortcut (e.g. 'Ctrl+C').", parameters: { type: "object", properties: { chord: { type: "string" } }, required: ["chord"] } },
    { name: "fs_list_directory", description: "List contents of a directory on disk.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "fs_read_file", description: "Read text from a local file.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "show_notification", description: "Show a native notification to the user.", parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"] } },
    { name: "get_system_info", description: "Get CPU, RAM, and OS details.", parameters: { type: "object", properties: {} } },
    { name: "take_screenshot", description: "Capture screen to see state.", parameters: { type: "object", properties: {} } },
    { name: "delegate_task", description: "Spawn sub-agent for complex tasks.", parameters: { type: "object", properties: { taskDescription: { type: "string" } }, required: ["taskDescription"] } },
    { name: "browse_visual", description: "Delegate to visual assistant.", parameters: { type: "object", properties: { taskDescription: { type: "string" } }, required: ["taskDescription"] } }
];

const payload = {
    setup: {
        model: MODEL,
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
            parts: [{ text: "Identity: Friday. Mission: Assist." }]
        },
        tools: [
            { google_search: {} },
            { function_declarations: agentTools }
        ]
    }
};

async function runTest() {
    const url = `wss://${HOST}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    const ws = new WebSocket(url);

    ws.on('open', () => {
        console.log('Testing 14 Tools + Google Search...');
        ws.send(JSON.stringify(payload));
    });

    ws.on('message', (data) => {
        console.log('Received:', data.toString());
        if (JSON.parse(data.toString()).setupComplete) {
            console.log('SUCCESS!');
            ws.close();
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`Closed code: ${code}, Reason: ${reason}`);
    });

    setTimeout(() => { ws.close(); }, 5000);
}

runTest();
