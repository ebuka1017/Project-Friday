# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-03-07

### Added
- **Visual Browser Assistant**: Integrated Gemini "Computer Use" (`gemini-2.5-computer-use-preview-10-2025`) for precise visual browsing tasks.
- **Auto-starting Extension**: Browser extension now connects automatically on browser startup using `chrome.runtime.onStartup` and a heartbeat mechanism.
- **Voice Tool Registry**: Optimized the toolset for Gemini Live to ensure fast and reliable connections under the 64KB WebSocket limit.

### Fixed
- **WebSocket 1007 Error**: Resolved "Invalid Frame Payload Data" by optimizing the `setup` message size and ensuring lowercase audio mime-types.
- **Sidecar Connection (ENOENT)**: Fixed process launcher to use the correct working directory, ensuring all native dependencies are found.
- **UI Polish**: Hidden external link icon on the profile button when the sidebar is collapsed.
- **Stability**: Implemented multi-listener pattern in the C# Sidecar to handle rapid reconnection attempts.

## [0.1.0] - 2026-03-01
- Initial release of Friday.
