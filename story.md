# The Story of Friday

## Inspiration
The inspiration for Friday came from the vision of a truly autonomous, "hands-free" digital companion. We wanted to move beyond the traditional chat-bot interface and build something that felt like a natural extension of the user—an agent that doesn't just talk about tasks, but has the native "hands" and "eyes" to execute them directly on your desktop.

## What it does
Friday is a voice-native AI knowledge worker for Windows. She can:
- **Reason via Voice and Vision**: Using the latest Gemini Multimodal Live API to hold real-time, zero-latency conversations.
- **Control the OS**: Interact with any Windows application using UI Automation and native input simulation.
- **Navigate the Web**: Use a dedicated browser bridge to read, parse, and interact with complex web pages.
- **Run Headless Tasks**: Orchestrate background "Sub-Agents" to handle long-running research or filesystem tasks without interrupting your flow.
- **Operate Hands-Free**: Smart persistence and playback-synced mic management allow for a continuous, low-friction experience.

## How we built it
We utilized a high-performance **Tripartite Architecture**:
1.  **Electron (The Brain)**: Orchestrates the high-level logic, manages the HUD UI, and routes AI tool calls to the correct native handlers.
2.  **C# Native AOT (The Hands)**: A lightweight, blazingly fast sidecar binary that handles low-level Win32 and UI Automation operations via a Named Pipe IPC bridge.
3.  **Gemini Suite (The Intelligence)**:
    - `Gemini 2.5 Flash Native Audio` for the live voice session.
    - `Gemini 1.5 Pro` for high-reasoning background sub-agents.
    - `Gemini 2.5 Computer Use` for accurate visual UI interactions.

## Challenges we ran into
- **API Strictness**: Navigating the rigid Protobuf requirements of the Gemini Live API required deep investigation into payload shapes and hidden protocol field requirements (like the `parts: []` requirement for 1011 stability).
- **The 64KB Ceiling**: We hit the hard limit of WebSocket frame sizes when trying to send massive DOM trees. We solved this by implementing a custom **Payload Decoupling** mechanism to stream data out-of-band.
- **Coordinate Calibration**: Making a "Computer Use" agent work across diverse multi-monitor setups proved difficult. We had to move beyond standard screen metrics and implement virtual desktop coordinate scaling.
- **IPC Reliability**: Ensuring the Electron main process survived unexpected sidecar hiccups required hardening the Named Pipe bridge with `EPIPE` guards and asynchronous lifecycle management.

## Accomplishments that we're proud of
- **Rock-Solid Stability**: Reaching a state where the agent no longer drops connections (1007/1011 errors) during high-frequency voice interaction.
- **Native Efficiency**: Achieving sub-millisecond response times for OS-level tool calls through the C# AOT sidecar.
- **Autonomous Vision**: Building an agent that can dynamically scale its "vision" to match any viewport resolution, allowing for true "Point and Click" autonomy on the web and desktop.
- **Product Identity**: Transitioning the project from a generic "Electron Boilerplate" to a cohesive, branded "Friday" platform.

## What we learned
- **Multimodal is the Future**: Voice and vision together create a much higher bandwidth for human-AI collaboration than text alone.
- **Native Power Matters**: While web technologies are great for UI, building a truly capable OS agent requires dropping down to native (C#) code for precision and performance.
- **Defensive Engineering is Key**: In the world of real-time AI, handling state transitions (Interruptions, Barge-ins, Reconnections) is just as important as the model's intelligence itself.
