# Friday — Autonomous Voice-Native AI Knowledge Worker

Friday is a cutting-edge, voice-native AI assistant designed for Windows. It combines the power of Gemini Live with deep system integration and visual browsing capabilities to create a truly autonomous knowledge worker that can "see" and "act" on your computer.

![Friday Logo](renderer/assets/logo.png)

## 🌟 The Marvel of Friday

Friday isn't just another chatbot; it's an **Action-Oriented Assistant**. 

- **Voice-Native**: Built from the ground up for low-latency voice interaction using Gemini 2.5 Flash Native Audio.
- **Visual Intelligence**: Uses Gemini's "Computer Use" capability to navigate complex web UIs by "seeing" screenshots.
- **Deep Desktop Integration**: A C# Sidecar bridge using Windows UI Automation (UIA) allows Friday to click, type, and read elements in any native Windows application.
- **Asynchronous Delegation**: Friday can spawn background "sub-agents" to complete long-running tasks while you continue to interact with it.

## 🏗️ Architecture: How It Works

Friday is built on a distributed tripartite architecture:

### 1. The Electron Frontend (Renderer)
- **VoiceClient**: Manages the high-speed WebSocket connection to Gemini Live. 
- **PCM Audio Engine**: Handles real-time 16-bit L16 audio capture and playback.
- **HUD Interface**: A beautiful, glassmorphic UI that shows Friday's thinking process and tool executions.

### 2. The Electron Backend (Main Process)
- **Sub-Agent Manager**: Orchestrates background tasks and the "Computer Use" vision loop.
- **Tool Registry**: A centralized hub that maps LLM function calls to system actions.
- **Secure Storage**: Manages the persistent conversation memory and user sessions using SQLite.

### 3. The C# Sidecar (Windows Bridge)
- **Named Pipe Server**: A high-performance IPC bridge (`\\.\pipe\friday-sidecar-v2`) between Node.js and .NET.
- **UI Automation**: Leverages `System.Windows.Automation` to find and interact with native Windows controls.
- **Native Input**: Directly injects mouse and keyboard events at the OS level for maximum reliability.

## 🛠️ Key Technologies
- **LLMs**: Gemini 2.5 Flash (Audio), Gemini 3.1 Flash Lite (Reasoning), Gemini 2.5 Computer Use (Vision).
- **Frontend**: HTML5, Vanilla CSS (Premium Aesthetics), JavaScript.
- **Bridge**: .NET 9 (C#), Windows API, Named Pipes.
- **Auth**: Clerk (External Profile Management).

## 🚀 Roadmap
- [ ] **Multi-Monitor Support**: Expand vision and clicking capabilities across all displays.
- [ ] **Local LLM Fallback**: Integrated support for local models (Ollama/LlamaEdge) for offline tasks.
- [ ] **Skill Marketplace**: A registry where users can download and share specialized agent workflows.
- [ ] **Deep File Indexing**: Integration with RAG to allow Friday to "know" everything about your local documents.

## ⚠️ Common Problems & Solutions

### WebSocket 1007 (Invalid Frame)
- **Cause**: Exceeding the 64KB message limit during initial setup.
- **Fix**: We implemented a **Compact Toolset** for the voice agent, reducing the payload from ~70KB to ~12KB.

### Pipe ENOENT (Sidecar Not Found)
- **Cause**: Missing native dependencies or incorrect working directory.
- **Fix**: The launcher now explicitly sets the `cwd` to the binary location and utilizes a **Multi-Listener** pattern to prevent race conditions.

### Browser Extension Connectivity
- **Fix**: Ensure the "Friday Browser Bridge" extension is installed. It now features an **Auto-Startup Heartbeat** to ensure it's always ready when you open Chrome.

---

Built by Isaac Okwuzi ([@nothiro__](https://x.com/nothiro__))
