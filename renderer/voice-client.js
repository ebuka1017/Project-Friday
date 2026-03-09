// ═══════════════════════════════════════════════════════════════════════
// renderer/voice-client.js — Gemini Multimodal Live API Client
// Handles WebRTC audio capture, WebSocket connection, and state sync.
// Compliance: PCM 16kHz Mono, snake_case payloads, Field Manual v1.0 Prompt.
// ═══════════════════════════════════════════════════════════════════════

class VoiceClient {
    constructor() {
        this.ws = null;
        this.audioContext = null;
        this.playbackCtx = null; // Separate context for playback at 24kHz
        this.mediaStream = null;
        this.workletNode = null;
        this.isConnected = false;
        this.isInterrupted = false; // Flag for Iteration 8: block audio during interruption handshake
        this.audioSentThisTurn = false; // New: prevents 1007 on empty turns
        this.isAwaitingUserInput = false; // Flag for Iteration 9: guard against 1007 on immediate stop

        // Scheduled audio playback queue (fixes crackling)
        this.nextPlayTime = 0;

        // Gemini Live API parameters
        this.host = 'generativelanguage.googleapis.com';
        this.baseModel = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
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
                this.agentTools = await window.friday.getVoiceTools();
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

        // ITERATION 10: If already connected, just ensure mic is active if needed
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('[VoiceClient] Resuming existing session');
            if (!this.isMicActive) {
                await this.startMicrophone();
            }
            return;
        }

        try {
            this.isConnected = false; // Reset until open
            this.nextPlayTime = 0;

            if (this.playbackCtx && this.playbackCtx.state === 'suspended') {
                await this.playbackCtx.resume();
            }

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
        const skillsCount = this.skillsList.length;
        const skillsInfo = skillsCount > 0
            ? `\n\n## SKILLS REFERENCE\nYou have access to ${skillsCount} specialized skills/workflows. Refer to them for specific business logic or complex operation steps.`
            : '';

        return `# ════════════════════════════════════════════════════════
# FRIDAY — System Prompt v1.0
# ════════════════════════════════════════════════════════

## IDENTITY
You are Friday, an autonomous Windows desktop and browser automation agent. 
You act with the same permissions as the logged-in user, taking direct actions via UI Automation and Chrome DevTools Protocol (CDP).
When in doubt, prefer reversible actions and confirm before destructive operations.

## MISSION
Your single purpose is to complete user-specified automation tasks accurately, efficiently, and safely on their PC.
You succeed when all requested actions are confirmed executed and the user is notified of the outcome.
You are NOT responsible for: interpreted vague intent, handling auth secrets, or making purchases without explicit approval.

## ENVIRONMENT
- OS: Windows 11
- Working directory: d:\\Program Files\\Project Friday
- Browser: Chromium (Friday Extension connected via CDP)
- Capabilities: Real-time Audio, Vision, and Tool Use
- Context: Multimodal Live Session

## TOOLS
You have access to a suite of desktop and browser control tools. Use them to perceive state and take action:

**TOOL USE POLICY**
BEFORE any tool call:
1. State what you intend to do and why.
2. Verify pre-conditions (Is the target window focused? Is the element visible?).
3. Choose the MOST SPECIFIC tool available.

AFTER each tool call:
1. Evaluate the result — expected or unexpected?
2. If unexpected: do NOT blindly continue.

**TOOL DEFINITIONS**
- \`desktop_type_string\`: Types text into the focused window/element. Use for: forms, terminal input, search bars. Do NOT use for keyboard shortcuts.
- \`desktop_send_chord\`: Sends keyboard shortcuts (e.g. 'control+c', 'alt+f4', 'enter'). Essential for: app navigation, closing windows, submitting forms without a click target.
- \`desktop_click_at\`: Performs a mouse click at (x, y) coordinates. use when: element is visible but non-interactive via UI Automation.
- \`desktop_find_element\`: Searches UI elements by name/type. Use to: get coordinates and verify existence of native buttons/fields.
- \`desktop_dump_tree\`: Snapshots the Windows UI hierarchy. Use for: structural discovery in native apps.
- \`navigate_browser\`: Loads a URL in the Friday Chromium instance. Primary entry point for all web-based tasks.
- \`read_browser_dom\`: Extracts the AXTree of the active tab. Use for: reliable identification of interactive elements (buttons, links).
- \`evaluate_browser_js\`: Runs JS in the browser context. Use for: custom data scraping, complex state checks, or DOM manipulation.
- \`take_screenshot\`: Captures the full screen. Use for: verifying state, OCR (if needed), or when stuck and needing to "see" the screen.
- \`delegate_task\`: Spawns a background agent for complex/long-running work. Use to: remain responsive to the user during CPU-heavy tasks.

## SPECIALIST SUB-AGENTS YOU MAY SPAWN
- \`browser_agent\`: Your helper in the browser. Handles A11y + vision-based browser navigation. Best for complex, multi-step web tasks (5+ steps).
- \`dom_reader\`: Specialized for deep page content extraction and data scraping.
- \`file_agent\`: Handles native file system read/write operations.

## REASONING PROTOCOL
For non-trivial tasks, follow this BEFORE any action:
1. UNDERSTAND: Restate the task in your own words. What is the desired end state?
2. PLAN: List steps in order, flagging IRREVERSIBLE steps (deletion, submission).
3. EXECUTE: Execute one step at a time, evaluate result, then proceed.
4. VERIFY: Confirm end state matches desired state. Never declare false success.

## CONSTRAINTS
- NEVER claim a tool succeeded without a success response.
- NEVER retry a failing tool call more than 3 times.
- ALWAYS ask for confirmation before irreversible actions (deleting files, form submissions).
- ESCALATE if a task requires actions outside your defined capabilities.

## OUTPUT FORMAT
- Be concise and conversational in your audio responses. 
- When providing data or results, summarize clearly.
- Limit responses to 3-4 sentences maximum.

## ERROR PROTOCOL
If a tool call fails:
1. Retry 1: same parameters.
2. Retry 2: modified approach or different tool.
3. Retry 3: STOP and report the error to the user.
4. LOOP DETECTION: If same tool + same params twice in a row, STOP and report.

## SUB-AGENT DELEGATION
Delegate complex or long-running tasks using 'delegate_task' to your specialist sub-agents (like \`browser_agent\`). 
Provide ALL 6 fields:
1. OBJECTIVE: One sentence of exactly what to produce.
2. OUTPUT FORMAT: Exact schema required.
3. TOOLS ALLOWED: Explicit list only.
4. SCOPE BOUNDARY: What to NOT do.
5. EFFORT BUDGET: Max tool calls (e.g. 5 calls for simple lookup).
6. HANDOFF CONDITION: When to return (e.g. "after finding 3 results").${skillsInfo}`;
    }

    async onWsOpen() {
        console.log('[VoiceClient] WebSocket connected');
        this.isConnected = true;

        if (!this.ws) return;

        // Send initial setup message (Standardized snake_case)
        const setupMessage = {
            setup: {
                model: this.model,
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
                    parts: [{ text: this._buildSystemInstruction() }]
                },
                tools: [
                    { google_search: {} },
                    { function_declarations: this.agentTools }
                ]
            }
        };

        if (this.ws.readyState === WebSocket.OPEN) {
            console.log('[VoiceClient] Sending SETUP compliant with Field Manual v1.0...');
            this.ws.send(JSON.stringify(setupMessage));
            // We do NOT start the microphone here. We wait for 'setupComplete' message.
        }
    }

    handleInterruption() {
        if (!this.isConnected) return;
        console.log('[VoiceClient] Interrupting agent...');
        this.isInterrupted = true;

        // ITERATION 15: Do NOT stop the microphone. 
        // Interruption should only stop agent playback.
        this.clearPlayback();
    }

    clearPlayback() {
        // We can't easily "stop" already scheduled sources without keeping tracking of them all
        // but we can at least stop scheduling NEW ones and reset the timer.
        this.nextPlayTime = 0;
    }

    async startMicrophone() {
        if (this.isMicActive) return;
        try {
            this.isMicActive = true;
            this.isAwaitingUserInput = false; // Reset when user starts talking
            this.audioSentThisTurn = false; // Reset for a new turn

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
                if (event.data.type === 'vad_speech') {
                    this.handleInterruption();
                    return;
                }

                if (event.data.type === 'audio_data' && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    // ITERATION 15: Mic Gating (PTT / Handsfree control)
                    // Only send audio if the mic is "active" in the UI.
                    if (!this.isMicActive) return;

                    // ITERATION 8: If we are in the middle of an interruption handshake, do NOT send audio.
                    // This prevents 1007 errors where the server gets audio before it's ready post-interrupt.
                    if (this.isInterrupted) return;

                    // ITERATION 9: Reset waiting flag on first audio chunk
                    if (this.isAwaitingUserInput) this.isAwaitingUserInput = false;

                    const base64 = this.arrayBufferToBase64(event.data.buffer);
                    this.audioSentThisTurn = true; // ITERATION 14: Confirm audio sent for turn boundary
                    const msg = {
                        realtime_input: {
                            media_chunks: [{
                                mime_type: "audio/pcm;rate=16000",
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
            console.log('[VoiceClient] Microphone capture started (16kHz PCM compliant)');

        } catch (e) {
            console.error('[VoiceClient] Mic error:', e);
            window.friday.addMessage('error', `Microphone failed: ${e.message} `);
            window.friday.setState({ status: 'idle' });
        }
    }

    onWsClose(event) {
        console.log('[VoiceClient] WebSocket closed:', event.code);
        this.isConnected = false;
        if (event.code !== 1000) {
            window.friday.addMessage('error', `Voice connection closed unexpectedly(code: ${event.code})`);
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

                // ITERATION 15: Mode-aware auto-start. 
                // Only auto-start the mic if we're not explicitly in PTT mode.
                window.friday.getState().then(state => {
                    if (state.voiceMode !== 'ptt') {
                        this.startMicrophone();
                    }
                });
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
                    this.isInterrupted = false;
                    this.isAwaitingUserInput = true;

                    window.friday.getState().then(state => {
                        if (state.voiceMode === 'handsfree') {
                            // Calculate delay until playback finishes
                            let delayMs = 100; // Minimal safety buffer
                            if (this.playbackCtx) {
                                const remaining = (this.nextPlayTime - this.playbackCtx.currentTime) * 1000;
                                if (remaining > 0) delayMs = remaining + 150;
                            }

                            console.log(`[VoiceClient] Hands-free resumption in ${Math.round(delayMs)}ms...`);
                            setTimeout(async () => {
                                const latestState = await window.friday.getState();
                                // Only restart if still in hands-free and session is active
                                if (latestState.voiceMode === 'handsfree' && this.ws && this.ws.readyState === WebSocket.OPEN) {
                                    window.friday.setState({ status: 'listening' });
                                    this.startMicrophone();
                                }
                            }, delayMs);
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
        window.friday.addMessage('action', `🔧 ${call.name} (${JSON.stringify(call.args || {}).substring(0, 100)})`);

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
                    response = { success: false, error: `Domain not in allowlist.User must add it in Browser settings.URL: ${url} ` };
                    window.friday.addMessage('error', `Blocked: ${url} not in allowlist`);
                } else {
                    const res = await window.friday.navigate(url);
                    response = { success: res || false };
                    window.friday.addMessage('result', `✅ Navigated to ${url} `);
                }
            }
            else if (call.name === 'read_browser_dom') {
                const dom = await window.friday.browser.getDOM();
                response = dom || { error: 'Failed to read DOM (Is extension connected?)' };
                window.friday.addMessage('result', `📄 Read DOM(${JSON.stringify(response).length} chars)`);
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
                const res = await window.friday.browser.click(call.args.selector);
                response = { success: res || false };
                if (res && res.error) response = res;
                window.friday.addMessage('result', `🖱️ Web Click: ${call.args.selector.substring(0, 20)} `);
            }
            else if (call.name === 'web_type') {
                const res = await window.friday.browser.type(call.args.selector, call.args.text);
                response = { success: res || false };
                if (res && res.error) response = res;
                window.friday.addMessage('result', `⌨️ Web Type: ${call.args.text.substring(0, 15)} `);
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
                            client_content: {
                                turns: [{
                                    role: "user",
                                    parts: [{
                                        inline_data: { mime_type: "image/jpeg", data: b64Data }
                                    }, {
                                        text: call.args.annotated ? "Here is the annotated browser screenshot. Find the number corresponding to your target and reply with a web_click or web_type using the exact 'x,y' coordinates of the element center." : "Here is the browser screenshot."
                                    }]
                                }],
                                turn_complete: true
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
                window.friday.addMessage('result', `🎹 Sent ${call.args.chord} `);
            }
            else if (call.name === 'desktop_click_at') {
                const res = await window.friday.sidecar('input.clickAt', { x: call.args.x, y: call.args.y });
                response = res || { success: true };
                window.friday.addMessage('result', `🖱️ Clicked at(${call.args.x}, ${call.args.y})`);
            }
            else if (call.name === 'desktop_find_element') {
                const params = { name: call.args.name };
                if (call.args.controlType) params.controlType = call.args.controlType;
                const res = await window.friday.sidecar('uia.findElement', params);
                response = res || { error: 'Element not found' };
                window.friday.addMessage('result', `🔍 FindElement: ${call.args.name} `);
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
                window.friday.addMessage('result', `💀 Terminated process PID ${call.args.pid} `);
            }
            // ── System & UI Tools ──
            else if (call.name === 'get_system_info') {
                const info = await window.friday.getSystemInfo();
                response = info || { error: 'Failed to get system info' };
                window.friday.addMessage('result', `🖥️ System Info gathered`);
            }
            else if (call.name === 'show_notification') {
                const res = await window.friday.showNotification(call.args.title, call.args.body);
                response = res || { success: true };
                window.friday.addMessage('result', `🔔 Notification: ${call.args.title} `);
            }
            else if (call.name === 'show_message_dialog') {
                const res = await window.friday.showMessageDialog(call.args);
                response = res || { error: 'Failed to show dialog' };
                window.friday.addMessage('result', `💬 Message Dialog shown`);
            }
            // ── Network & Search ──
            else if (call.name === 'http_request') {
                const res = await window.friday.httpRequest(call.args);
                response = res || { error: 'Failed to perform HTTP request' };
                window.friday.addMessage('result', `🌐 HTTP Request: ${call.args.method || 'GET'} ${call.args.url} `);
            }
            else if (call.name === 'get_user_profile') {
                const profile = await window.friday.getUserProfile();
                response = profile || { error: 'Failed to get user profile' };
                window.friday.addMessage('result', `👤 User Profile gathered`);
            }
            else if (call.name === 'web_search') {
                const res = await window.friday.webSearch(call.args.query);
                response = res || { error: 'Search failed' };
                window.friday.addMessage('result', `🔍 Searched: ${call.args.query} `);
            }
            else if (call.name === 'web_deepdive') {
                const res = await window.friday.webDeepdive(call.args.url);
                response = res || { error: 'Deep-dive failed' };
                window.friday.addMessage('result', `🌊 Deep - dive: ${call.args.url} `);
            }
            // ── File System Tools ──
            else if (call.name === 'fs_list_directory') {
                const path = call.args.path || call.args.directory;
                const res = await window.friday.fsListDirectory(path);
                response = res;
                if (res.success) window.friday.addMessage('result', `📁 Listed directory: ${path.substring(0, 30)} `);
            }
            else if (call.name === 'fs_read_file') {
                const path = call.args.path || call.args.file;
                const res = await window.friday.fsReadFileStr(path);
                response = res;
                if (res.success) window.friday.addMessage('result', `📄 Read file: ${path.substring(0, 30)}...`);
            }
            else if (call.name === 'fs_write_file') {
                const path = call.args.path || call.args.file;
                const content = call.args.content || call.args.text || call.args.data;
                const res = await window.friday.fsWriteFileStr(path, content);
                response = res;
                if (res.success) window.friday.addMessage('result', `💾 Wrote file: ${path.substring(0, 30)}...`);
            }
            // ── Background Agents ──
            else if (call.name === 'delegate_task') {
                console.log('[VoiceClient] delegate_task raw args:', JSON.stringify(call.args));
                // Robust property resolution for task description
                const taskDesc = call.args.taskDescription ||
                    call.args.task_description ||
                    call.args.task ||
                    call.args.prompt ||
                    call.args.description;

                if (!taskDesc) {
                    console.error('[VoiceClient] delegate_task: Missing task description in args:', call.args);
                    response = { success: false, error: "Missing task description argument." };
                } else {
                    const res = await window.friday.delegateTask(taskDesc);
                    response = { success: true, jobId: res.jobId, message: `Task delegated successfully. Job ID: ${res.jobId}` };
                    window.friday.addMessage('result', `🤖 Delegated task [${res.jobId}]: ${taskDesc.substring(0, 50)}...`);
                }
            }
            else if (call.name === 'browse_visual') {
                const taskDesc = call.args.taskDescription || call.args.task_description || call.args.task;
                const res = await window.friday.browseVisual(taskDesc);
                response = { success: true, jobId: res.jobId, message: `Visual browsing started. Job ID: ${res.jobId}` };
                window.friday.addMessage('result', `👁️ Visual Browsing: ${taskDesc.substring(0, 50)}...`);
            }
            // ── Productivity & Connectors ──
            else if (call.name === 'gmail_list') {
                const res = await window.friday.gmailList();
                response = res || { error: 'Failed to list Gmail' };
                window.friday.addMessage('result', `📧 Gmail: Listed messages`);
            }
            else if (call.name === 'gmail_read') {
                const res = await window.friday.gmailRead(call.args.id);
                response = res || { error: 'Failed to read Gmail' };
                window.friday.addMessage('result', `📧 Gmail: Read message ${call.args.id} `);
            }
            else if (call.name === 'gmail_send') {
                const res = await window.friday.gmailSend(call.args);
                response = res || { error: 'Failed to send Gmail' };
                window.friday.addMessage('result', `📧 Gmail: Sent to ${call.args.to} `);
            }
            else if (call.name === 'calendar_google_list') {
                const res = await window.friday.calendarGoogleList();
                response = res || { error: 'Failed to list Google Calendar' };
                window.friday.addMessage('result', `📅 Google Cal: Listed events`);
            }
            else if (call.name === 'calendar_google_create') {
                const res = await window.friday.calendarGoogleCreate(call.args);
                response = res || { error: 'Failed to create Google Calendar event' };
                window.friday.addMessage('result', `📅 Google Cal: Created event`);
            }
            else if (call.name === 'drive_list') {
                const res = await window.friday.driveList(call.args.query);
                response = res || { error: 'Failed to list Google Drive' };
                window.friday.addMessage('result', `📂 Drive: Searched "${call.args.query || ''}"`);
            }
            else if (call.name === 'drive_read') {
                const res = await window.friday.driveRead(call.args.fileId);
                response = res || { error: 'Failed to read Google Drive file' };
                window.friday.addMessage('result', `📂 Drive: Read metadata for ${call.args.fileId}`);
            }
            else if (call.name === 'outlook_list') {
                const res = await window.friday.outlookList();
                response = res || { error: 'Failed to list Outlook' };
                window.friday.addMessage('result', `📧 Outlook: Listed messages`);
            }
            else if (call.name === 'outlook_send') {
                const res = await window.friday.outlookSend(call.args);
                response = res || { error: 'Failed to send Outlook' };
                window.friday.addMessage('result', `📧 Outlook: Sent to ${call.args.to} `);
            }
            else if (call.name === 'calendar_outlook_list') {
                const res = await window.friday.calendarOutlookList();
                response = res || { error: 'Failed to list Outlook Calendar' };
                window.friday.addMessage('result', `📅 Outlook Cal: Listed events`);
            }
            // ── Window Management & OS Controls ──
            else if (call.name === 'window_list') {
                const res = await window.friday.sidecar('window.list', {});
                response = res || { error: 'Failed to list windows' };
                if (res && res.windows) window.friday.addMessage('result', `🪟 Found ${res.windows.length} windows`);
            }
            else if (call.name === 'window_focus') {
                const res = await window.friday.sidecar('window.focus', { handle: call.args.handle });
                response = res || { error: 'Failed to focus window' };
                window.friday.addMessage('result', `🎯 Focused window handle ${call.args.handle} `);
            }
            else if (call.name === 'window_close') {
                const res = await window.friday.sidecar('window.close', { handle: call.args.handle });
                response = res || { error: 'Failed to close window' };
                window.friday.addMessage('result', `❌ Closed window handle ${call.args.handle} `);
            }
            else if (call.name === 'take_screenshot') {
                const screenshot = await window.friday.takeScreenshot();
                if (screenshot && screenshot.data) {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        const imgMsg = {
                            client_content: {
                                turns: [{
                                    role: "user",
                                    parts: [{
                                        inline_data: {
                                            mime_type: screenshot.mime_type || screenshot.mimeType,
                                            data: screenshot.data
                                        }
                                    }, {
                                        text: "Here is the current screenshot of the screen."
                                    }]
                                }],
                                turn_complete: true
                            }
                        };
                        this.ws.send(JSON.stringify(imgMsg));
                        response = { success: true, message: 'Screenshot sent to your vision.' };
                    } else {
                        response = { error: "Voice connection not open to receive image." };
                    }
                    window.friday.addMessage('result', `📸 Screenshot captured`);
                } else {
                    response = { error: 'Failed to capture screenshot' };
                    window.friday.addMessage('error', `❌ Screenshot failed`);
                }
            }
        } catch (err) {
            console.error(`[VoiceClient] Tool error(${call.name}): `, err);
            response = { success: false, error: err.message };
            window.friday.addMessage('error', `❌ ${call.name} failed: ${err.message} `);
        }

        // Send function response back to Gemini (tool_response format for Live API compliance)
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.isAwaitingUserInput = false; // ITERATION 9

            // ITERATION 16: Payload Decoupling Fix
            // If the response is too large for a standard tool_response frame (~64KB limit),
            // we send a tiny dummy response to satisfy the protocol and stream the raw data via client_content.
            let serializedResponse = JSON.stringify(response);
            if (serializedResponse.length > 30000) {
                console.log('[VoiceClient] Payload massive. Decoupling tool_response and streaming via client_content...');

                // 1. Send dummy response to Live API
                const dummyResponseMsg = {
                    tool_response: {
                        function_responses: [{
                            name: call.name,
                            id: call.id,
                            response: {
                                status: "success",
                                note: "Data is too large for a standard response. Streaming full raw result into your context now."
                            }
                        }]
                    }
                };
                this.ws.send(JSON.stringify(dummyResponseMsg));

                // 2. Stream actual payload
                this.sendChunkedText(`[SYSTEM: Full Raw Output for tool '${call.name}']\n${serializedResponse}`);
                return;
            }

            // Standard tool_response for smaller payloads
            const functionResponseMsg = {
                tool_response: {
                    function_responses: [{
                        name: call.name,
                        id: call.id,
                        response: response
                    }]
                }
            };

            this.ws.send(JSON.stringify(functionResponseMsg));
            console.log('[VoiceClient] Sent function response');
        }
    }

    // ITERATION 9: Split large text payloads to prevent 1008
    sendChunkedText(text) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.isAwaitingUserInput = false;

        const CHUNK_SIZE = 4000;
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            const chunk = text.slice(i, i + CHUNK_SIZE);
            const isLast = (i + CHUNK_SIZE >= text.length);

            const msg = {
                client_content: {
                    turns: [{
                        role: "user",
                        parts: [{ text: chunk }]
                    }],
                    turn_complete: isLast
                }
            };
            this.ws.send(JSON.stringify(msg));
        }
    }

    // Called when a sub-agent spawned by delegate_task finishes
    handleSubAgentComplete(result) {
        console.log('[VoiceClient] Sub-agent finished:', result);
        window.friday.addMessage('result', `🤖 Sub - agent ${result.jobId} finished.`);

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('[VoiceClient] Sending sub-agent result (chunked)...');
            this.sendChunkedText(`[SYSTEM NOTIFICATION] Background task ${result.jobId} completed. Result: ${result.result || result.error}`);

            // ITERATION 14: Standardize barge-in notification
            const bargeInMsg = {
                tool_response: {
                    function_responses: [{
                        name: "delegate_task_callback", // Virtual ID for the server to acknowledge
                        id: "callback-" + result.jobId,
                        response: {
                            jobId: result.jobId,
                            status: "complete",
                            scheduling: "INTERRUPT"
                        }
                    }]
                }
            };
            this.ws.send(JSON.stringify(bargeInMsg));
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
        // ITERATION 10: State-aware stop
        // If user is currently talking (Mic active), stop mic and send turn_complete
        // but KEEP the WebSocket open so the agent can respond.
        if (this.isMicActive) {
            console.log('[VoiceClient] Ending user turn (PTT release)');
            this.stopMicrophone();

            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // ITERATION 13: Only send turn_complete if we actually SENT audio
                // Correct frame shape: include parts:[] even if empty
                if (!this.isAwaitingUserInput && this.audioSentThisTurn) {
                    const stopMsg = {
                        client_content: {
                            turns: [{
                                role: "user",
                                parts: [] // Satisfies the strict Protobuf schema
                            }],
                            turn_complete: true
                        }
                    };
                    this.ws.send(JSON.stringify(stopMsg));
                }
            }
            this.audioSentThisTurn = false; // Reset for next turn
            return;
        }

        // If mic is NOT active, this is an explicit "End Session" request
        console.log('[VoiceClient] Ending session (Explicit Stop)');
        this.isConnected = false;

        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                // ITERATION 14: Be extremely defensive about state transitions.
                // If we are awaiting input (turn already ended) OR we just 
                // interrupted the agent, do NOT send a manual turn_complete.
                // This prevents 1011 errors during state collisions.
                if (this.isAwaitingUserInput || this.isInterrupted) {
                    console.log('[VoiceClient] Closing socket directly (State: ' + (this.isInterrupted ? 'Interrupted' : 'AwaitingInput') + ')');
                    setTimeout(() => this.ws?.close(1000), 100);
                } else {
                    // Force turn_complete only if we are in a clean turn state
                    console.log('[VoiceClient] Sending final turn_complete before close');
                    const stopMsg = {
                        client_content: {
                            turns: [{
                                role: "user",
                                parts: [] // Satisfies strict Protobuf
                            }],
                            turn_complete: true
                        }
                    };
                    this.ws.send(JSON.stringify(stopMsg));
                    setTimeout(() => this.ws?.close(1000), 150); // Slightly more breath
                }
            }
            this.ws = null;
        }

        this.stopMicrophone(); // Ensure everything is cleaned up
        this.nextPlayTime = 0;

        window.friday.getState().then(state => {
            if (state && state.status !== 'idle') {
                window.friday.setState({ status: 'idle' });
            }
        });
    }

    // Helper to dry up mic cleanup
    stopMicrophone() {
        this.isMicActive = false;

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
    }

    // Helper: ArrayBuffer to Base64
    // ITERATION 16: Optimized conversion to prevent stack overflow and memory thrashing
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return window.btoa(binary);
    }
}

// Attach to global scope for the main app UI to use
window.VoiceClient = new VoiceClient();
