// ═══════════════════════════════════════════════════════════════════════
// electron/db.js — Friday Persistent Memory & Session Store
// Uses sqlite3 to store chat history, sub-agent traces, and context.
// ═══════════════════════════════════════════════════════════════════════

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app, safeStorage } = require('electron');
const fs = require('fs');

class DatabaseManager {
    constructor() {
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const userDataPath = app.getPath('userData');
            const dbPath = path.join(userDataPath, 'brain.sqlite');

            console.log(`[DB] Initializing database at: ${dbPath}`);

            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('[DB] Failed to connect to database', err);
                    return reject(err);
                }

                this._createTables().then(resolve).catch(reject);
            });
        });
    }

    _createTables() {
        const queries = [
            `CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                role TEXT,
                text TEXT,
                image TEXT,
                synced INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS memory (
                key TEXT PRIMARY KEY,
                value TEXT,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT,
                details TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run("PRAGMA foreign_keys = ON");
                let completed = 0;
                let hasError = false;

                queries.forEach((query) => {
                    this.db.run(query, (err) => {
                        if (err && !hasError) {
                            hasError = true;
                            reject(err);
                        }
                        completed++;
                        if (completed === queries.length && !hasError) {
                            // Run migrations
                            this._runMigrations().then(resolve).catch(reject);
                        }
                    });
                });
            });
        });
    }

    _runMigrations() {
        return new Promise((resolve) => {
            // Migration: Add image column
            this.db.run("ALTER TABLE messages ADD COLUMN image TEXT", () => {
                // Migration: Add synced column
                this.db.run("ALTER TABLE messages ADD COLUMN synced INTEGER DEFAULT 0", () => {
                    resolve();
                });
            });
        });
    }

    // ── Sessions ────────────────────────────────────────────────────────┐

    createSession(id, title = "New Session") {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO sessions (id, title) VALUES (?, ?)`,
                [id, title],
                function (err) {
                    if (err) reject(err);
                    else resolve(id);
                }
            );
        });
    }

    updateSessionTitle(id, title) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [title, id],
                function (err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    getSessions() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM sessions ORDER BY updated_at DESC`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    deleteSession(id) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `DELETE FROM sessions WHERE id = ?`,
                [id],
                function (err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    // ── Messages ────────────────────────────────────────────────────────┐

    saveMessage(id, sessionId, role, text, image = null, synced = 0) {
        // Code Review 2.4: strict input validation
        const validRoles = ['user', 'assistant', 'system', 'friday', 'action', 'result', 'thinking'];
        if (!validRoles.includes(role)) {
            console.warn(`[DB] Invalid role blocked: ${role}`);
            role = 'user';
        }
        
        // Length limits
        if (text && text.length > 500000) {
            text = text.substring(0, 500000) + "... [truncated due to length]";
        }
        
        // Session ID validation (UUID/simple format)
        if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) {
            return Promise.reject(new Error("Invalid session ID"));
        }

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO messages (id, session_id, role, text, image, synced) VALUES (?, ?, ?, ?, ?, ?)`,
                [id, sessionId, role, text, image, synced],
                function (err) {
                    if (err) return reject(err);

                    // Touch the session
                    this.db.run(`UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [sessionId], () => {});
                    resolve(id);
                }.bind(this)
            );
        });
    }

    getUnsyncedMessages() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM messages WHERE synced = 0 ORDER BY created_at ASC`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    markMessageSynced(id) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `UPDATE messages SET synced = 1 WHERE id = ?`,
                [id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    getMessages(sessionId, limit = 1000, offset = 0) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?`,
                [sessionId, limit, offset],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    // ── Memory (Key-Value) ──────────────────────────────────────────────┐

    setMemory(key, value, description = "") {
        // Code Review 2.4: Key/Value validation
        if (!key || typeof key !== 'string' || key.length > 128) return Promise.reject(new Error("Invalid memory key"));
        if (value && value.length > 1000000) value = value.substring(0, 1000000);

        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO memory (key, value, description) VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, description = excluded.description`,
                [key, value, description],
                function (err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    getMemory(key) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT value FROM memory WHERE key = ?`,
                [key],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row ? row.value : null);
                }
            );
        });
    }

    getAllMemories() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM memory ORDER BY created_at ASC`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    // ── Secrets (Encrypted) ─────────────────────────────────────────────┐

    setSecret(key, value) {
        return new Promise((resolve, reject) => {
            try {
                if (!safeStorage.isEncryptionAvailable()) {
                    // Fallback to plain if absolutely necessary, but log a warning
                    console.warn('[DB] Encryption not available. Storing secret as plain text.');
                    return this.setMemory(key, value, "Unencrypted Secret").then(resolve).catch(reject);
                }

                const encrypted = safeStorage.encryptString(value);
                this.db.run(
                    `INSERT INTO memory (key, value, description) VALUES (?, ?, ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value, description = excluded.description`,
                    [key, encrypted, "Encrypted Secret"],
                    function (err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            } catch (e) {
                reject(e);
            }
        });
    }

    getSecret(key) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT value FROM memory WHERE key = ?`,
                [key],
                (err, row) => {
                    if (err) return reject(err);
                    if (!row || !row.value) return resolve(null);

                    try {
                        // If it's a Buffer/Blob from SQLite, try to decrypt
                        if (Buffer.isBuffer(row.value) || row.value instanceof Uint8Array) {
                            if (!safeStorage.isEncryptionAvailable()) {
                                return reject(new Error('Encryption unavailable for decryption'));
                            }
                            const decrypted = safeStorage.decryptString(Buffer.from(row.value));
                            resolve(decrypted);
                        } else {
                            // Legacy plain text value
                            resolve(row.value);
                        }
                    } catch (e) {
                        console.error(`[DB] Decryption failed for key: ${key}`, e);
                        // If decryption fails, it might be plain text or corrupt
                        resolve(row.value);
                    }
                }
            );
        });
    }

    // ── Audit Logs ──────────────────────────────────────────────────────┐

    logAudit(action, details = "") {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO audit_logs (action, details) VALUES (?, ?)`,
                [action, typeof details === 'object' ? JSON.stringify(details) : String(details)],
                function (err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    getAuditLogs(limit = 100) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`,
                [limit],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = new DatabaseManager();
