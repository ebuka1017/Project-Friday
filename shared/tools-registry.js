// ═══════════════════════════════════════════════════════════════════════
// shared/tools-registry.js — Master Registry for Gemini Agent Tools
// Centralizes tool definitions for both VoiceClient and Async Sub-Agents.
// ═══════════════════════════════════════════════════════════════════════

const BrowserTools = [
    {
        name: "navigate_browser",
        description: "Navigate the browser to a URL. The URL must be in the user's allowlist.",
        parameters: {
            type: "OBJECT",
            properties: {
                url: { type: "STRING", description: "The full URL to navigate to" }
            },
            required: ["url"]
        }
    },
    {
        name: "read_browser_dom",
        description: "Read the current browser page title, URL, and DOM text. Useful for understanding what's on the screen.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "evaluate_browser_js",
        description: "Execute JavaScript in the active browser tab. Use for clicking, scrolling, extracting data.",
        parameters: {
            type: "OBJECT",
            properties: {
                script: { type: "STRING", description: "JavaScript code to execute" }
            },
            required: ["script"]
        }
    },
    {
        name: 'web_deepdive',
        description: 'Scrape a specific URL into Markdown for deep context or analysis.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'The absolute URL to scrape.' }
            },
            required: ['url']
        }
    },
    // ── Email Tools ──
    {
        name: 'gmail_list',
        description: 'List the 10 most recent email message IDs and snippets from Gmail.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'gmail_read',
        description: 'Read the full content of a specific Gmail message.',
        parameters: {
            type: 'object',
            properties: { id: { type: 'string', description: 'The message ID to read.' } },
            required: ['id']
        }
    },
    {
        name: 'gmail_send',
        description: 'Send a new email message via Gmail.',
        parameters: {
            type: 'object',
            properties: {
                to: { type: 'string', description: 'Recipient email address.' },
                subject: { type: 'string', description: 'Subject of the email.' },
                body: { type: 'string', description: 'Body text of the email.' }
            },
            required: ['to', 'subject', 'body']
        }
    },
    // ── Calendar Tools ──
    {
        name: 'calendar_google_list',
        description: 'List primary Google Calendar events.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'calendar_google_create',
        description: 'Create a new event in the primary Google Calendar.',
        parameters: {
            type: 'object',
            properties: {
                summary: { type: 'string', description: 'Event title.' },
                start: { type: 'object', description: 'Start time (e.g., {dateTime: "2024-03-10T10:00:00Z"}).' },
                end: { type: 'object', description: 'End time.' }
            },
            required: ['summary', 'start', 'end']
        }
    },
    // ── Drive Tools ──
    {
        name: 'drive_list',
        description: 'Search and list files in Google Drive.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Search query (e.g., "name contains \'report\'").' } }
        }
    },
    {
        name: 'drive_read',
        description: 'Get metadata and download/export links for a Google Drive file.',
        parameters: {
            type: 'object',
            properties: { fileId: { type: 'string', description: 'The file ID to read.' } },
            required: ['fileId']
        }
    },
    // ── Outlook/Graph Tools ──
    {
        name: 'outlook_list',
        description: 'List recent Outlook email messages.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: 'outlook_send',
        description: 'Send a new email via Outlook.',
        parameters: {
            type: 'object',
            properties: {
                to: { type: 'string', description: 'Recipient email.' },
                subject: { type: 'string', description: 'Subject.' },
                body: { type: 'string', description: 'Body content.' }
            },
            required: ['to', 'subject', 'body']
        }
    },
    {
        name: 'calendar_outlook_list',
        description: 'List recent Outlook calendar events.',
        parameters: { type: 'object', properties: {} }
    },
    {
        name: "open_default_browser",
        description: "Open a URL in the user's default system browser.",
        parameters: {
            type: "OBJECT",
            properties: {
                url: { type: "STRING", description: "The URL to open" }
            },
            required: ["url"]
        }
    },
    {
        name: "browser_back",
        description: "Navigate back in the browser history.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "browser_forward",
        description: "Navigate forward in the browser history.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "web_click",
        description: "Click an element on the webpage. Provide its CSS selector, its semantic accessible name (e.g. 'Submit Form'), or exact coordinates 'x,y' if taking an annotated screenshot.",
        parameters: {
            type: "OBJECT",
            properties: {
                target: { type: "STRING", description: "CSS selector, exact text name, or 'x,y'" }
            },
            required: ["target"]
        }
    },
    {
        name: "web_type",
        description: "Type text into an input field on the webpage. Provide its CSS selector, its semantic accessible name, or exact coordinates 'x,y'.",
        parameters: {
            type: "OBJECT",
            properties: {
                target: { type: "STRING", description: "CSS selector, exact text name, or 'x,y'" },
                text: { type: "STRING", description: "The text to type" }
            },
            required: ["target", "text"]
        }
    },
    {
        name: "web_screenshot",
        description: "Captures a screenshot of the active browser tab. If annotated is true, draws numbered boxes over interactive elements (Set-of-Marks) before capturing.",
        parameters: {
            type: "OBJECT",
            properties: {
                annotated: { type: "BOOLEAN", description: "If true, draws numbered boxes on elements." }
            }
        }
    }
];

const DesktopTools = [
    {
        name: "window_list",
        description: "List all currently open windows on the desktop (returns title and handle).",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "window_focus",
        description: "Bring a specific window to the foreground and focus it.",
        parameters: {
            type: "OBJECT",
            properties: {
                handle: { type: "NUMBER", description: "The window handle (HWND) to focus, obtained from window_list" }
            },
            required: ["handle"]
        }
    },
    {
        name: "window_close",
        description: "Close a specific window gracefully.",
        parameters: {
            type: "OBJECT",
            properties: {
                handle: { type: "NUMBER", description: "The window handle (HWND) to close, obtained from window_list" }
            },
            required: ["handle"]
        }
    },
    {
        name: "desktop_type_string",
        description: "Type a string into the currently focused application on the desktop.",
        parameters: {
            type: "OBJECT",
            properties: {
                text: { type: "STRING", description: "The text to type" }
            },
            required: ["text"]
        }
    },
    {
        name: "desktop_send_chord",
        description: "Send a keyboard shortcut. Examples: 'Ctrl+C', 'Alt+Tab', 'Win+E', 'Enter', 'Ctrl+Shift+Esc'.",
        parameters: {
            type: "OBJECT",
            properties: {
                chord: { type: "STRING", description: "The keyboard shortcut to send" } // Note: Sub-agents used 'keys' before, aligning to 'chord'
            },
            required: ["chord"]
        }
    },
    {
        name: "desktop_click_at",
        description: "Click at specific screen coordinates.",
        parameters: {
            type: "OBJECT",
            properties: {
                x: { type: "NUMBER", description: "X coordinate" },
                y: { type: "NUMBER", description: "Y coordinate" }
            },
            required: ["x", "y"]
        }
    },
    {
        name: "desktop_find_element",
        description: "Find a UI element by name using Windows UI Automation. Returns element info if found.",
        parameters: {
            type: "OBJECT",
            properties: {
                name: { type: "STRING", description: "The name or text of the element to find" },
                controlType: { type: "STRING", description: "Optional: Button, Edit, Text, Window, etc." }
            },
            required: ["name"]
        }
    },
    {
        name: "desktop_dump_tree",
        description: "Get a tree of UI elements of the currently focused window. Shows element names, types, and coordinates. Useful for understanding what's on screen before interacting.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "process_list",
        description: "List all running processes with visible windows. Returns name, PID, and memory usage. Use this to find processes to kill or focus.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "process_kill",
        description: "Terminate a process by its PID.",
        parameters: {
            type: "OBJECT",
            properties: {
                pid: { type: "NUMBER", description: "The Process ID (PID) to terminate" }
            },
            required: ["pid"]
        }
    }
];

const FileSystemTools = [
    {
        name: "fs_list_directory",
        description: "List the contents of a directory on the local file system.",
        parameters: {
            type: "OBJECT",
            properties: {
                path: { type: "STRING", description: "The absolute path of the directory to list" }
            },
            required: ["path"]
        }
    },
    {
        name: "fs_read_file",
        description: "Read the text content of a file on the local file system.",
        parameters: {
            type: "OBJECT",
            properties: {
                path: { type: "STRING", description: "The absolute path of the file to read" }
            },
            required: ["path"]
        }
    },
    {
        name: "fs_write_file",
        description: "Write text content to a file on the local file system. Will overwrite if the file exists.",
        parameters: {
            type: "OBJECT",
            properties: {
                path: { type: "STRING", description: "The absolute path of the file to write to" },
                content: { type: "STRING", description: "The text content to write" }
            },
            required: ["path", "content"]
        }
    }
];

const SystemTools = [
    {
        name: "take_screenshot",
        description: "Captures a screenshot of the entire screen. Use this to verify the result of a tool call or to see what the user sees. Returns a JPEG image.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "delegate_task",
        description: "Spawn a background sub-agent to complete a long-running or complex task asynchronously. The sub-agent has access to all your desktop and browser tools. This tool returns immediately with a jobId so you can keep talking to the user. You will be notified when it finishes.",
        parameters: {
            type: "OBJECT",
            properties: {
                taskDescription: { type: "STRING", description: "Detailed, step-by-step instructions for what the background agent should do. E.g. 'Navigate to gmail.com, find the compose button...'" }
            },
            required: ["taskDescription"]
        }
    },
    {
        name: "get_system_info",
        description: "Get comprehensive system information including CPU, Memory, Disk, Battery, and OS details.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "show_notification",
        description: "Show a native OS notification to the user.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "The title of the notification" },
                body: { type: "STRING", description: "The body text of the notification" }
            },
            required: ["title", "body"]
        }
    },
    {
        name: "show_message_dialog",
        description: "Show a native message box dialog with buttons. Returns the index of the clicked button.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "The title of the dialog box" },
                message: { type: "STRING", description: "The message text" },
                type: { type: "STRING", description: "The type of dialog: info, warning, error, question" },
                buttons: { type: "ARRAY", items: { type: "STRING" }, description: "Array of button labels" }
            },
            required: ["title", "message"]
        }
    }
];

const SubAgentOnlyTools = [
    {
        name: "finish_task",
        description: "Call this when the task is successfully completed.",
        parameters: {
            type: "OBJECT",
            properties: {
                summary: { type: "STRING", description: "Summary of what was done" }
            },
            required: ["summary"]
        }
    }
];

const WorldTools = [
    {
        name: "http_request",
        description: "Perform a raw HTTP request (GET, POST, etc.). Useful for simple API interactions without a browser.",
        parameters: {
            type: "OBJECT",
            properties: {
                url: { type: "STRING", description: "The full URL of the request" },
                method: { type: "STRING", description: "The HTTP method (GET, POST, PUT, DELETE, etc.)", default: "GET" },
                data: { type: "OBJECT", description: "The request body for POST/PUT requests" },
                params: { type: "OBJECT", description: "URL query parameters" },
                headers: { type: "OBJECT", description: "HTTP headers" }
            },
            required: ["url"]
        }
    },
    {
        name: "get_user_profile",
        description: "Get the profile of the currently signed-in user (name, email, ID).",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "web_search",
        description: "Search the web for information using physical/neural search (Exa). Returns a list of relevant links and titles. Best for finding specific sources or latest info.",
        parameters: {
            type: "OBJECT",
            properties: {
                query: { type: "STRING", description: "The search query" }
            },
            required: ["query"]
        }
    },
    {
        name: "web_deepdive",
        description: "Scrape a specific URL into clean, LLM-ready Markdown (Firecrawl). Use this when you need deep context from a specific page or link found during search.",
        parameters: {
            type: "OBJECT",
            properties: {
                url: { type: "STRING", description: "The URL to scrape" }
            },
            required: ["url"]
        }
    }
];

// Re-usable arrays for different contexts
const getAllTools = () => [
    ...BrowserTools,
    ...DesktopTools,
    ...FileSystemTools,
    ...SystemTools,
    ...WorldTools
];

const getSubAgentTools = () => [
    ...BrowserTools,
    ...DesktopTools,
    ...FileSystemTools,
    ...WorldTools,
    ...SubAgentOnlyTools
];

module.exports = {
    BrowserTools,
    DesktopTools,
    FileSystemTools,
    SystemTools,
    WorldTools,
    SubAgentOnlyTools,
    getAllTools,
    getSubAgentTools
};
