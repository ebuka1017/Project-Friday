// ═══════════════════════════════════════════════════════════════════════
// shared/constants.js — Centralized Friday Constants
// ═══════════════════════════════════════════════════════════════════════

const CONSTANTS = {
    // Inter-Process Communication
    PIPE_BUFFER_SIZE: 1_000_000, // 1MB limit for sidecar messages
    PIPE_TIMEOUT_MS: 30000,      // 30 seconds
    
    // Browser Server
    BROWSER_WS_PORT: 8765,
    CHROME_DEBUG_PORT: 9222,
    BROWSER_REQUEST_TIMEOUT_MS: 15000,
    BROWSER_TARGET_RESOLVE_RETRIES: 3,

    // Auth & Endpoints
    DEFAULT_CLERK_DOMAIN: 'clerk.algospend.tech',
    DEFAULT_CLERK_ACCOUNT_URL: 'https://accounts.algospend.tech/user',

    // Models
    DEFAULT_GEMINI_VOICE_MODEL: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
    DEFAULT_GEMINI_AGENT_MODEL: 'gemini-2.5-flash',
    DEFAULT_GEMINI_TEST_MODEL: 'models/gemini-3-flash-preview',
    
    // Zep Memory
    ZEP_PAGINATION_LIMIT: 100,
    ZEP_MAX_ITERATIONS: 500,
    
    // Voice / Audio
    AUDIO_SAMPLE_RATE_INPUT: 16000,
    AUDIO_SAMPLE_RATE_OUTPUT: 24000,
    VOICE_CHUNK_LIMIT_BYTES: 30000,
    
    // Security
    MAX_MESSAGE_TEXT_LENGTH: 200000,
    WHITESPACE_REGEX: /^\s*$/,
    VISION_INTERVAL_MS: 10000,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONSTANTS;
} else {
    window.FRIDAY_CONSTANTS = CONSTANTS;
}
