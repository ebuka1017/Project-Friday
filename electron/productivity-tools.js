// electron/productivity-tools.js
const axios = require('axios');
const clerkTokens = require('./clerk-tokens');

/**
 * Helper to get the token and handle auth errors.
 */
async function getAuthToken(userId, provider) {
    const token = await clerkTokens.getOAuthToken(userId, provider);
    if (!token) {
        throw new Error(`AUTH_REQUIRED: No ${provider} token found. Please link your account in Settings.`);
    }
    return token;
}

// ─── GMAIL ───────────────────────────────────────────────────────────────────

async function gmailList(userId) {
    const token = await getAuthToken(userId, 'oauth_google');
    const res = await axios.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
        params: { maxResults: 10 },
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
}

async function gmailRead(userId, messageId) {
    const token = await getAuthToken(userId, 'oauth_google');
    const res = await axios.get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
}

async function gmailSend(userId, { to, subject, body }) {
    const token = await getAuthToken(userId, 'oauth_google');
    const rawContent = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;
    const encoded = Buffer.from(rawContent).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const res = await axios.post('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        { raw: encoded },
        { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data;
}

// ─── GOOGLE CALENDAR ─────────────────────────────────────────────────────────

async function calendarGoogleList(userId) {
    const token = await getAuthToken(userId, 'oauth_google');
    const res = await axios.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
}

async function calendarGoogleCreate(userId, event) {
    const token = await getAuthToken(userId, 'oauth_google');
    const res = await axios.post('https://www.googleapis.com/calendar/v3/calendars/primary/events',
        event,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data;
}

// ─── GOOGLE DRIVE ───────────────────────────────────────────────────────────

async function driveList(userId, query) {
    const token = await getAuthToken(userId, 'oauth_google');
    const res = await axios.get('https://www.googleapis.com/drive/v3/files', {
        params: { q: query || "name contains ''", fields: "files(id, name, mimeType)" },
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
}

async function driveRead(userId, fileId) {
    const token = await getAuthToken(userId, 'oauth_google');

    // 1. Get metadata to check mimeType
    const meta = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        params: { fields: "id, name, mimeType" },
        headers: { Authorization: `Bearer ${token}` }
    });

    const { mimeType, name } = meta.data;

    // 2. If it's a Google Doc, export to plain text
    if (mimeType.startsWith('application/vnd.google-apps.')) {
        const exportMime = 'text/plain';
        const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}/export`, {
            params: { mimeType: exportMime },
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'text'
        });
        return { name, mimeType, content: res.data };
    }

    // 3. If it's a text/md file, download directly
    if (mimeType.includes('text') || mimeType.includes('markdown') || mimeType.includes('json')) {
        const res = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
            params: { alt: 'media' },
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'text'
        });
        return { name, mimeType, content: res.data };
    }

    // 4. Otherwise, just return metadata + a note
    return {
        name,
        mimeType,
        message: "This file type is not directly readable as text. Use a dedicated tool or browser to view."
    };
}

// ─── MICROSOFT GRAPH (OUTLOOK) ────────────────────────────────────────────────

async function outlookList(userId) {
    const token = await getAuthToken(userId, 'oauth_microsoft');
    const res = await axios.get('https://graph.microsoft.com/v1.0/me/messages', {
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
}

async function outlookSend(userId, { to, subject, body }) {
    const token = await getAuthToken(userId, 'oauth_microsoft');
    const res = await axios.post('https://graph.microsoft.com/v1.0/me/sendMail',
        {
            message: {
                subject: subject,
                body: { contentType: "Text", content: body },
                toRecipients: [{ emailAddress: { address: to } }]
            }
        },
        { headers: { Authorization: `Bearer ${token}` } }
    );
    return { status: "Sent" };
}

async function calendarOutlookList(userId) {
    const token = await getAuthToken(userId, 'oauth_microsoft');
    const res = await axios.get('https://graph.microsoft.com/v1.0/me/events', {
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.data;
}

module.exports = {
    gmailList, gmailRead, gmailSend,
    calendarGoogleList, calendarGoogleCreate,
    driveList, driveRead,
    outlookList, outlookSend, calendarOutlookList
};
