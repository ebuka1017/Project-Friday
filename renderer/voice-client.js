// ═══════════════════════════════════════════════════════════════════════
// renderer/voice-client.js — Gemini Multimodal Live API Client
// Handles WebRTC audio capture, WebSocket connection, and state sync.
// ═══════════════════════════════════════════════════════════════════════

class VoiceClient {
    constructor() {
        this.ws = null;
        this.audioContext = null;
        this.playbackCtx = null; // Separate context for playback at 24kHz
        this.mediaStream = null;
        this.workletNode = null;
        this.isConnected = false;

        // Scheduled audio playback queue (fixes crackling)
        this.nextPlayTime = 0;

        // Gemini Live API parameters
        this.host = 'generativelanguage.googleapis.com';
        this.baseModel = 'models/gemini-2.0-flash-exp'; // Fallback
        this.model = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

        // Listen for background task completions
        window.friday.onSubAgentComplete((result) => this.handleSubAgentComplete(result));

        // Setup state module bindings (called after init)
        this.apiKey = null;
        this.skillsList = [];
    }

    async init() {
        try {
            this.apiKey = await window.friday.getGeminiKey();
            if (!this.apiKey) {
                console.error('[VoiceClient] GEMINI_API_KEY missing from environment.');
                window.friday.addMessage('error', 'Error: GEMINI_API_KEY is missing from .env');
                return false;
            }

            // Pre-load skills list for system instruction
            try {
                this.skillsList = await window.friday.getSkills();
                console.log(`[VoiceClient] Loaded ${this.skillsList.length} skills`);
            } catch (e) {
                console.warn('[VoiceClient] Could not load skills:', e);
            }

            // Pre-initialize playback AudioContext for faster first audio
            if (!this.playbackCtx) {
                this.playbackCtx = new AudioContext({ sampleRate: 24000 });
                console.log('[VoiceClient] Playback AudioContext pre-initialized');
            }

            console.log('[VoiceClient] Initialized successfully');
            return true;
        } catch (e) {
            console.error('[VoiceClient] Failed to initialize:', e);
            return false;
        }
    }

    async start() {
        if (!this.apiKey) {
            const ok = await this.init();
            if (!ok) return;
        }

        if (this.isConnected) return;

        try {
            // Reset audio queue
            this.nextPlayTime = 0;

            // Ensure playback context is ready
            if (this.playbackCtx && this.playbackCtx.state === 'suspended') {
                await this.playbackCtx.resume();
            }

            // 1. Establish WebSocket Connection
            const url = `wss://${this.host}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
            this.ws = new WebSocket(url);

            this.ws.onopen = this.onWsOpen.bind(this);
            this.ws.onmessage = this.onWsMessage.bind(this);
            this.ws.onclose = this.onWsClose.bind(this);
            this.ws.onerror = this.onWsError.bind(this);

        } catch (e) {
            console.error('[VoiceClient] Failed to start:', e);
            window.friday.setState({ status: 'idle' });
        }
    }

    _buildSystemInstruction() {
        const skillsText = this.skillsList.length > 0
            ? `\n\nYou have access to the following skill categories that you can use for reference:\n${this.skillsList.map(s => `- ${s}`).join('\n')}`
            : '';

        return `Your name is Friday. You are an AI desktop assistant on a Windows PC. Be concise and conversational.

You have these tools:
- Desktop: desktop_type_string, desktop_send_chord, desktop_click_at, desktop_find_element, desktop_dump_tree
- Browser: navigate_browser, read_browser_dom, evaluate_browser_js, open_default_browser
- Vision: take_screenshot (captures the screen so you can see what's happening)
- Async: delegate_task (spawn a background agent to do work for you asynchronously)

CRITICAL RULES:
- NEVER claim a tool succeeded unless you received a success response.
- If a tool call was cancelled or returned an error, tell the user it failed and why.
- After using a tool, use take_screenshot to verify the result if unsure.
- If the browser extension is not connected, tell the user to open Chrome with the Friday extension.
- Be honest about failures. Do not hallucinate results.${skillsText}`;
    }

    async onWsOpen() {
        console.log('[VoiceClient] WebSocket connected');
        this.isConnected = true;

        // Send initial setup message with system instruction + tools
        const setupMessage = {
            setup: {
                model: this.model,
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Puck"
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{ text: this._buildSystemInstruction() }]
                },
                tools: [
                    {
                        functionDeclarations: [
                            // ── Browser Tools ──
                            {
                                name: "navigate_browser",
                                description: "Navigate the browser to a URL. The URL must be in the user's allowlist.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        url: { type: "STRING", description: "The full URL to navigate to" }
                                    },
                                    required: ["url"]
                                }
                            },
                            {
                                name: "read_browser_dom",
                                description: "Read the current browser page title, URL, and DOM text. Useful for understanding what's on the screen.",
                                parameters: { type: "OBJECT", properties: {} }
                            },
                            {
                                name: "evaluate_browser_js",
                                description: "Execute JavaScript in the active browser tab. Use for clicking, scrolling, extracting data.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        script: { type: "STRING", description: "JavaScript code to execute" }
                                    },
                                    required: ["script"]
                                }
                            },
                            {
                                name: "open_default_browser",
                                description: "Open a URL in the user's default system browser.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        url: { type: "STRING", description: "The URL to open" }
                                    },
                                    required: ["url"]
                                }
                            },
                            // ── Desktop Control Tools ──
                            {
                                name: "desktop_type_string",
                                description: "Type a string into the currently focused application on the desktop.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        text: { type: "STRING", description: "The text to type" }
                                    },
                                    required: ["text"]
                                }
                            },
                            {
                                name: "desktop_send_chord",
                                description: "Send a keyboard shortcut. Examples: 'Ctrl+C', 'Alt+Tab', 'Win+E', 'Enter', 'Ctrl+Shift+Esc'.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        chord: { type: "STRING", description: "The keyboard shortcut to send" }
                                    },
                                    required: ["chord"]
                                }
                            },
                            {
                                name: "desktop_click_at",
                                description: "Click at specific screen coordinates.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        x: { type: "NUMBER", description: "X coordinate" },
                                        y: { type: "NUMBER", description: "Y coordinate" }
                                    },
                                    required: ["x", "y"]
                                }
                            },
                            {
                                name: "desktop_find_element",
                                description: "Find a UI element by name using Windows UI Automation. Returns element info if found.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        name: { type: "STRING", description: "The name or text of the element to find" },
                                        controlType: { type: "STRING", description: "Optional: Button, Edit, Text, Window, etc." }
                                    },
                                    required: ["name"]
                                }
                            },
                            {
                                name: "desktop_dump_tree",
                                description: "Get a tree of UI elements of the currently focused window. Shows element names, types, and coordinates. Useful for understanding what's on screen before interacting.",
                                parameters: { type: "OBJECT", properties: {} }
                            },
                            {
                                name: "take_screenshot",
                                description: "Captures a screenshot of the entire screen. Use this to verify the result of a tool call or to see what the user sees. Returns a JPEG image.",
                                parameters: { type: "OBJECT", properties: {} }
                            },
                            {
                                name: "delegate_task",
                                description: "Spawn a background sub-agent to complete a long-running or complex task asynchronously. The sub-agent has access to all your desktop and browser tools. This tool returns immediately with a jobId so you can keep talking to the user. You will be notified when it finishes.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: {
                                        taskDescription: { type: "STRING", description: "Detailed, step-by-step instructions for what the background agent should do. E.g. 'Navigate to gmail.com, find the compose button...'" }
                                    },
                                    required: ["taskDescription"]
                                }
                            }
                        ]
                    }
                ]
            }
        };
        this.ws.send(JSON.stringify(setupMessage));

        // 2. Start Microphone Capture
        await this.startMicrophone();
    }

    async startMicrophone() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });

            this.audioContext = new AudioContext({ sampleRate: 16000 });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);

            await this.audioContext.audioWorklet.addModule('audio-worklet.js');
            this.workletNode = new AudioWorkletNode(this.audioContext, 'recorder-worklet');

            this.workletNode.port.onmessage = (event) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const base64 = this.arrayBufferToBase64(event.data);
                    const msg = {
                        realtimeInput: {
                            mediaChunks: [{
                                mimeType: "audio/pcm;rate=16000",
                                data: base64
                            }]
                        }
                    };
                    this.ws.send(JSON.stringify(msg));
                }
            };

            source.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);

            window.friday.setState({ status: 'listening' });
            console.log('[VoiceClient] Microphone capture started');

        } catch (e) {
            console.error('[VoiceClient] Mic error:', e);
            window.friday.addMessage('error', `Microphone failed: ${e.message}`);
            window.friday.setState({ status: 'idle' });
        }
    }

    onWsClose(event) {
        console.log('[VoiceClient] WebSocket closed:', event.code);
        this.isConnected = false;
        if (event.code !== 1000) {
            window.friday.addMessage('error', `Voice connection closed unexpectedly (code: ${event.code})`);
        }
    }

    onWsError(event) {
        console.error('[VoiceClient] WebSocket error:', event);
        window.friday.addMessage('error', 'Voice connection error');
        window.friday.setState({ status: 'idle' });
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
        }
    }

    async onWsMessage(event) {
        try {
            // Gemini Live sends messages as Blob objects, not text strings.
            let raw;
            if (event.data instanceof Blob) {
                raw = await event.data.text();
            } else {
                raw = event.data;
            }

            const data = JSON.parse(raw);

            // Log setup completion
            if (data.setupComplete) {
                console.log('[VoiceClient] Setup complete, session ready');
                return;
            }

            // ── Handle Tool Calls (top-level message from Gemini Live) ──
            if (data.toolCall && data.toolCall.functionCalls) {
                console.log('[VoiceClient] Received toolCall with', data.toolCall.functionCalls.length, 'functions');
                for (const fc of data.toolCall.functionCalls) {
                    await this.handleFunctionCall(fc);
                }
                return;
            }

            // ── Handle Tool Call Cancellation ──
            if (data.toolCallCancellation) {
                console.log('[VoiceClient] Tool call cancelled:', data.toolCallCancellation.ids);
                window.friday.addMessage('error', `Tool call cancelled by model`);
                return;
            }

            if (data.serverContent) {
                const modelTurn = data.serverContent.modelTurn;
                if (modelTurn && modelTurn.parts) {
                    for (const part of modelTurn.parts) {
                        if (part.text) {
                            console.log('[VoiceClient] Agent text:', part.text.substring(0, 100));
                            window.friday.setState({ status: 'speaking' });
                            window.friday.addMessage('thinking', part.text);
                        }

                        if (part.inlineData && part.inlineData.data) {
                            window.friday.setState({ status: 'speaking' });
                            this.playAudioChunk(part.inlineData.data);
                        }

                        // Also handle function calls inside serverContent (fallback)
                        if (part.functionCall) {
                            await this.handleFunctionCall(part.functionCall);
                        }
                    }
                }

                if (data.serverContent.turnComplete) {
                    console.log('[VoiceClient] Turn complete');
                    window.friday.getState().then(state => {
                        if (state.voiceMode === 'handsfree') {
                            console.log('[VoiceClient] Resuming hands-free listening...');
                            window.friday.setState({ status: 'listening' });
                        } else {
                            window.friday.setState({ status: 'idle' });
                        }
                    });
                }
            }
        } catch (e) {
            console.error('[VoiceClient] Message parse error:', e);
        }
    }

    async handleFunctionCall(call) {
        console.log('[VoiceClient] Agent called function:', call.name, call.args);
        window.friday.setState({ status: 'working' });
        window.friday.addMessage('action', `🔧 ${call.name}(${JSON.stringify(call.args || {}).substring(0, 100)})`);

        let response = { success: false, error: 'Unknown function' };

        try {
            // ── Browser Tools ──
            if (call.name === 'navigate_browser') {
                const url = call.args.url;
                const state = await window.friday.getState();
                let allowed = state.allowAllDomains;

                if (!allowed && url) {
                    try {
                        const hostname = new URL(url).hostname.toLowerCase();
                        allowed = state.allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
                    } catch (e) { /* invalid URL */ }
                }

                if (!allowed) {
                    response = { success: false, error: `Domain not in allowlist. User must add it in Browser settings. URL: ${url}` };
                    window.friday.addMessage('error', `Blocked: ${url} not in allowlist`);
                } else {
                    const res = await window.friday.browser.navigate(url);
                    response = { success: res || false };
                    window.friday.addMessage('result', `✅ Navigated to ${url}`);
                }
            }
            else if (call.name === 'read_browser_dom') {
                const dom = await window.friday.browser.getDOM();
                response = dom || { error: 'Failed to read DOM (Is extension connected?)' };
                window.friday.addMessage('result', `📄 Read DOM (${JSON.stringify(response).length} chars)`);
            }
            else if (call.name === 'evaluate_browser_js') {
                const res = await window.friday.browser.evaluate(call.args.script);
                response = { result: res };
                window.friday.addMessage('result', `⚡ JS executed`);
            }
            else if (call.name === 'open_default_browser') {
                const url = call.args.url;
                await window.friday.openExternal(url);
                // Auto-ping extension after a delay to give browser time to start
                setTimeout(async () => {
                    const ping = await window.friday.browserPing();
                    console.log('[VoiceClient] Extension ping after browser open:', ping);
                }, 3000);
                response = { success: true, message: `Opened ${url} in default browser` };
                window.friday.addMessage('result', `🌐 Opened ${url} in browser`);
            }
            // ── Desktop Control Tools ──
            else if (call.name === 'desktop_type_string') {
                const res = await window.friday.sidecar('input.typeString', { text: call.args.text });
                response = res || { success: true };
                window.friday.addMessage('result', `⌨️ Typed "${call.args.text.substring(0, 50)}"`);
            }
            else if (call.name === 'desktop_send_chord') {
                const res = await window.friday.sidecar('input.sendChord', { keys: call.args.chord });
                response = res || { success: true };
                window.friday.addMessage('result', `🎹 Sent ${call.args.chord}`);
            }
            else if (call.name === 'desktop_click_at') {
                const res = await window.friday.sidecar('input.clickAt', { x: call.args.x, y: call.args.y });
                response = res || { success: true };
                window.friday.addMessage('result', `🖱️ Clicked at (${call.args.x}, ${call.args.y})`);
            }
            else if (call.name === 'desktop_find_element') {
                const params = { name: call.args.name };
                if (call.args.controlType) params.controlType = call.args.controlType;
                const res = await window.friday.sidecar('uia.findElement', params);
                response = res || { error: 'Element not found' };
                window.friday.addMessage('result', `🔍 FindElement: ${call.args.name}`);
            }
            else if (call.name === 'desktop_dump_tree') {
                const res = await window.friday.sidecar('uia.dumpTree', {});
                response = res || { error: 'Failed to dump UI tree' };
                window.friday.addMessage('result', `🌳 UI tree dumped`);
            }
            else if (call.name === 'take_screenshot') {
                const screenshot = await window.friday.takeScreenshot();
                if (screenshot && screenshot.data) {
                    // Send screenshot as inline image to Gemini
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        const imgMsg = {
                            clientContent: {
                                turns: [{
                                    role: "user",
                                    parts: [{
                                        inlineData: {
                                            mimeType: screenshot.mimeType,
                                            data: screenshot.data
                                        }
                                    }, {
                                        text: "Here is the current screenshot of the screen."
                                    }]
                                }],
                                turnComplete: true
                            }
                        };
                        this.ws.send(JSON.stringify(imgMsg));
                    }
                    response = { success: true, message: 'Screenshot captured and sent for analysis' };
                    window.friday.addMessage('result', `📸 Screenshot captured`);
                } else {
                    response = { error: screenshot?.error || 'Failed to capture screenshot' };
                    window.friday.addMessage('error', `❌ Screenshot failed`);
                }
            }
            else if (call.name === 'delegate_task') {
                const res = await window.friday.delegateTask(call.args.taskDescription);
                response = { success: true, jobId: res.jobId, message: `Task delegated successfully. Job ID: ${res.jobId}. You will be notified when it completes.` };
                window.friday.addMessage('result', `🤖 Delegated task [${res.jobId}]: ${call.args.taskDescription.substring(0, 50)}...`);
            }
        } catch (err) {
            console.error(`[VoiceClient] Tool error (${call.name}):`, err);
            response = { success: false, error: err.message };
            window.friday.addMessage('error', `❌ ${call.name} failed: ${err.message}`);
        }

        // Send function response back to Gemini (toolResponse format for Live API)
        const functionResponseMsg = {
            toolResponse: {
                functionResponses: [{
                    name: call.name,
                    id: call.id,
                    response: response
                }]
            }
        };

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(functionResponseMsg));
            console.log('[VoiceClient] Sent function response');
        }
    }

    // Called when a sub-agent spawned by delegate_task finishes
    handleSubAgentComplete(result) {
        console.log('[VoiceClient] Sub-agent finished:', result);
        window.friday.addMessage('result', `🤖 Sub-agent ${result.jobId} finished.`);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const sysMsg = {
                clientContent: {
                    turns: [{
                        role: "user",
                        parts: [{
                            text: `[SYSTEM NOTIFICATION] Background task ${result.jobId} completed. Result: ${result.result || result.error}`
                        }]
                    }],
                    turnComplete: true
                }
            };
            this.ws.send(JSON.stringify(sysMsg));
        }
    }

    playAudioChunk(base64Data) {
        try {
            if (!this.playbackCtx) return;

            // Convert base64 to PCM samples
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const int16Array = new Int16Array(bytes.buffer);
            const float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }

            const audioBuffer = this.playbackCtx.createBuffer(1, float32Array.length, 24000);
            audioBuffer.getChannelData(0).set(float32Array);

            const source = this.playbackCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.playbackCtx.destination);

            // Schedule chunks back-to-back to prevent gaps/crackling
            const now = this.playbackCtx.currentTime;
            if (this.nextPlayTime < now) {
                this.nextPlayTime = now + 0.02; // Small buffer to prevent underrun
            }
            source.start(this.nextPlayTime);
            this.nextPlayTime += audioBuffer.duration;

        } catch (e) {
            console.error('[VoiceClient] Playback error:', e);
        }
    }

    stop() {
        this.isConnected = false;

        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ clientContent: { turnComplete: true } }));
                this.ws.close();
            }
            this.ws = null;
        }

        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Don't close playbackCtx — keep it alive for faster next start
        this.nextPlayTime = 0;

        window.friday.getState().then(state => {
            if (state && state.status !== 'idle') {
                window.friday.setState({ status: 'idle' });
            }
        });
        console.log('[VoiceClient] Stopped');
    }

    // Helper: ArrayBuffer to Base64
    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}

// Attach to global scope for the main app UI to use
window.VoiceClient = new VoiceClient();
