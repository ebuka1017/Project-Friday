// ═══════════════════════════════════════════════════════════════════════
// electron/pipe-client.js — Named Pipe IPC Client
// Connects to the C# sidecar via Windows Named Pipes (\\.\pipe\friday-sidecar)
// Uses newline-delimited JSON-RPC for message framing.
// ═══════════════════════════════════════════════════════════════════════

const net = require('net');
const EventEmitter = require('events');

const PIPE_PATH = '\\\\.\\pipe\\friday-sidecar-v2';
const MAX_RETRIES = 20;
const RETRY_DELAY_MS = 500;
const MAX_RECONNECT_ATTEMPTS = 50;
const RECONNECT_BASE_DELAY_MS = 1000;

class PipeClient extends EventEmitter {
  constructor() {
    super();
    this._client = null;
    this._msgId = 0;
    this._pending = new Map(); // id → { resolve, reject, timer }
    this._recvBuffer = '';
    this._connected = false;
    this._retries = 0;
    this._reconnectAttempts = 0;
    this._stopReconnect = false;
  }

  /**
   * Connect to the sidecar Named Pipe with automatic retry.
   * Returns a Promise that resolves when connected.
   */
  connect() {
    return new Promise((resolve, reject) => {
      const tryConnect = () => {
        this._client = net.connect(PIPE_PATH);

        this._client.on('connect', () => {
          console.log('[pipe] Connected to sidecar');
          this._connected = true;
          this._retries = 0;
          this._reconnectAttempts = 0; // Reset on successful connect
          resolve();
        });

        // Data arrives in arbitrary chunks — buffer and split on newlines
        this._client.on('data', (chunk) => {
          this._recvBuffer += chunk.toString('utf-8');
          const lines = this._recvBuffer.split('\n');
          // Keep the last (possibly partial) line in the buffer
          this._recvBuffer = lines.pop() || '';
          for (const line of lines) {
            if (line.trim()) this._handleResponse(line);
          }
        });

        this._client.on('error', (err) => {
          if (err.code === 'ENOENT' && this._retries < MAX_RETRIES) {
            // Pipe not yet created — sidecar still starting
            this._retries++;
            console.log(`[pipe] Sidecar not ready, retry ${this._retries}/${MAX_RETRIES}...`);
            setTimeout(tryConnect, RETRY_DELAY_MS);
          } else if (!this._connected) {
            reject(new Error(`[pipe] Failed to connect: ${err.message}`));
          } else {
            console.error('[pipe] Connection error:', err.message);
          }
        });

        this._client.on('close', () => {
          this._connected = false;
          console.log('[pipe] Disconnected from sidecar');
          // Reject all pending requests
          for (const [id, { reject: rej, timer }] of this._pending) {
            clearTimeout(timer);
            rej(new Error('Pipe disconnected'));
          }
          this._pending.clear();
          // Auto-reconnect with exponential backoff
          if (!this._stopReconnect && this._reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            this._reconnectAttempts++;
            const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(1.5, this._reconnectAttempts - 1), 10000);
            console.log(`[pipe] Reconnect attempt ${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${Math.round(delay)}ms...`);
            setTimeout(() => {
              this._retries = 0;
              tryConnect();
            }, delay);
          } else if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error('[pipe] Max reconnect attempts reached. Giving up.');
          }
        });
      };

      tryConnect();
    });
  }

  /**
   * Send a JSON-RPC request and return a Promise with the result.
   * @param {string} method - The RPC method name
   * @param {object} params - The parameters
   * @param {number} timeoutMs - Timeout in milliseconds (default 30s)
   */
  send(method, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this._connected) {
        return reject(new Error('[pipe] Not connected'));
      }

      const id = ++this._msgId;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`[pipe] Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this._pending.set(id, { resolve, reject, timer });

      const msg = JSON.stringify({ id, method, params }) + '\n';
      this._client.write(msg, 'utf-8');
    });
  }

  /**
   * Handle a response line from the sidecar.
   */
  _handleResponse(line) {
    try {
      const data = JSON.parse(line);

      // Check if this is an event (no id) vs a response
      if (data.event_type) {
        this.emit('event', data);
        return;
      }

      const { id, result, error } = data;
      const pending = this._pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this._pending.delete(id);
        if (error) {
          pending.reject(new Error(error));
        } else {
          pending.resolve(result);
        }
      }
    } catch (e) {
      console.error('[pipe] Failed to parse sidecar response:', line);
    }
  }

  /**
   * Disconnect cleanly.
   */
  disconnect() {
    if (this._client) {
      this._client.destroy();
      this._client = null;
      this._connected = false;
    }
  }

  get isConnected() {
    return this._connected;
  }
}

module.exports = new PipeClient();
