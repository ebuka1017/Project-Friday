// popup.js — Connect button simply reloads the extension

const dot = document.getElementById('statusDot');
const text = document.getElementById('statusText');
const btn = document.getElementById('connectBtn');

// Check status
chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.connected) {
        dot.classList.remove('connected');
        text.classList.remove('connected');
        text.textContent = 'Disconnected';
        btn.textContent = 'Connect';
    } else {
        dot.classList.add('connected');
        text.classList.add('connected');
        text.textContent = 'Connected to Friday';
        btn.textContent = 'Reconnect';
    }
});

// Connect = full extension reload (cleanest way to reset the service worker)
btn.addEventListener('click', () => {
    chrome.runtime.reload();
});
