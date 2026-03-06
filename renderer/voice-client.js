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
        this.agentTools = [];
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

            // Load dynamic tool registry
            try {
                this.agentTools = await window.friday.getAgentTools();
                console.log(`[VoiceClient] Loaded ${this.agentTools.length} tools from registry`);
            } catch (e) {
                console.error('[VoiceClient] Failed to load tool registry:', e);
                return false;
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
                        functionDeclarations: this.agentTools
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
            else if (call.name === 'browser_back') {
                const res = await window.friday.browser.goBack();
                response = { success: res || false };
                window.friday.addMessage('result', `🔙 Navigated Back`);
            }
            else if (call.name === 'browser_forward') {
                const res = await window.friday.browser.goForward();
                response = { success: res || false };
                window.friday.addMessage('result', `🔜 Navigated Forward`);
            }
            else if (call.name === 'web_click') {
                const res = await window.friday.browser.click(call.args.target);
                response = { success: res || false };
                if (res && res.error) response = res;
                window.friday.addMessage('result', `🖱️ Web Click: ${call.args.target.substring(0, 20)}`);
            }
            else if (call.name === 'web_type') {
                const res = await window.friday.browser.type(call.args.target, call.args.text);
                response = { success: res || false };
                if (res && res.error) response = res;
                window.friday.addMessage('result', `⌨️ Web Type: ${call.args.text.substring(0, 15)}`);
            }
            else if (call.name === 'web_screenshot') {
                if (call.args.annotated) {
                    await window.friday.browser.annotate();
                    await new Promise(r => setTimeout(r, 200)); // allow DOM to paint labels
                }
                const b64Data = await window.friday.browser.screenshot();
                if (call.args.annotated) {
                    await window.friday.browser.clearAnnotations();
                }

                if (b64Data) {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        const imgMsg = {
                            clientContent: {
                                turns: [{
                                    role: "user",
                                    parts: [{
                                        inlineData: { mimeType: "image/jpeg", data: b64Data }
                                    }, {
                                        text: call.args.annotated ? "Here is the annotated browser screenshot. Find the number corresponding to your target and reply with a web_click or web_type using the exact 'x,y' coordinates of the element center." : "Here is the browser screenshot."
                                    }]
                                }],
                                turnComplete: true
                            }
                        };
                        this.ws.send(JSON.stringify(imgMsg));
                        response = { success: true, message: "Browser screenshot sent to your vision." };
                    } else {
                        response = { error: "Voice connection not open to receive image." };
                    }
                } else {
                    response = { error: 'Failed to capture browser tab' };
                }
                window.friday.addMessage('result', call.args.annotated ? `📸 Annotated Web Screenshot taken` : `📸 Web Screenshot taken`);
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
            else if (call.name === 'process_list') {
                const res = await window.friday.sidecar('process.list', {});
                response = res || { error: 'Failed to list processes' };
                if (res && res.processes) window.friday.addMessage('result', `📋 Found ${res.processes.length} visible processes`);
            }
            else if (call.name === 'process_kill') {
                const res = await window.friday.sidecar('process.kill', { pid: call.args.pid });
                response = res || { error: 'Failed to kill process' };
                window.friday.addMessage('result', `💀 Terminated process PID ${call.args.pid}`);
            }
            else if (call.name === 'get_system_info') {
                const info = await window.friday.getSystemInfo();
                response = info || { error: 'Failed to get system info' };
                window.friday.addMessage('result', `🖥️ System Info gathered`);
            }
            else if (call.name === 'show_notification') {
                const res = await window.friday.showNotification(call.args.title, call.args.body);
                response = res || { success: true };
                window.friday.addMessage('result', `🔔 Notification: ${call.args.title}`);
            }
            else if (call.name === 'show_message_dialog') {
                const res = await window.friday.showMessageDialog(call.args);
                response = res || { error: 'Failed to show dialog' };
                window.friday.addMessage('result', `💬 Message Dialog shown`);
            }
            else if (call.name === 'http_request') {
                const res = await window.friday.httpRequest(call.args);
                response = res || { error: 'Failed to perform HTTP request' };
                window.friday.addMessage('result', `🌐 HTTP Request: ${call.args.method || 'GET'} ${call.args.url}`);
            }
            else if (call.name === 'get_user_profile') {
                const profile = await window.friday.getUserProfile();
                response = profile || { error: 'Failed to get user profile' };
                window.friday.addMessage('result', `👤 User Profile gathered`);
            }
            else if (call.name === 'web_search') {
                const res = await window.friday.webSearch(call.args.query);
                response = res || { error: 'Search failed' };
                window.friday.addMessage('result', `🔍 Searched: ${call.args.query}`);
            }
            else if (call.name === 'web_deepdive') {
                const res = await window.friday.webDeepdive(call.args.url);
                response = res || { error: 'Deep-dive failed' };
                window.friday.addMessage('result', `🌊 Deep-dive: ${call.args.url}`);
            }
            // ── Window Management Tools ──
            else if (call.name === 'window_list') {
                const res = await window.friday.sidecar('window.list', {});
                response = res || { error: 'Failed to list windows' };
                if (res && res.windows) window.friday.addMessage('result', `🪟 Found ${res.windows.length} windows`);
            }
            else if (call.name === 'window_focus') {
                const res = await window.friday.sidecar('window.focus', { handle: call.args.handle });
                response = res || { error: 'Failed to focus window' };
                window.friday.addMessage('result', `🎯 Focused window handle ${call.args.handle}`);
            }
            else if (call.name === 'window_close') {
                const res = await window.friday.sidecar('window.close', { handle: call.args.handle });
                response = res || { error: 'Failed to close window' };
                window.friday.addMessage('result', `❌ Closed window handle ${call.args.handle}`);
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
            // ── File System Tools ──
            else if (call.name === 'fs_list_directory') {
                const res = await window.friday.fsListDirectory(call.args.path);
                response = res;
                if (res.success) window.friday.addMessage('result', `📁 Listed directory: ${call.args.path.substring(0, 30)}`);
            }
            else if (call.name === 'fs_read_file') {
                const res = await window.friday.fsReadFileStr(call.args.path);
                response = res;
                if (res.success) window.friday.addMessage('result', `📄 Read file: ${call.args.path.substring(0, 30)}... (${res.content.length} chars)`);
            }
            else if (call.name === 'fs_write_file') {
                const res = await window.friday.fsWriteFileStr(call.args.path, call.args.content);
                response = res;
                if (res.success) window.friday.addMessage('result', `💾 Wrote file: ${call.args.path.substring(0, 30)}...`);
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
