// ═══════════════════════════════════════════════════════════════════════
// renderer/voice-client.js — Gemini Multimodal Live API Client (Jarvis Mode)
// Handles WebRTC audio capture, WebSocket connection, and state sync.
// ═══════════════════════════════════════════════════════════════════════

class VoiceClient {
    constructor() {
        this.ws = null;
        this.audioContext = null;
        this.playbackCtx = null;
        this.mediaStream = null;
        this.workletNode = null;
        this.isConnected = false;
        this.isInterrupted = false;
        this.audioSentThisTurn = false;
        this.isAwaitingUserInput = false;
        this.nextPlayTime = 0;
        this.activeSources = new Set();

        this.host = 'generativelanguage.googleapis.com';
        this.model = "models/gemini-2.5-flash-native-audio-preview-12-2025"; 
        this.apiVersion = "v1alpha";

        this.apiKey = null;
        this.skillsList = [];
        this.agentTools = [];

        window.friday.onSubAgentComplete((result) => this.handleSubAgentComplete(result));
        window.friday.onSubAgentUpdate((update) => this.handleSubAgentUpdate(update));

        this.latestVisionData = null; // Store background vision context

        // Listen for background vision pulses
        window.friday.onMessage((msg) => {
            if (msg.channel === 'state:vision' && msg.data?.data) {
                this.latestVisionData = msg.data.data;
            }
        });
    }

    async init() {
        try {
            this.apiKey = await window.friday.getGeminiKey();
            if (!this.apiKey) return false;
            this.skillsList = await window.friday.getSkills();
            this.agentTools = await window.friday.getVoiceTools();
            if (!this.playbackCtx) {
                this.playbackCtx = new AudioContext({ sampleRate: 24000 });
            }
            return true;
        } catch (e) {
            console.error('[VoiceClient] Init error:', e);
            return false;
        }
    }

    async start() {
        if (!this.apiKey) {
            const ok = await this.init();
            if (!ok) return;
        }
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            if (!this.isMicActive) await this.startMicrophone();
            return;
        }

        try {
            this.isConnected = false;
            this.nextPlayTime = 0;
            if (this.playbackCtx && this.playbackCtx.state === 'suspended') {
                await this.playbackCtx.resume();
            }

            const url = `wss://${this.host}/ws/google.ai.generativelanguage.${this.apiVersion}.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
            console.log('[VoiceClient] Connecting to:', url.split('?')[0] + '?key=***');
            this.ws = new WebSocket(url);
            this.ws.onopen = this.onWsOpen.bind(this);
            this.ws.onmessage = this.onWsMessage.bind(this);
            this.ws.onclose = this.onWsClose.bind(this);
            this.ws.onerror = this.onWsError.bind(this);
        } catch (e) {
            console.error('[VoiceClient] Start error:', e);
            window.friday.setState({ status: 'idle' });
        }
    }

    async _buildSystemInstruction() {
        const state = await window.friday.getState();
        const res = state.screenResolution ? `${state.screenResolution.width}x${state.screenResolution.height}` : 'adaptive';
        
        let basePrompt = '';
        try {
            // Try to load external prompt
            const result = await window.friday.fsReadFileStr('friday-program.md');
            if (result && result.success) {
                basePrompt = result.content;
            } else {
                console.warn('[VoiceClient] friday-program.md not found or error:', result?.error);
                basePrompt = `You are Friday, an autonomous Windows desktop and browser automation agent.`;
            }
        } catch (e) {
            console.warn('[VoiceClient] Failed to load friday-program.md, using default.');
            basePrompt = `You are Friday, an autonomous Windows desktop and browser automation agent.`;
        }

        return `${basePrompt}

## Current State
- Resolution: ${res}
- Mode: ACTIVE`;
    }

    async onWsOpen() {
        console.log('[VoiceClient] WebSocket connected (ReadyState:', this.ws.readyState, ')');
        this.isConnected = true;
        if (!this.ws) return;

        const instruction = await this._buildSystemInstruction();
        console.log('[VoiceClient] WS Open. Using Model:', this.model, 'API Version:', this.apiVersion);
        
        const setupMessage = {
            setup: {
                model: this.model,
                generation_config: {
                    response_modalities: ["audio"],
                    speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Puck" } } }
                },
                system_instruction: { parts: [{ text: instruction }] },
                tools: [{ function_declarations: this.agentTools }]
            }
        };

        if (this.ws.readyState === WebSocket.OPEN) {
            console.log('[VoiceClient] Sending setup message...');
            this.ws.send(JSON.stringify(setupMessage));
        }
    }

    handleInterruption() {
        if (!this.isConnected) return;
        if (Date.now() < this.suppressInterruptionUntil) return;
        this.isInterrupted = true;
        this.stopAllAudio();
        
        // Final polish: Explicitly clear the pipes by sending a small silence or just closing the turn if possible.
        // For Gemini Live, simply stopping the local stream and setting isInterrupted is usually enough,
        // but we ensure no stale frames from the worklet reach the WS.
    }

    stopAllAudio() {
        this.activeSources.forEach(s => { try { s.stop(); } catch(e){} });
        this.activeSources.clear();
        this.nextPlayTime = 0;
    }

    async startMicrophone() {
        if (this.isMicActive) return;
        try {
            this.isMicActive = true;
            this.isAwaitingUserInput = false;
            this.audioSentThisTurn = false;
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
            });
            this.audioContext = new AudioContext({ sampleRate: 16000 });
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            await this.audioContext.audioWorklet.addModule('audio-worklet.js');
            if (!this.audioContext) return; // Prevent race if stopped during await
            this.workletNode = new AudioWorkletNode(this.audioContext, 'recorder-worklet');

            this.workletNode.port.onmessage = (event) => {
                if (event.data.type === 'vad_speech') {
                    console.log('[VoiceClient] VAD Triggered (Speech detected)');
                    this.handleInterruption();
                } else if (event.data.type === 'audio_data' && this.ws?.readyState === WebSocket.OPEN) {
                    if (!this.isMicActive) return;
                    
                    // IF we just interrupted, ignore the tail of the previous stream
                    if (this.isInterrupted) {
                        // Stay interrupted until we receive a server turn completion or enough time passes
                        return; 
                    }

                    const base64 = this.arrayBufferToBase64(event.data.buffer);
                    this.audioSentThisTurn = true;
                    if (Math.random() < 0.05) console.log('[VoiceClient] Sending audio chunk (sample rate match)...');
                    this.ws.send(JSON.stringify({
                        realtime_input: { media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: base64 }] }
                    }));
                }
            };
            source.connect(this.workletNode);
            this.workletNode.connect(this.audioContext.destination);
            window.friday.setState({ status: 'listening' });
        } catch (e) {
            console.error('[VoiceClient] Mic error:', e);
            this.isMicActive = false;
        }
    }

    onWsClose(event) { 
        console.warn('[VoiceClient] WebSocket closed:', event.code, event.reason);
        this.isConnected = false; 
        window.friday.setState({ status: 'idle' }); 
    }
    onWsError(err) { 
        console.error('[VoiceClient] WebSocket error:', err);
        this.onWsClose({ code: 0, reason: 'Error' }); 
    }

    async onWsMessage(event) {
        try {
            const raw = (event.data instanceof Blob) ? await event.data.text() : event.data;
            const data = JSON.parse(raw);
            console.log('[VoiceClient] WS Message received:', Object.keys(data).join(', '));
            
            // Log raw server content for debugging
            if (data.serverContent) {
                console.log('[VoiceClient] Server Content received:', JSON.stringify(data.serverContent).substring(0, 500));
            } else if (data.toolCall) {
                console.log('[VoiceClient] Tool Call received:', data.toolCall.functionCalls?.map(f => f.name));
            } else if (data.setupComplete) {
                console.log('[VoiceClient] Setup complete acknowledged.');
                window.friday.getState().then(s => { 
                    if (s.voiceMode !== 'ptt') {
                        console.log('[VoiceClient] Starting microphone (handsfree/ambient)...');
                        this.startMicrophone(); 
                    }
                });
                return;
            } else {
                console.log('[VoiceClient] Other message:', Object.keys(data));
            }

            if (data.toolCall?.functionCalls) {
                for (const fc of data.toolCall.functionCalls) await this.handleFunctionCall(fc);
                return;
            }

            if (data.serverContent) {
                const turn = data.serverContent.modelTurn;
                if (turn?.parts) {
                    for (const p of turn.parts) {
                        console.log('[VoiceClient] Part received. Keys:', Object.keys(p).join(', '));
                        if (p.text && p.text.trim()) {
                            // Split thoughts from final answer
                            let content = p.text;
                            console.log('[VoiceClient] Model text parts received:', content.substring(0, 100));
                            
                            const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
                            
                            if (thinkMatch) {
                                const thought = thinkMatch[1].trim();
                                console.log('[VoiceClient] Model thought:', thought);
                                window.friday.addMessage('thinking', thought);
                                content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
                            }

                            if (content) {
                                console.log('[VoiceClient] Model saying:', content);
                                window.friday.addMessage('friday', content);
                                window.friday.setState({ status: 'speaking' });
                            }
                        }
                        if (p.inlineData?.data) {
                            console.log('[VoiceClient] Model speaking (audio chunk size:', p.inlineData.data.length, ')');
                            window.friday.setState({ status: 'speaking' });
                            this.playAudioChunk(p.inlineData.data);
                        }
                    }
                }
                if (data.serverContent.turnComplete) {
                    this.isInterrupted = false;
                    this.isAwaitingUserInput = true;
                    window.friday.getState().then(s => {
                        if (s.voiceMode === 'handsfree') {
                            const delay = Math.max(100, (this.nextPlayTime - this.playbackCtx.currentTime) * 1000 + 150);
                            setTimeout(() => { if (this.ws?.readyState === WebSocket.OPEN) this.startMicrophone(); }, delay);
                        } else {
                            window.friday.setState({ status: 'idle' });
                        }
                    });
                }
            }
        } catch (e) { console.error('[VoiceClient] Message error:', e); }
    }

    async handleFunctionCall(call) {
        console.log('[VoiceClient] Tool Call:', call.name);
        window.friday.setState({ status: 'working' });
        window.friday.addMessage('action', `🔧 ${call.name} (${JSON.stringify(call.args || {}).substring(0, 100)})`);

        let response = { success: false, error: 'Unknown function' };
        try {
            if (call.name === 'navigate_browser') {
                response = { success: await window.friday.browser.navigate(call.args.url) };
            } else if (call.name === 'read_browser_dom') {
                response = await window.friday.browser.getDOM();
            } else if (call.name === 'evaluate_browser_js') {
                response = { result: await window.friday.browser.evaluate(call.args.script) };
            } else if (call.name === 'web_click') {
                response = await window.friday.browser.click(call.args.selector);
            } else if (call.name === 'web_type') {
                response = await window.friday.browser.type(call.args.selector, call.args.text);
            } else if (call.name === 'web_screenshot') {
                const b64 = await window.friday.browser.screenshot();
                if (b64) {
                    this.ws.send(JSON.stringify({
                        client_content: { turns: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: b64 } }, { text: "Here is the screenshot." }] }], turn_complete: true }
                    }));
                    response = { success: true };
                }
                window.friday.addMessage('result', '📸 Browser Screenshot', b64);
            } else if (call.name === 'desktop_type_string') {
                response = await window.friday.sidecar('input.typeString', { text: call.args.text });
            } else if (call.name === 'desktop_send_chord') {
                response = await window.friday.sidecar('input.sendChord', { keys: call.args.chord });
            } else if (call.name === 'desktop_click_at') {
                response = await window.friday.sidecar('input.clickAt', { x: call.args.x, y: call.args.y });
            } else if (call.name === 'fs_list_directory') {
                response = await window.friday.fsListDirectory(call.args.path);
            } else if (call.name === 'fs_read_file') {
                response = await window.friday.fsReadFileStr(call.args.path);
            } else if (call.name === 'fs_write_file') {
                response = await window.friday.fsWriteFileStr(call.args.path, call.args.content);
            } else if (call.name === 'web_search') {
                response = await window.friday.webSearch(call.args.query);
            } else if (call.name === 'silent_action') {
                window.friday.addMessage('action', `🤫 Silent Action: ${call.args.action}`);
                response = { success: true };
            } else if (call.name === 'take_screenshot') {
                const s = await window.friday.takeScreenshot();
                if (s?.data) {
                    this.ws.send(JSON.stringify({
                        client_content: { turns: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: s.data } }, { text: "Full screen screenshot." }] }], turn_complete: true }
                    }));
                    response = { success: true };
                }
                window.friday.addMessage('result', '📸 Screenshot captured', s?.data);
            } else if (call.name === 'delegate_task') {
                response = await window.friday.delegateTask(call.args.taskDescription);
            } else if (call.name === 'browse_visual') {
                response = await window.friday.browseVisual(call.args.taskDescription);
            }
        } catch (err) {
            response = { success: false, error: err.message };
        }

        if (this.ws?.readyState === WebSocket.OPEN) {
            const resMsg = JSON.stringify(response);
            if (resMsg.length > 30000) {
                this.ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ name: call.name, id: call.id, response: { status: 'streaming' } }] } }));
                this.sendChunkedText(`[RAW OUTPUT]: ${resMsg}`);
            } else {
                this.ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ name: call.name, id: call.id, response }] } }));
            }
        }
    }

    sendChunkedText(text) {
        const CHUNK_LIMIT = 30000; // Safe byte limit
        const encoder = new TextEncoder();
        const fullBytes = encoder.encode(text);
        
        for (let i = 0; i < fullBytes.length; i += CHUNK_LIMIT) {
            const chunk = fullBytes.slice(i, i + CHUNK_LIMIT);
            const isLast = (i + CHUNK_LIMIT >= fullBytes.length);
            this.ws.send(JSON.stringify({
                client_content: { 
                    turns: [{ role: "user", parts: [{ text: new TextDecoder().decode(chunk) }] }], 
                    turn_complete: isLast 
                }
            }));
        }
    }

    playAudioChunk(b64) {
        try {
            if (!this.playbackCtx) {
                console.warn('[VoiceClient] No playbackCtx for audio chunk');
                return;
            }
            if (this.isInterrupted) {
                console.log('[VoiceClient] Interrupted, skipping audio chunk');
                return;
            }

            const binaryString = atob(b64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            
            // Ensure alignment for Int16Array
            const int16 = new Int16Array(bytes.buffer.slice(0, bytes.length - (bytes.length % 2)));
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < float32.length; i++) float32[i] = int16[i] / 32768.0;
            
            const buf = this.playbackCtx.createBuffer(1, float32.length, 24000);
            buf.getChannelData(0).set(float32);
            
            const src = this.playbackCtx.createBufferSource();
            src.buffer = buf; src.connect(this.playbackCtx.destination);
            this.activeSources.add(src);
            src.onended = () => this.activeSources.delete(src);
            
            const now = this.playbackCtx.currentTime;
            this.nextPlayTime = Math.max(this.nextPlayTime, now + 0.02);
            if (Math.random() < 0.1) console.log(`[VoiceClient] Playing chunk at ${this.nextPlayTime.toFixed(3)}s (duration: ${buf.duration.toFixed(3)}s)`);
            src.start(this.nextPlayTime);
            this.nextPlayTime += buf.duration;
            
            if (this.isAwaitingUserInput) {
                this.suppressInterruptionUntil = Date.now() + 300;
                this.isAwaitingUserInput = false;
            }
        } catch (e) {
            console.error('[VoiceClient] playAudioChunk error:', e);
        }
    }

    handleSubAgentUpdate(u) {
        if (u.type === 'thought') window.friday.addMessage('thinking', `🤖 ${u.content}`);
        else if (u.type === 'tool') window.friday.addMessage('action', `🔨 ${u.name}`);
    }

    handleSubAgentComplete(r) {
        window.friday.addMessage('result', r.error ? `❌ Sub-agent failed` : `✅ Sub-agent finished`);
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.sendChunkedText(`[SYSTEM] Background task finished: ${r.result || r.error}`);
        }
    }

    stopMicrophone() {
        this.isMicActive = false;
        if (this.workletNode) { this.workletNode.disconnect(); this.workletNode = null; }
        if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
        if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
    }

    stop() {
        this.stopMicrophone(); // Always try to stop mic
        this.isConnected = false;
        if (this.ws) {
            try { this.ws.close(); } catch(e){}
            this.ws = null;
        }
        window.friday.setState({ status: 'idle' });
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        return btoa(binary);
    }
}

window.VoiceClient = new VoiceClient();
