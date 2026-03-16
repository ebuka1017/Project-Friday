const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LOG_PATH = path.join(app.getPath('userData'), 'friday-session-log.tsv');

// Initialize log with headers if it doesn't exist
if (!fs.existsSync(LOG_PATH)) {
    const headers = ['Timestamp', 'Tool', 'Status', 'Description', 'Result Snippet'].join('\t') + '\n';
    fs.writeFileSync(LOG_PATH, headers, 'utf8');
}

function logAction({ timestamp, tool, result, status, description }) {
    try {
        const line = [
            timestamp || new Date().toISOString(),
            tool,
            status, // 'success' | 'failed' | 'skipped'
            (description || '').replace(/\t/g, ' ').replace(/\n/g, ' '), // tsv-safe
            JSON.stringify(result || {}).slice(0, 200).replace(/\t/g, ' ').replace(/\n/g, ' ')
        ].join('\t') + '\n';

        fs.appendFileSync(LOG_PATH, line, 'utf8');
    } catch (err) {
        console.error('[SessionLog] Failed to write log:', err);
    }
}

module.exports = { logAction, LOG_PATH };
