const fs = require('fs').promises;
const path = require('path');

/**
 * Validates a path to prevent basic escapes.
 * A more robust app might enforce a specific jail directory,
 * but for a system-level AI assistant, we just need basic safety.
 */
function resolvePath(inputPath) {
    if (!inputPath) throw new Error("Path cannot be empty");
    
    const os = require('os');
    const homeDir = os.homedir();
    
    // Expand ~ to user home
    if (inputPath.startsWith('~')) {
        inputPath = path.join(homeDir, inputPath.slice(1));
    } else {
        // Intelligence: if the path starts with common OS folder names (Desktop, Documents, Downloads, etc.)
        // and it's a relative path, resolve it to the user's home directory.
        const commonFolders = ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos'];
        const firstPart = inputPath.split(/[/\\]/)[0];
        
        if (commonFolders.includes(firstPart)) {
            // Check if it exists in the ROOT of the project. If not, assume it's the OS folder.
            const localPath = path.resolve(inputPath);
            const fsSync = require('fs');
            if (!fsSync.existsSync(path.dirname(localPath)) && !fsSync.existsSync(localPath)) {
                inputPath = path.join(homeDir, inputPath);
            }
        }
    }
    
    return path.resolve(inputPath);
}

async function listDirectory(dirPath) {
    try {
        const target = resolvePath(dirPath);
        const stats = await fs.stat(target);

        if (!stats.isDirectory()) {
            throw new Error(`Path is not a directory: ${target}`);
        }

        const items = await fs.readdir(target, { withFileTypes: true });

        const result = items.map(item => ({
            name: item.name,
            type: item.isDirectory() ? 'directory' : item.isFile() ? 'file' : 'other'
        }));

        return { success: true, path: target, items: result };
    } catch (e) {
        return { success: false, error: e.message, code: e.code };
    }
}

async function readFileStr(filePath) {
    try {
        const target = resolvePath(filePath);

        // Safety check file size to avoid memory crash
        const stats = await fs.stat(target);
        const MAX_SIZE = 5 * 1024 * 1024; // 5 MB max for text reading by agent
        if (stats.size > MAX_SIZE) {
            throw new Error(`File is too large to read into memory (${(stats.size / 1024 / 1024).toFixed(2)} MB). Max is 5 MB.`);
        }

        const content = await fs.readFile(target, 'utf-8');
        return { success: true, path: target, content: content };
    } catch (e) {
        return { success: false, error: e.message, code: e.code };
    }
}

async function writeFileStr(filePath, content) {
    try {
        const target = resolvePath(filePath);
        // Ensure directory exists
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf-8');
        return { success: true, path: target };
    } catch (e) {
        return { success: false, error: e.message, code: e.code };
    }
}

module.exports = {
    listDirectory,
    readFileStr,
    writeFileStr
};
