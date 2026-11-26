// ═══════════════════════════════════════════════════════════════════════
// electron/python-runner.js — Portable Python / uv Sidecar Launcher
// Resolves uv or python cleanly across machines instead of hardcoded paths.
// ═══════════════════════════════════════════════════════════════════════

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Resolve the executable and base args for running a Python sidecar script.
 * Prefers `uv run python`, falling back to `python` if `uv` is unavailable.
 */
function resolvePythonCommand(scriptPath) {
    const home = os.homedir();
    const candidates = [
        process.env.UV_PATH,
        path.join(home, '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'),
        path.join(home, '.cargo', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'),
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'uv', 'uv.exe') : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return { command: candidate, args: ['run', 'python', scriptPath] };
        }
    }

    const probeCmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const uvCheck = spawnSync(probeCmd, ['uv'], { stdio: 'ignore' });
    if (uvCheck.status === 0) {
        return { command: 'uv', args: ['run', 'python', scriptPath] };
    }

    const pyCommand = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
    return { command: pyCommand, args: [scriptPath] };
}

/**
 * Spawn a Python sidecar script with portable runner resolution.
 */
function spawnPythonScript(scriptPath, options = {}) {
    const { command, args } = resolvePythonCommand(scriptPath);
    return spawn(command, args, {
        stdio: options.stdio || ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: process.cwd(), ...(options.env || {}) },
        cwd: options.cwd || process.cwd(),
    });
}

module.exports = { resolvePythonCommand, spawnPythonScript };
