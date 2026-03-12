// ═══════════════════════════════════════════════════════════════════════
// electron/tool-executor.js — Local Tool Execution Bridge
// Handles synchronous and asynchronous local tool calls for Sub-Agents.
// ═══════════════════════════════════════════════════════════════════════

const searchTools = require('./search-tools');
const productivityTools = require('./productivity-tools');
const notificationTools = require('./notification-tools');
const networkTools = require('./network-tools');
const sysinfoTools = require('./sysinfo-tools');
const { getState } = require('./state');
const browserServer = require('./browser-server');
const pipeClient = require('./pipe-client');
const fsTools = require('./fs-tools');
const { shell } = require('electron');

class LocalToolExecutor {
    /**
     * Executes a Computer Use (visual) action.
     */
    async executeComputerUseAction(name, args) {
        let width = 1240;
        let height = 820;

        try {
            const dimensions = await browserServer.evaluate('({ w: window.innerWidth, h: window.innerHeight })');
            if (dimensions && dimensions.w && dimensions.h) {
                width = dimensions.w;
                height = dimensions.h;
            }
        } catch (e) {
            console.warn('[ToolExecutor] Failed to fetch viewport dimensions, using defaults:', e.message);
        }

        const scale = (val, max) => Math.floor((val / 1000) * max);

        if (name === "click_at" || name === "hover_at") {
            const x = scale(args.x, width);
            const y = scale(args.y, height);
            return await browserServer.clickTarget(`${x},${y}`);
        } else if (name === "type_text_at") {
            const x = scale(args.x, width);
            const y = scale(args.y, height);
            return await browserServer.typeTarget(`${x},${y}`, args.text);
        } else if (name === "navigate") {
            return await browserServer.navigate(args.url);
        } else if (name === "go_back") {
            return await browserServer.goBack();
        } else if (name === "go_forward") {
            return await browserServer.goForward();
        } else if (name === "scroll_document") {
            const script = `window.scrollBy({ top: ${args.direction === 'down' ? 500 : (args.direction === 'up' ? -500 : 0)}, left: ${args.direction === 'right' ? 500 : (args.direction === 'left' ? -500 : 0)}, behavior: 'smooth' });`;
            await browserServer.evaluate(script);
            return { success: true };
        } else if (name === "open_web_browser") {
            return { success: true, message: "Browser already open." };
        } else if (name === "wait_5_seconds") {
            await new Promise(r => setTimeout(r, 5000));
            return { success: true };
        }

        throw new Error(`Computer Use action ${name} not implemented.`);
    }

    /**
     * Executes a native (background agent) tool.
     */
    async executeNativeTool(name, args) {
        const state = getState();
        const userId = state.currentUser?.id;

        // Desktop
        if (name === 'desktop_type_string') {
            return await pipeClient.send('input.typeString', { text: args.text });
        } else if (name === 'desktop_send_chord') {
            return await pipeClient.send('input.sendChord', { keys: args.chord });
        } else if (name === 'desktop_click_at') {
            return await pipeClient.send('input.clickAt', { x: args.x, y: args.y });
        } else if (name === 'desktop_find_element') {
            const params = { name: args.name };
            if (args.controlType) params.controlType = args.controlType;
            return await pipeClient.send('uia.findElement', params);
        } else if (name === 'desktop_dump_tree') {
            return await pipeClient.send('uia.dumpTree', {});
        } else if (name === 'process_list') {
            return await pipeClient.send('process.list', {});
        } else if (name === 'process_kill') {
            return await pipeClient.send('process.kill', { pid: args.pid });
        }
        // Window Management
        else if (name === 'window_list') {
            return await pipeClient.send('window.list', {});
        } else if (name === 'window_focus') {
            return await pipeClient.send('window.focus', { handle: args.handle });
        } else if (name === 'window_close') {
            return await pipeClient.send('window.close', { handle: args.handle });
        }
        // Browser
        else if (name === 'navigate_browser') {
            return await browserServer.navigate(args.url);
        } else if (name === 'read_browser_dom') {
            return await browserServer.getDOM();
        } else if (name === 'evaluate_browser_js') {
            return await browserServer.evaluate(args.script);
        } else if (name === 'open_default_browser') {
            await shell.openExternal(args.url);
            return { success: true };
        } else if (name === 'browser_back') {
            return await browserServer.goBack();
        } else if (name === 'browser_forward') {
            return await browserServer.goForward();
        } else if (name === 'web_click') {
            return await browserServer.clickTarget(args.selector);
        } else if (name === 'web_type') {
            return await browserServer.typeTarget(args.selector, args.text);
        }
        // File System
        else if (name === 'fs_list_directory') {
            return await fsTools.listDirectory(args.path);
        } else if (name === 'fs_read_file') {
            return await fsTools.readFileStr(args.path);
        } else if (name === 'fs_write_file') {
            return await fsTools.writeFileStr(args.path, args.content);
        }
        // World / Search
        else if (name === 'web_search') {
            return await searchTools.webSearch(args.query);
        } else if (name === 'web_deepdive') {
            return await searchTools.webDeepdive(args.url);
        }
        // Productivity (Gmail)
        else if (name === 'gmail_list') {
            if (!userId) return { error: 'AUTH_REQUIRED: User not signed in' };
            return await productivityTools.gmailList(userId);
        } else if (name === 'gmail_read') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.gmailRead(userId, args.id);
        } else if (name === 'gmail_send') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.gmailSend(userId, args);
        }
        // Google Cal
        else if (name === 'calendar_google_list') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.calendarGoogleList(userId);
        } else if (name === 'calendar_google_create') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.calendarGoogleCreate(userId, args);
        }
        // Google Drive
        else if (name === 'drive_list') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.driveList(userId, args.query);
        } else if (name === 'drive_read') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.driveRead(userId, args.fileId);
        }
        // Outlook
        else if (name === 'outlook_list') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.outlookList(userId);
        } else if (name === 'outlook_send') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.outlookSend(userId, args);
        } else if (name === 'calendar_outlook_list') {
            if (!userId) return { error: 'AUTH_REQUIRED' };
            return await productivityTools.calendarOutlookList(userId);
        }
        // System / Notification
        else if (name === 'get_system_info') {
            return await sysinfoTools.getSystemInfo();
        } else if (name === 'show_notification') {
            return notificationTools.showNotification(args.title, args.body);
        } else if (name === 'show_message_dialog') {
            return await notificationTools.showMessageDialog(args);
        } else if (name === 'http_request') {
            return await networkTools.httpRequest(args);
        } else if (name === 'get_user_profile') {
            const profile = await getState().currentUser;
            return profile || { error: 'Not signed in' };
        }

        throw new Error(`Unknown tool: ${name}`);
    }
}

module.exports = new LocalToolExecutor();
