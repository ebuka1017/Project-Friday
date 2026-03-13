# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-03-13
### Consolidate & Refine (Merge GCP to Main)
- **Branch Strategy**: Successfully merged production improvements from `GCP` branch while maintaining the **Google Generative AI SDK (AI Studio)** for live interactions.
- **Clerk Production**: Fully transitioned to `clerk.algospend.tech` with localized logout and dynamic account profile routing.
- **Website Refresh**: Added jargon-free index and legal pages ([Terms](file:///d:/Program%20Files/Project%20Friday/website/terms.html), [Privacy](file:///d:/Program%20Files/Project%20Friday/website/privacy.html)).
- **Sub-Agent Refactor**: Background sub-agents updated to use direct Gemini-2.0-Flash reasoning via AI Studio SDK.
- **UI Polish**: Simplified sign-out button label and removed redundant user metadata from sidebar.

### GCP Branch Specifics (Enterprise Strategy)
- **Vertex AI**: Implemented enterprise-grade reasoning via Vertex AI SDK for background tasks.
- **Cloud Connector**: Added `electron/cloud-connector.js` for remote hub tool execution.
- **Auth Hardening**: Integrated Google Application Default Credentials (ADC) for secure local-to-cloud handshakes.

## [0.2.0] - 2026-03-09
### Added
- **Global Branding**: Renamed "Electron" to "Friday" across all core services, comments, and internal handshakes.
- **Multi-Monitor Support**: Added absolute coordinate scaling for multi-monitor setups using Windows Virtual Desktop metrics.
- **IPC Lifecycle Events**: Added `connected` and `disconnected` events to the pipe client for better UI/Agent state synchronization.
- **UIA Safety Checks**: Implemented `IntPtr.Zero` validation for UI Automation patterns to prevent native sidecar crashes on unsupported elements.
- **Payload Decoupling**: Large tool results (>30KB) are now decoupled from the primary WebSocket frame and streamed via chunked `client_content` to prevent 1008 errors.

### Fixed
- **WebSocket 1011 (Internal Error)**: Resolved the server-side parsing error by restoring strict Protobuf compliance in the `turn_complete` frame.
- **Startup Freezes**: Replaced synchronous `execSync` with asynchronous cleanup logic in `sidecar-launcher.js`.
- **IPC Stability**: Added `EPIPE` guards and try/catch blocks to prevent main process crashes during sidecar disconnection.
- **Invisible Window Pollution**: Added bounds checking to the window listing tool to filter out zero-sized UWP background processes.

## [0.1.1] - 2026-03-08
### Added
- **Sub-Agent Loop Hardening**: Implemented 30s tool timeouts and "Continue" prompt logic for the specialist agent loop.
- **Dynamic Viewport Scaling**: Visual agents now auto-detect browser resolution before scaling coordinates.

### Fixed
- **Audio Overflows**: Optimized Base64 conversion with chunked processing to prevent stack overflows.

## [0.1.0] - 2026-03-07
### Added
- **Feature Complete Voice Sub-Agents**: Integrated specialist agents for Browser, Filesystem, and System inspection.
- **Hands-Free Mode**: Implemented persistence sessions and playback-synced mic auto-resumption.
- **Interruption Logic**: Refined barge-in logic with `isInterrupted` state management and frame blocking.
- **Grounded Search**: Integrated Google Search into the setup message for live web grounding.

### Fixed
- **Gemini Live Compliance**: Standardized on 16kHz PCM and snake_case payloads to eliminate 1007/1008 errors.

## [0.0.5] - 2026-03-06
### Added
- **Native Sidecar Integration**: Launched the C# AOT sidecar with Named Pipe IPC.
- **Windows Integration**: Added initial Shell, Filesystem, and UI Automation tools.

## [0.0.1] - 2026-03-05
### Added
- **Base Infrastructure**: Initial Electron project setup, layout, and tools registry.
- **Authentication**: Clerk-based login flow and secure token management.
- **Voice UI**: React-based HUD with Lottie animations for the agent.

---
*Note: Project Friday is an autonomous voice-native assistant for Windows.*
