// =========================================================================
// shared/tools-registry.js - Master Registry for Gemini Agent Tools
// Centralizes tool definitions for both VoiceClient and Async Sub-Agents.
// =========================================================================

const BrowserTools = [
    {
        name: "browser_navigate",
        description: "Navigate the browser to a URL.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string" }
            },
            required: ["url"]
        }
    },
    {
        name: "browser_get_dom",
        description: "Read the current browser page title, URL, and DOM text.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "browser_click",
        description: "Click a target on the browser page (text, selector, or x,y).",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "Text or CSS selector or x,y coordinates" }
            },
            required: ["target"]
        }
    },
    {
        name: "browser_type",
        description: "Type text into a target on the browser page.",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string" },
                text: { type: "string" }
            },
            required: ["target", "text"]
        }
    },
    {
        name: "browser_press_key",
        description: "Press a key on the browser page (e.g., Enter, Escape).",
        parameters: {
            type: "object",
            properties: {
                key: { type: "string" }
            },
            required: ["key"]
        }
    },
    {
        name: "browser_capture_screenshot",
        description: "Capture a screenshot of the active browser tab.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "evaluate_browser_js",
        description: "Execute JavaScript in the active browser tab.",
        parameters: {
            type: "object",
            properties: {
                script: { type: "string" }
            },
            required: ["script"]
        }
    },
    {
        name: "open_default_browser",
        description: "Open a URL in the user's default system browser.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string" }
            },
            required: ["url"]
        }
    },
    {
        name: "browser_back",
        description: "Navigate back in the browser history.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "browser_forward",
        description: "Navigate forward in the browser history.",
        parameters: { type: "object", properties: {} }
    }
];

const DesktopTools = [
    {
        name: "window_list",
        description: "List all currently open windows on the desktop (returns title and handle).",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "window_focus",
        description: "Bring a specific window to the foreground and focus it.",
        parameters: {
            type: "object",
            properties: {
                handle: { type: "number", description: "The window handle (HWND) to focus, obtained from window_list" }
            },
            required: ["handle"]
        }
    },
    {
        name: "window_close",
        description: "Close a specific window gracefully.",
        parameters: {
            type: "object",
            properties: {
                handle: { type: "number", description: "The window handle (HWND) to close, obtained from window_list" }
            },
            required: ["handle"]
        }
    },
    {
        name: "desktop_type_string",
        description: "Type a string into the currently focused application on the desktop.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string", description: "The text to type" }
            },
            required: ["text"]
        }
    },
    {
        name: "desktop_send_chord",
        description: "Send a keyboard shortcut. Examples: 'Ctrl+C', 'Alt+Tab', 'Win+E', 'Enter', 'Ctrl+Shift+Esc'.",
        parameters: {
            type: "object",
            properties: {
                chord: { type: "string", description: "The keyboard shortcut to send" }
            },
            required: ["chord"]
        }
    },
    {
        name: "desktop_click_at",
        description: "Click at specific screen coordinates.",
        parameters: {
            type: "object",
            properties: {
                x: { type: "number", description: "X coordinate" },
                y: { type: "number", description: "Y coordinate" }
            },
            required: ["x", "y"]
        }
    },
    {
        name: "desktop_find_element",
        description: "Find a UI element by name using Windows UI Automation. Returns element info if found.",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "The name or text of the element to find" },
                controlType: { type: "string", description: "Optional: Button, Edit, Text, Window, etc." }
            },
            required: ["name"]
        }
    },
    {
        name: "desktop_dump_tree",
        description: "Get a tree of UI elements of the currently focused window. Shows element names, types, and coordinates. Useful for understanding what's on screen before interacting.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "process_list",
        description: "List all running processes with visible windows. Returns name, PID, and memory usage. Use this to find processes to kill or focus.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "process_kill",
        description: "Terminate a process by its PID.",
        parameters: {
            type: "object",
            properties: {
                pid: { type: "number", description: "The Process ID (PID) to terminate" }
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
            type: "object",
            properties: {
                path: { type: "string", description: "The absolute path of the directory to list" }
            },
            required: ["path"]
        }
    },
    {
        name: "fs_read_file",
        description: "Read the text content of a file on the local file system.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "The absolute path of the file to read" }
            },
            required: ["path"]
        }
    },
    {
        name: "fs_write_file",
        description: "Write text content to a file on the local file system. Will overwrite if the file exists.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "The absolute path of the file to write to" },
                content: { type: "string", description: "The text content to write" }
            },
            required: ["path", "content"]
        }
    }
];

const SystemTools = [
    {
        name: "take_screenshot",
        description: "Captures a screenshot of the entire screen. Use this to verify the result of a tool call or to see what the user sees. Returns a JPEG image.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "browse_visual",
        description: "Delegate a complex browsing task to a specialized Visual Assistant. The assistant can 'see' the browser and interact with it precisely using screenshots. Use this for tasks that require high visual precision or multi-step navigation that might be difficult for the text-based browser tools. Returns immediately with a jobId.",
        parameters: {
            type: "object",
            properties: {
                taskDescription: { type: "string", description: "Detailed instructions for the visual assistant (e.g., 'Find the cheapest flight from JFK to LAX on Expedia')." }
            },
            required: ["taskDescription"]
        }
    },
    {
        name: "delegate_task",
        description: "Spawn a background sub-agent to complete a long-running or complex task asynchronously. The sub-agent has access to all your desktop and browser tools. This tool returns immediately with a jobId so you can keep talking to the user. You will be notified when it finishes.",
        parameters: {
            type: "object",
            properties: {
                taskDescription: { type: "string", description: "Detailed, step-by-step instructions for what the background agent should do. E.g. 'Navigate to gmail.com, find the compose button...'" }
            },
            required: ["taskDescription"]
        }
    },
    {
        name: "get_system_info",
        description: "Get comprehensive system information including CPU, Memory, Disk, Battery, and OS details.",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "show_notification",
        description: "Show a native OS notification to the user.",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "The title of the notification" },
                body: { type: "string", description: "The body text of the notification" }
            },
            required: ["title", "body"]
        }
    },
    {
        name: "show_message_dialog",
        description: "Show a native message box dialog with buttons. Returns the index of the clicked button.",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "The title of the dialog box" },
                message: { type: "string", description: "The message text" },
                type: { type: "string", description: "The type of dialog: info, warning, error, question" },
                buttons: { type: "array", items: { type: "string" }, description: "Array of button labels" }
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
            type: "object",
            properties: {
                summary: { type: "string", description: "Summary of what was done" }
            },
            required: ["summary"]
        }
    }
];

const WorldTools = [
    {
        name: "save_to_memory",
        description: "Save important facts, preferences, or entities to long-term memory for future recall.",
        parameters: {
            type: "object",
            properties: {
                content: { type: "string", description: "The fact or entity to remember." }
            },
            required: ["content"]
        }
    },
    {
        name: "search_memory",
        description: "Search long-term memory for facts, preferences, or past events using a semantic query.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "The query to search for." }
            },
            required: ["query"]
        }
    },
    {
        name: "analyze_document",
        description: "Extract a structured ontology (entities and relationships) from a text document or PDF content.",
        parameters: {
            type: "object",
            properties: {
                text: { type: "string", description: "The full text content of the document." }
            },
            required: ["text"]
        }
    },
    {
        name: "get_weather",
        description: "Perform a raw HTTP request (GET, POST, etc.). Useful for simple API interactions without a browser.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "The full URL of the request" },
                method: { type: "string", description: "The HTTP method (GET, POST, PUT, DELETE, etc.)", default: "GET" },
                data: { type: "object", description: "The request body for POST/PUT requests", properties: {} },
                params: { type: "object", description: "URL query parameters", properties: {} },
                headers: { type: "object", description: "HTTP headers", properties: {} }
            },
            required: ["url"]
        }
    },
    {
        name: "http_request",
        description: "Perform a raw HTTP request (GET, POST, etc.). Useful for simple API interactions without a browser.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "The full URL of the request" },
                method: { type: "string", description: "The HTTP method (GET, POST, PUT, DELETE, etc.)", default: "GET" },
                data: { type: "object", description: "The request body for POST/PUT requests", properties: {} },
                params: { type: "object", description: "URL query parameters", properties: {} },
                headers: { type: "object", description: "HTTP headers", properties: {} }
            },
            required: ["url"]
        }
    },
    {
        name: "get_user_profile",
        description: "Get the profile of the currently signed-in user (name, email, ID).",
        parameters: { type: "object", properties: {} }
    },
    {
        name: "web_search",
        description: "Search the web for information using physical/neural search (Exa). Returns a list of relevant links and titles. Best for finding specific sources or latest info.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "The search query" }
            },
            required: ["query"]
        }
    },
    {
        name: "web_deepdive",
        description: "Scrape a specific URL into clean, LLM-ready Markdown (Firecrawl). Use this when you need deep context from a specific page or link found during search.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "The URL to scrape" }
            },
            required: ["url"]
        }
    },
    {
        name: "silent_action",
        description: "Log a silent background action. Call this instead of speaking when taking ambient actions the user doesn't need to be interrupted for.",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", description: "One-line description of what was done" },
                category: { type: "string", enum: ["note", "file", "search", "prepare"] }
            },
            required: ["action"]
        }
    },
    {
        name: "browse_web",
        description: "Delegates a web browsing task to an autonomous browser agent. Use this for complex tasks like booking flights, filling forms, or multi-step research on specific sites. The agent will use your signed-in browser sessions.",
        parameters: {
            type: "object",
            properties: {
                task: { type: "string", description: "Detailed description of the task to perform in the browser." }
            },
            required: ["task"]
        }
    }
];

// Tool subset optimized for voice agents to stay under message size limits
const getVoiceTools = () => [
    // ── Desktop ─────────────────────────────────────────────────────
    { name: 'desktop_type_string',  description: 'Type text into the focused app.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'desktop_send_chord',   description: 'Send a keyboard shortcut e.g. Ctrl+C.',
      parameters: { type: 'object', properties: { chord: { type: 'string' } }, required: ['chord'] } },
    { name: 'desktop_click_at',     description: 'Click at screen coordinates x, y.',
      parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x','y'] } },
    { name: 'desktop_find_element', description: 'Find a UI element by name via Windows UIA.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, controlType: { type: 'string' } }, required: ['name'] } },
    { name: 'desktop_dump_tree',    description: 'Dump the UI element tree of the focused window.',
      parameters: { type: 'object', properties: {} } },
    // ── Window management ────────────────────────────────────────────
    { name: 'window_list',          description: 'List all open windows with titles and handles.',
      parameters: { type: 'object', properties: {} } },
    { name: 'window_focus',         description: 'Bring a window to the foreground by handle.',
      parameters: { type: 'object', properties: { handle: { type: 'number' } }, required: ['handle'] } },
    // ── Browser ─────────────────────────────────────────────────────
    { name: 'navigate_browser',     description: 'Navigate browser to URL. Must be in allowlist.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    { name: 'read_browser_dom',     description: 'Read the current page title, URL, and text.',
      parameters: { type: 'object', properties: {} } },
    { name: 'web_click',            description: 'Click an element by CSS selector or name.',
      parameters: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] } },
    { name: 'web_type',             description: 'Type text into a browser input field.',
      parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector','text'] } },
    { name: 'web_screenshot',       description: 'Screenshot the browser tab. annotated=true adds element labels.',
      parameters: { type: 'object', properties: { annotated: { type: 'boolean' } } } },
    { name: 'open_default_browser', description: 'Open a URL in the system browser for the user to see.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    { name: 'browser_back',         description: 'Navigate back in browser history.',
      parameters: { type: 'object', properties: {} } },
    // ── File system ──────────────────────────────────────────────────
    { name: 'fs_list_directory',    description: 'List contents of a local directory.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'fs_read_file',         description: 'Read a local text file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'fs_write_file',        description: 'Write text content to a file on the local file system.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'] } },
    // ── Web & world ──────────────────────────────────────────────────
    { name: 'web_search',           description: 'Search the web privately. Returns links and titles.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'web_deepdive',         description: 'Scrape a URL into clean markdown.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
    { name: 'silent_action',        description: 'Log a silent background action. Call this instead of speaking.',
      parameters: { type: 'object', properties: { action: { type: 'string' }, category: { type: 'string' } }, required: ['action'] } },
    // ── System & agents ──────────────────────────────────────────────
    { name: 'get_system_info',      description: 'Get CPU, RAM, OS, and battery info.',
      parameters: { type: 'object', properties: {} } },
    { name: 'show_notification',    description: 'Show a native OS notification.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title','body'] } },
    { name: 'take_screenshot',      description: 'Capture the full screen.',
      parameters: { type: 'object', properties: {} } },
    { name: 'delegate_task',        description: 'Spawn a background sub-agent for complex tasks.',
      parameters: { type: 'object', properties: { taskDescription: { type: 'string' } }, required: ['taskDescription'] } },
    { name: 'browse_visual',        description: 'Delegate to vision-based browser sub-agent.',
      parameters: { type: 'object', properties: { taskDescription: { type: 'string' } }, required: ['taskDescription'] } },
    { name: 'browse_web',           description: 'Delegate web tasks to an autonomous browser agent.',
      parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] } },
];

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
    getSubAgentTools,
    getVoiceTools
};
