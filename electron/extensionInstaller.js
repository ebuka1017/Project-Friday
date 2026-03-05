const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

// ─── Browser executable paths ───────────────────────────────────────────────

const BROWSER_PATHS = {
    chrome: [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        process.platform === "darwin"
            ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            : null,
        process.platform === "linux" ? "/usr/bin/google-chrome" : null,
        process.platform === "linux" ? "/usr/bin/chromium-browser" : null,
    ].filter(Boolean),

    edge: [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        process.platform === "darwin"
            ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
            : null,
        process.platform === "linux" ? "/usr/bin/microsoft-edge" : null,
    ].filter(Boolean),

    brave: [
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        process.platform === "darwin"
            ? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
            : null,
        process.platform === "linux" ? "/usr/bin/brave-browser" : null,
    ].filter(Boolean),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Find the first existing executable from a list of candidate paths.
 */
function findExecutable(candidates) {
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Detect all installed browsers and return a map of { name → exePath }.
 */
function detectBrowsers() {
    const found = {};
    for (const [name, candidates] of Object.entries(BROWSER_PATHS)) {
        const exe = findExecutable(candidates);
        if (exe) found[name] = exe;
    }
    return found;
}

/**
 * Launch a Chromium-based browser with the extension pre-loaded.
 *
 * @param {string} exePath     - Full path to browser executable
 * @param {string} extDir      - Absolute path to unpacked extension folder
 * @param {object} [opts]
 * @param {string} [opts.url]  - Optional URL to open
 * @returns {Promise<void>}
 */
function launchWithExtension(exePath, extDir, opts = {}) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(extDir)) {
            return reject(new Error(`Extension directory not found: ${extDir}`));
        }

        const manifestPath = path.join(extDir, "manifest.json");
        if (!fs.existsSync(manifestPath)) {
            return reject(
                new Error(`No manifest.json found in extension directory: ${extDir}`)
            );
        }

        const url = opts.url || "chrome://newtab";

        const args = [
            `--load-extension="${extDir}"`,
            "--no-first-run",
            "--no-default-browser-check",
            url,
        ];

        const cmd = `"${exePath}" ${args.join(" ")}`;

        exec(cmd, (err) => {
            if (err && err.code === "ENOENT") {
                return reject(new Error(`Browser not found at: ${exePath}`));
            }
            resolve();
        });
    });
}

// ─── Main exported API ───────────────────────────────────────────────────────

/**
 * Install an unpacked extension into one or more browsers automatically.
 */
async function installExtension(extensionDir, options = {}) {
    const installed = detectBrowsers();
    const requested = options.browsers || Object.keys(installed);

    const launched = [];
    const failed = [];

    for (const browserName of requested) {
        const exePath = installed[browserName];

        if (!exePath) {
            const err = `${browserName} not found on this machine`;
            failed.push({ browser: browserName, error: err });
            if (options.onStatus) options.onStatus({ browser: browserName, success: false, error: err });
            continue;
        }

        try {
            await launchWithExtension(exePath, extensionDir, { url: options.url });
            launched.push(browserName);
            if (options.onStatus) options.onStatus({ browser: browserName, success: true });
        } catch (e) {
            failed.push({ browser: browserName, error: e.message });
            if (options.onStatus) options.onStatus({
                browser: browserName,
                success: false,
                error: e.message,
            });
        }
    }

    return { launched, failed };
}

module.exports = { installExtension, detectBrowsers };
