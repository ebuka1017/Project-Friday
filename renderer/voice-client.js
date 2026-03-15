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
        this.model = "models/gemini-2.0-flash-exp"; 
        this.apiVersion = "v1alpha";

        window.friday.onSubAgentComplete((result) => this.handleSubAgentComplete(result));
        window.friday.onSubAgentUpdate((update) => this.handleSubAgentUpdate(update));

        this.apiKey = null;
        this.skillsList = [];
        this.agentTools = [];
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
        return `# IDENTITY
You are Friday, an autonomous Windows desktop and browser automation agent.

# PROTOCOL (AMBIENT & ACTIVE)
You operate in two states:
1. AMBIENT: You are a silent co-listener. Stay QUIET unless the user says "Friday" or you hear an urgent task. Use 'silent_action' to log background work instead of speaking.
2. ACTIVE: You are in direct conversation. Respond briefly (2-3 sentences).

# DIRECT ACTION POLICY
- **AUTONOMY FIRST**: Execute tasks yourself using tools. Only delegate if >10 steps.
- **NO LAZY SEARCHING**: If a URL is known, use 'navigate_browser' directly.
- **TRANSPARENCY**: Use text for [PLAN], [ACTION], [RESULT] so the user can see your "Chain of Thought" in the HUD.

# CONTEXT
- Current Resolution: ${res}
- Operating as Friday, your Windows co-pilot.

# TOOLS
Registered tools: ${this.agentTools.map(t => t.name).join(', ')}.
NEVER hallucinate tools.`;
    }

    async onWsOpen() {
        console.log('[VoiceClient] WebSocket connected');
        this.isConnected = true;
        if (!this.ws) return;

        const instruction = await this._buildSystemInstruction();
        const setupMessage = {
            setup: {
                model: this.model,
                generation_config: {
                    response_modalities: ["AUDIO"],
                    speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Puck" } } }
                },
                proactivity: { proactive_audio: true },
                system_instruction: { parts: [{ text: instruction }] },
                tools: [{ functionDeclarations: this.agentTools }]
            }
        };

        if (this.ws.readyState === WebSocket.OPEN) {
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
            this.workletNode = new AudioWorkletNode(this.audioContext, 'recorder-worklet');

            this.workletNode.port.onmessage = (event) => {
                if (event.data.type === 'vad_speech') {
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

    onWsClose() { this.isConnected = false; window.friday.setState({ status: 'idle' }); }
    onWsError() { this.onWsClose(); }

    async onWsMessage(event) {
        try {
            const raw = (event.data instanceof Blob) ? await event.data.text() : event.data;
            const data = JSON.parse(raw);

            if (data.setupComplete) {
                window.friday.getState().then(s => { if (s.voiceMode !== 'ptt') this.startMicrophone(); });
                return;
            }

            if (data.toolCall?.functionCalls) {
                for (const fc of data.toolCall.functionCalls) await this.handleFunctionCall(fc);
                return;
            }

            if (data.serverContent) {
                const turn = data.serverContent.modelTurn;
                if (turn?.parts) {
                    for (const p of turn.parts) {
                        if (p.text && p.text.trim()) {
                            const isThought = p.text.match(/\[PLAN\]|\[ACTION\]|\[RESULT\]/);
                            // Use 'thinking' for internal reasoning, 'friday' for spoken response
                            window.friday.addMessage(isThought ? 'thinking' : 'friday', p.text);
                            window.friday.setState({ status: 'speaking' });
                        }
                        if (p.inlineData?.data) {
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
            if (!this.playbackCtx || this.isInterrupted) return;
            const bytes = new Uint8Array(atob(b64).split("").map(c => c.charCodeAt(0)));
            const float32 = new Float32Array(new Int16Array(bytes.buffer).length);
            for (let i = 0; i < float32.length; i++) float32[i] = new Int16Array(bytes.buffer)[i] / 32768.0;
            const buf = this.playbackCtx.createBuffer(1, float32.length, 24000);
            buf.getChannelData(0).set(float32);
            const src = this.playbackCtx.createBufferSource();
            src.buffer = buf; src.connect(this.playbackCtx.destination);
            this.activeSources.add(src);
            src.onended = () => this.activeSources.delete(src);
            const now = this.playbackCtx.currentTime;
            this.nextPlayTime = Math.max(this.nextPlayTime, now + 0.02);
            src.start(this.nextPlayTime);
            this.nextPlayTime += buf.duration;
            if (this.isAwaitingUserInput) {
                this.suppressInterruptionUntil = Date.now() + 300;
                this.isAwaitingUserInput = false;
            }
        } catch (e) {}
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
        if (this.isMicActive) { this.stopMicrophone(); return; }
        this.isConnected = false;
        if (this.ws) { this.ws.close(); this.ws = null; }
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
