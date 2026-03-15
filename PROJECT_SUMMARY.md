# Project Friday: Final Summary & Architecture Overlook

**Project Friday** is a stable, high-performance, voice-native AI assistant designed for deep integration with the Windows operating system. It bridges the gap between high-level multimodal reasoning and low-level system control.

## 🚀 Core Features & Functionality
- **Multimodal Live Interaction**: Real-time, low-latency voice and vision reasoning powered by the Gemini Live API via WebSockets.
- **Tripartite Architecture**:
    - **Friday Core (Electron)**: Manages the HUD, IPC routing, and sub-agent orchestration.
    - **Sidecar (C# Native AOT)**: Handles OS-level operations (UI Automation, SendInput, Shell) via a high-performance Named Pipe.
    - **Browser Bridge**: A dedicated extension allows Friday to "see" and interact with the web DOM in real-time.
- **Specialist Sub-Agents**: Dedicated agents for complex, asynchronous tasks (e.g., browsing the web, managing files, running CLI commands) that work in the background without interrupting the live session.
- **Stability & Performance**:
    - **Payload Decoupling**: Bypasses WebSocket frame limits to ingest massive data (DOM trees, codebases).
    - **Interruptible Handshake**: Intelligent "barge-in" support that manages audio context cleanly.
    - **Hands-Free Excellence**: Auto-resuming microphone with playback synchronization.
- **Deep Windows Integration**: Multi-monitor coordinate scaling, invisible window filtering, and UIA pattern-safe interactions.

## 🛠️ Technology Stack
- **Languages**: JavaScript (Node.js/Electron), C# (.NET 9 Native AOT), CSS (Vanilla).
- **AI Models**:
    - `gemini-2.5-flash-native-audio-preview` (Live Session).
    - `gemini-3-flash-preview` (Sub-Agent Reasoning).
    - `gemini-2.5-flash` (Vision & Search Grounding).
- **Communication**: WebSockets (Gemini Live), Named Pipes (Sidecar IPC), IPC (Electron Main/Renderer).
- **Storage**: SQLite3 for persistent chat history and agent memory.
- **Authentication**: Clerk-based secure auth flow with desktop deep-link support.

## 📊 Data Sources
- **Gemini Live API**: Primary reasoning and multimodal processing.
- **Windows UI Automation (UIA)**: Direct inspection of desktop applications.
- **Web DOM**: Live browser state indexed and parsed into semantic fragments.
- **Google Search**: Real-time web grounding for factual queries.
- **System Information**: Real-time hardware and process metrics.

## 🏆 Agentic Best Practices
- **Shallow Hierarchy**: Exactly two levels (Primary Agent -> Sub-Agents) to ensure debuggability.
- **Latency First**: Target 500-800ms "mouth-to-ear" for voice naturalness.
- **Direct Action Over Research**: Prioritize UI Automation and CDP navigation over keyword searches.
- **Deduplicated Tooling**: Strict enforcement of unique tool declarations to maintain API stability.
- **Robust Barge-in**: Immediate tracking and termination of audio nodes on user interruption.

## 🧠 Findings & Technical Learnings
- **WebSocket Schema Strictness**: The Gemini Live API's Protobuf foundation is extremely sensitive to payload structure. Even empty arrays (like `parts: []`) must be explicitly present to avoid 1011 errors.
- **Frame Limit Bypassing**: The 64KB WebSocket limit is a bottleneck for "Computer Use." Implementing **Payload Decoupling** (sending a protocol-dummy and streaming raw data via `client_content`) is the only viable way to send massive contexts.
- **Audio/Mic Handshaking**: Synchronizing a live mic with an AI's voice requires careful `nextPlayTime` tracking and active source management to prevent feedback or overlapping audio.
- **Multi-Monitor Coordinate Normalization**: Standard `SM_CXSCREEN` metrics fail on multi-monitor setups. Using `MOUSEEVENTF_VIRTUALDESK` combined with Virtual Screen metrics is critical for accurate "Computer Use" agents.
- **Native AOT Performance**: Using C# Native AOT for the sidecar provided sub-millisecond IPC response times, which is essential for making an AI feel "instant" when interacting with the OS.

---
*Project Friday represents a major step forward in building autonomous agents that are not just chat-bots, but capable OS-level knowledge workers.*
