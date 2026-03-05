// ═══════════════════════════════════════════════════════════════════════
// extension/background.js
// Runs in the Chrome Extension background. Connects to Friday via WebSocket
// and uses chrome.debugger to execute commands on the active tab.
// ═══════════════════════════════════════════════════════════════════════

const FRIDAY_WS_URL = "ws://127.0.0.1:8765";
let ws = null;
let attachedTabId = null;

function connectToFriday() {
    console.log("[Friday Bridge] Connecting to", FRIDAY_WS_URL);
    ws = new WebSocket(FRIDAY_WS_URL);

    ws.onopen = () => {
        console.log("[Friday Bridge] Connected to Friday App!");
    };

    ws.onclose = () => {
        console.log("[Friday Bridge] Disconnected. Reconnecting in 3s...");
        setTimeout(connectToFriday, 3000);
    };

    ws.onerror = (err) => {
        console.error("[Friday Bridge] WebSocket error", err);
    };

    ws.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.method) {
                const result = await handleCommand(msg.method, msg.params);
                ws.send(JSON.stringify({ id: msg.id, result }));
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

// Keep connection alive
connectToFriday();

// ── Command Handling ───────────────────────────────────────────────────

async function handleCommand(method, params) {
    if (method === "navigate") {
        return await navigate(params.url);
    } else if (method === "getDOM") {
        return await getDOM();
    } else if (method === "evaluate") {
        return await evaluate(params.expression);
    }
    throw new Error(`Unknown method: ${method}`);
}

async function ensureDebugger() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) throw new Error("No active tab found");
    const tabId = tabs[0].id;

    if (attachedTabId !== tabId) {
        if (attachedTabId) {
            try { await chrome.debugger.detach({ tabId: attachedTabId }); } catch (e) { }
        }
        await chrome.debugger.attach({ tabId }, "1.3");
        attachedTabId = tabId;

        await chrome.debugger.sendCommand({ tabId }, "Page.enable");
        await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
        await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
    }
    return tabId;
}

// ── Commands ───────────────────────────────────────────────────────────

async function navigate(url) {
    const tabId = await ensureDebugger();
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand({ tabId }, "Page.navigate", { url }, (result) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));

            // Wait for load event
            const onEvent = (source, method, params) => {
                if (source.tabId === tabId && method === "Page.loadEventFired") {
                    chrome.debugger.onEvent.removeListener(onEvent);
                    resolve({ success: true, frameId: result.frameId });
                }
            };
            chrome.debugger.onEvent.addListener(onEvent);

            // Fallback timeout
            setTimeout(() => {
                chrome.debugger.onEvent.removeListener(onEvent);
                resolve({ success: true, note: "Timeout waiting for loadEventFired" });
            }, 8000);
        });
    });
}

async function getDOM() {
    const tabId = await ensureDebugger();
    return new Promise((resolve, reject) => {
        const expression = `
            (() => {
                return {
                    title: document.title,
                    url: window.location.href,
                    text: document.body.innerText.substring(0, 2000)
                };
            })()
        `;

        chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
            expression,
            returnByValue: true
        }, (result) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (result.exceptionDetails) return reject(new Error(result.exceptionDetails.exception.description));
            resolve(result.result.value);
        });
    });
}

async function evaluate(expression) {
    const tabId = await ensureDebugger();
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
            expression,
            returnByValue: true
        }, (result) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (result.exceptionDetails) return reject(new Error(result.exceptionDetails.exception.description));
            resolve(result.result.value);
        });
    });
}

// Handle detachment external to us
chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId === attachedTabId) {
        attachedTabId = null;
        console.log("[Friday Bridge] Debugger detached:", reason);
    }
});
