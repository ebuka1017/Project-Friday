// ═══════════════════════════════════════════════════════════════════════
// extension/background.js
// Runs in the Chrome Extension background. Connects to Friday via WebSocket
// and uses chrome.debugger to execute commands on the active tab.
// ═══════════════════════════════════════════════════════════════════════

const FRIDAY_WS_URL = "ws://127.0.0.1:8765";
let ws = null;
let attachedTabId = null;
let connectionPending = false;
const clientId = Math.random().toString(36).substring(2, 10);

function connectToFriday() {
    if (connectionPending || (ws && ws.readyState === WebSocket.OPEN)) {
        return;
    }

    console.log(`[Friday Bridge] Connecting to ${FRIDAY_WS_URL} (ID: ${clientId})`);
    connectionPending = true;
    ws = new WebSocket(`${FRIDAY_WS_URL}?clientId=${clientId}`);

    ws.onopen = () => {
        console.log("[Friday Bridge] Connected to Friday App!");
        connectionPending = false;
        // Notify Friday that we are ready
        ws.send(JSON.stringify({ event: 'ready', clientId }));
    };

    ws.onclose = (event) => {
        connectionPending = false;
        if (event.code === 4000) {
            console.log("[Friday Bridge] Replaced by another instance. Stopping reconnect.");
            return;
        }
        console.log("[Friday Bridge] Disconnected. Reconnecting in 5s...");
        setTimeout(connectToFriday, 5000);
    };

    ws.onerror = (err) => {
        console.error("[Friday Bridge] WebSocket error", err);
        connectionPending = false;
    };

    ws.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.method === 'cdp') {
                const result = await handleCDP(msg.params.command, msg.params.args);
                ws.send(JSON.stringify({ id: msg.id, result }));
            } else if (msg.method === 'browser_create_tab') {
                const tab = await chrome.tabs.create({ url: msg.params.url });
                // We don't attach immediately, the next CDP command will attach to active tab
                // or we could explicitly attach here. Let's return the tabId.
                ws.send(JSON.stringify({ id: msg.id, result: { tabId: tab.id } }));
            }
        } catch (err) {
            console.error("[Friday Bridge] Command error:", err);
            try {
                const id = JSON.parse(event.data).id;
                if (id) ws.send(JSON.stringify({ id, error: err.message }));
            } catch (e) { }
        }
    };
}

// CDP tunnel implementation
async function handleCDP(command, args = {}) {
    // If command is directed at a specific tab, use that, otherwise use active
    const targetTabId = args._tabId;
    delete args._tabId;

    const tabId = await ensureDebugger(targetTabId);
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand({ tabId }, command, args, (result) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(result || {});
        });
    });
}

async function ensureDebugger(targetTabId = null) {
    let tabId = targetTabId;
    
    if (!tabId) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs || tabs.length === 0) throw new Error("No active tab found");
        tabId = tabs[0].id;
    }

    if (attachedTabId !== tabId) {
        if (attachedTabId) {
            try { await chrome.debugger.detach({ tabId: attachedTabId }); } catch (e) { }
        }
        await chrome.debugger.attach({ tabId }, "1.3");
        attachedTabId = tabId;

        // Auto-enable standard domains
        await chrome.debugger.sendCommand({ tabId }, "Page.enable");
        await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
        await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
        await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable");
    }
    return tabId;
}

// Connect on browser start or extension update
chrome.runtime.onStartup.addListener(() => connectToFriday());
chrome.runtime.onInstalled.addListener(() => connectToFriday());
connectToFriday();

// Handle detachment external to us
chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId === attachedTabId) {
        attachedTabId = null;
        console.log("[Friday Bridge] Debugger detached:", reason);
    }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getStatus') {
        sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
    } else if (msg.type === 'reconnect') {
        if (ws) { try { ws.close(); } catch (e) {} ws = null; }
        connectionPending = false;
        connectToFriday();
        sendResponse({ ok: true });
    }
    return true;
});
