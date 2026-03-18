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
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.isReconnecting = false;

        this.host = 'generativelanguage.googleapis.com';
        this.model = "models/gemini-2.5-flash-native-audio-preview-12-2025"; 
        this.skillsList = [];
        this.agentTools = [];

        window.friday.onVoiceOpen(() => this.onWsOpen());
        window.friday.onVoiceMessage((data) => this.onWsMessage({ data }));
        window.friday.onVoiceClose((event) => this.onWsClose(event));
        window.friday.onVoiceError((err) => this.onWsError(err));

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
            this.skillsList = await window.friday.getSkills();
            this.agentTools = await window.friday.getVoiceTools();
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
        if (this.isConnected) {
            if (!this.isMicActive) await this.startMicrophone();
            return;
        }

        try {
            this.isConnected = false;
            this.nextPlayTime = 0;
            if (this.playbackCtx && this.playbackCtx.state === 'suspended') {
                await this.playbackCtx.resume();
            }

            console.log('[VoiceClient] Connecting via Main Proxy...');
            await window.friday.voiceConnect({ 
                host: this.host, 
                apiVersion: this.apiVersion, 
                model: this.model 
            });
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
            const result = await window.friday.fsReadFileStr('friday-program.md');
            if (result && result.success) basePrompt = result.content;
            else basePrompt = `You are Friday, an autonomous Windows desktop and browser automation agent.`;
        } catch (e) { basePrompt = `You are Friday...`; }

        // AUTOMATIC CONTEXT FETCH (Zep Cloud)
        let zepFacts = [];
        try {
            const memRes = await window.friday.searchMemory("Provide a summary of the most recent user goals and conversation history.");
            if (memRes && memRes.facts) zepFacts = memRes.facts;
        } catch (memErr) { console.warn('[VoiceClient] Memory fetch failed:', memErr); }

        const zepContext = zepFacts.length > 0 
            ? `\n## RECENT CONTEXT (ZEP CLOUD):\n${zepFacts.map(f => `- ${f}`).join('\n')}`
            : '';

        return `${basePrompt}

## Speed & Decisiveness
- When a user says 'do xyz', your FIRST thought MUST be: 'Which specific specialized tool from my inventory solves this fastest?'
- For any web-related activity (buying, searching, navigating), prioritize the \`browse_web\` tool.
- For any fact persistence, prioritize \`save_to_memory\`.

## URL Output
- If you find a URL or website that you want to share with the user, ALWAYS output the raw URL on its own line (e.g. \`https://www.youtube.com/watch?v=...\`).

## Current State
- Resolution: ${res}
- Mode: ACTIVE

---
${zepContext}

---
${this._user && this._user.persona ? `USER INFORMATION:
- Your user's name is ${this._user.persona.name}.
- User Bio: ${this._user.persona.bio || 'Not provided'}.
` : 'USER INFORMATION: Not yet personalized.'}`;
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
        
        if (this.activeSources.size > 0) {
            console.log('[VoiceClient] User interrupted AI. Stopping playback.');
            this.isInterrupted = true;
            this.stopAllAudio();
        }
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
            if (!this.audioContext || this.audioContext.state === 'closed') return;
            this.workletNode = new AudioWorkletNode(this.audioContext, 'recorder-worklet');

            this.workletNode.port.onmessage = (event) => {
                if (event.data.type === 'debug') {
                    console.log('[VoiceClient] Worklet Debug:', event.data.msg);
                } else if (event.data.type === 'vad_speech') {
                    console.log('[VoiceClient] VAD Triggered (Speech detected)');
                    this.handleInterruption();
                } else if (event.data.type === 'audio_data' && this.ws?.readyState === WebSocket.OPEN) {
                    if (!this.isMicActive) return;
                    
                    const base64 = this.arrayBufferToBase64(event.data.buffer);
                    this.audioSentThisTurn = true;
                    if (Math.random() < 0.05) console.log('[VoiceClient] Sending audio chunk (sample rate match)...');
                    this.wsSend(JSON.stringify({
                        realtime_input: { media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: base64 }] }
                    }));
                }
            };
            source.connect(this.workletNode);
            // Removed connection to destination to prevent local feedback/echo
            window.friday.setState({ status: 'listening' });
        } catch (e) {
            console.error('[VoiceClient] Mic error:', e);
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(t => t.stop());
                this.mediaStream = null;
            }
            this.isMicActive = false;
        }
    }

    onWsClose(event) { 
        console.warn('[VoiceClient] WebSocket closed:', event.code, event.reason);
        this.isConnected = false; 
        
        // Don't reconnect if user explicitly stopped (code 1000)
        if (event.code === 1000 || this.isReconnecting) {
            window.friday.setState({ status: 'idle' }); 
            return;
        }

        // Attempt reconnection with exponential backoff
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.isReconnecting = true;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
            
            console.log(`[VoiceClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})...`);
            
            window.friday.setState({ 
                status: 'reconnecting', 
                reconnectAttempt: this.reconnectAttempts + 1 
            });
            
            setTimeout(() => {
                this.reconnectAttempts++;
                this.isReconnecting = false;
                this.start();
            }, delay);
        } else {
            console.error('[VoiceClient] Max reconnection attempts reached');
            window.friday.setState({ status: 'disconnected' }); 
            window.friday.showNotification('Connection Lost', 'Please check your internet connection.');
        }
    }
    onWsError(err) { 
        console.error('[VoiceClient] WebSocket error:', err);
        window.friday.addMessage('error', '🎙️ Voice connection error. Attempting to reconnect...');
        this.onWsClose({ code: 0, reason: 'Error' }); 
    }

    async onWsMessage(event) {
        try {
            const raw = (event.data instanceof Blob) ? await event.data.text() : event.data;
            const data = JSON.parse(raw);
            console.log('[VoiceClient] WS Message received:', JSON.stringify(data).substring(0, 500));
            
            // Log raw server content for debugging
            if (data.serverContent) {
                console.log('[VoiceClient] Server Content received:', JSON.stringify(data.serverContent).substring(0, 500));
            } else if (data.toolCall) {
                console.log('[VoiceClient] Tool Call received:', data.toolCall.functionCalls?.map(f => f.name));
            } else if (data.setupComplete) {
                console.log('[VoiceClient] Setup complete acknowledged. Full data:', JSON.stringify(data.setupComplete));
                if (this.playbackCtx && this.playbackCtx.state === 'suspended') {
                    this.playbackCtx.resume().then(() => console.log('[VoiceClient] Playback context resumed via setup. State:', this.playbackCtx.state));
                }
                window.friday.getState().then(s => { 
                    if (s.voiceMode !== 'ptt') {
                        console.log('[VoiceClient] Starting microphone...');
                        this.startMicrophone(); 
                    }
                });
                return;
            } else {
                console.log('[VoiceClient] Other message:', Object.keys(data));
            }

            if (data.serverContent?.modelTurn?.parts) {
                const textPart = data.serverContent.modelTurn.parts.find(p => p.text);
                if (textPart && textPart.text.trim()) {
                    // AUTOMATIC SYNC TO ZEP
                    window.friday.saveToMemory(`Friday: ${textPart.text}`).catch(e => console.error('[VoiceClient] Zep save failed:', e));
                }
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
            // First, check if this is a specialized "meta-tool" (delegation, screenshot)
            if (call.name === 'delegate_task') {
                response = await window.friday.delegateTask(call.args.taskDescription);
            } else if (call.name === 'browse_visual') {
                response = await window.friday.browseVisual(call.args.taskDescription);
            } else if (call.name === 'take_screenshot') {
                const s = await window.friday.takeScreenshot();
                if (s?.data) {
                    this.wsSend(JSON.stringify({
                        client_content: { turns: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: s.data } }, { text: "Full screen screenshot." }] }], turn_complete: true }
                    }));
                    response = { success: true };
                }
                window.friday.addMessage('result', '📸 Screenshot captured', s?.data);
            } else if (call.name === 'browser_capture_screenshot') {
                const b64 = await window.friday.browser.screenshot();
                if (b64) {
                    this.wsSend(JSON.stringify({
                        client_content: { turns: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: b64 } }, { text: "Here is the screenshot." }] }], turn_complete: true }
                    }));
                    response = { success: true };
                }
                window.friday.addMessage('result', '📸 Browser Screenshot', b64);
            } else if (call.name === 'open_default_browser') {
                await window.friday.openExternal(call.args.url);
                response = { success: true };
            } else {
                // Route everything else through the unified tool executor
                if (call.name === 'browser_navigate') {
                    response = { success: await window.friday.browser.navigate(call.args.url) };
                } else if (call.name === 'browser_get_dom') {
                    response = await window.friday.browser.getDOM();
                } else if (call.name === 'evaluate_browser_js') {
                    response = { result: await window.friday.browser.evaluate(call.args.script) };
                } else if (call.name === 'browser_click') {
                    response = await window.friday.browser.click(call.args.target);
                } else if (call.name === 'browser_type') {
                    response = await window.friday.browser.type(call.args.target, call.args.text);
                } else if (call.name === 'browser_press_key') {
                    response = await window.friday.browser.pressKey(call.args.key);
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
                } else if (call.name === 'browse_web') {
                    response = await window.friday.runBrowserTask(call.args.task);
                } else if (call.name === 'save_to_memory') {
                    response = await window.friday.saveToMemory(call.args.content);
                } else if (call.name === 'search_memory') {
                    response = await window.friday.searchMemory(call.args.query);
                } else if (call.name === 'analyze_document') {
                    response = await window.friday.analyzeDocument(call.args.text);
                } else if (call.name === 'web_search') {
                    response = await window.friday.webSearch(call.args.query);
                } else if (call.name === 'silent_action') {
                    window.friday.addMessage('action', `🤫 Silent Action: ${call.args.action}`);
                    response = { success: true };
                }
            }
        } catch (err) {
            response = { success: false, error: err.message };
        }

        const resMsg = JSON.stringify(response);
        if (resMsg.length > 30000) {
            this.wsSend(JSON.stringify({ toolResponse: { functionResponses: [{ name: call.name, id: call.id, response: { status: 'streaming' } }] } }));
            this.sendChunkedText(`[RAW OUTPUT]: ${resMsg}`);
        } else {
            this.wsSend(JSON.stringify({ toolResponse: { functionResponses: [{ name: call.name, id: call.id, response }] } }));
        }
    }

    sendChunkedText(text) {
        const CHUNK_LIMIT = 30000; // Safe byte limit
        const encoder = new TextEncoder();
        const fullBytes = encoder.encode(text);
        
        for (let i = 0; i < fullBytes.length; i += CHUNK_LIMIT) {
            // Fix BUG-016: ReadyState safety check
            if (this.ws?.readyState !== WebSocket.OPEN) {
                console.warn('[VoiceClient] WS closed during chunked send, aborting.');
                break;
            }

            const chunk = fullBytes.slice(i, i + CHUNK_LIMIT);
            const isLast = (i + CHUNK_LIMIT >= fullBytes.length);
            this.wsSend(JSON.stringify({
                client_content: { 
                    turns: [{ role: "user", parts: [{ text: new TextDecoder().decode(chunk) }] }], 
                    turn_complete: isLast 
                }
            }));
        }
    }

    async playAudioChunk(b64) {
        try {
            if (!this.playbackCtx) return;
            if (this.playbackCtx.state === 'suspended') await this.playbackCtx.resume();
            if (this.isInterrupted) return;

            // 1. Efficient Base64 to ArrayBuffer
            const binaryString = atob(b64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            
            // 2. PCM16 to Float32
            const int16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < float32.length; i++) float32[i] = int16[i] / 32768.0;
            
            // 3. Create and Schedule Buffer
            const buf = this.playbackCtx.createBuffer(1, float32.length, 24000);
            buf.getChannelData(0).set(float32);
            
            const src = this.playbackCtx.createBufferSource();
            src.buffer = buf;
            
            // 4. Boost audio if user mentioned hearing issues
            if (!this.gainNode) {
                this.gainNode = this.playbackCtx.createGain();
                this.gainNode.gain.value = 1.5; // 50% boost
                this.gainNode.connect(this.playbackCtx.destination);
            }
            src.connect(this.gainNode);
            
            this.activeSources.add(src);
            src.onended = () => this.activeSources.delete(src);
            
            const now = this.playbackCtx.currentTime;
            this.nextPlayTime = Math.max(this.nextPlayTime, now + 0.02);
            
            // BUG-003: Fix audio source leak with try-catch
            try {
                src.start(this.nextPlayTime);
                this.nextPlayTime += buf.duration;
            } catch (e) {
                console.error('[VoiceClient] Failed to start audio source:', e);
                this.activeSources.delete(src); // Clean up immediately
                throw e;
            }
            
            // Broadcast speaking state
            window.friday.setState({ status: 'speaking' });
            clearTimeout(this.speakTimeout);
            this.speakTimeout = setTimeout(() => {
                if (this.activeSources.size === 0) window.friday.setState({ status: 'idle' });
            }, 500);
            
            if (this.isAwaitingUserInput) {
                // BUG-023: Set suppression once
                if (!this.suppressInterruptionUntil || Date.now() > this.suppressInterruptionUntil) {
                    this.suppressInterruptionUntil = Date.now() + 300;
                }
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

    async stopMicrophone() {
        this.isMicActive = false;
        if (this.workletNode) {
            try { 
                // BUG-010: Remove message handler to prevent leak
                this.workletNode.port.onmessage = null;
                this.workletNode.disconnect(); 
            } catch(e){}
            this.workletNode = null;
        }
        if (this.mediaStream) {
            try { this.mediaStream.getTracks().forEach(t => t.stop()); } catch(e){}
            this.mediaStream = null;
        }
        if (this.audioContext) {
            try {
                // BUG-011: Close context to fully release resources
                if (this.audioContext.state !== 'closed') {
                    await this.audioContext.close();
                }
            } catch(e){}
            this.audioContext = null;
        }
    }

    stop() {
        this.stopMicrophone(); // Always try to stop mic
        this.isConnected = false;
        window.friday.voiceClose();
        window.friday.setState({ status: 'idle' });
    }

    wsSend(data) {
        window.friday.voiceSend(data);
    }

    arrayBufferToBase64(buffer) {
        // Section 4.1: Modern & Faster Base64 encoding
        return btoa(new TextDecoder('latin1').decode(new Uint8Array(buffer)));
    }
}

window.VoiceClient = new VoiceClient();
