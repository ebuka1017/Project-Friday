// ═══════════════════════════════════════════════════════════════════════
// electron/sidecar-launcher.js — C# Sidecar Process Manager
// Spawns and manages the lifecycle of the Native AOT sidecar binary.
// ═══════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let sidecarProcess = null;

/**
 * Resolve the path to the sidecar executable.
 * In dev mode: look in sidecar/bin/Debug or publish folder.
 * In production: look next to the Electron binary.
 */
function getSidecarPath() {
    const devPaths = [
        path.join(__dirname, '..', 'sidecar', 'bin', 'Release', 'net9.0-windows', 'win-x64', 'publish', 'Sidecar.exe'),
        path.join(__dirname, '..', 'sidecar', 'bin', 'Debug', 'net9.0-windows', 'win-x64', 'Sidecar.exe'),
        path.join(__dirname, '..', 'sidecar', 'bin', 'Release', 'net9.0-windows', 'win-x64', 'Sidecar.exe'),
        path.join(__dirname, '..', 'sidecar', 'bin', 'Debug', 'net9.0-windows', 'Sidecar.exe'),
    ];

    for (const p of devPaths) {
        if (fs.existsSync(p)) {
            console.log('[sidecar] Found at:', p);
            return p;
        }
    }

    // Fallback: assume we're in production and it's next to us
    const prodPath = path.join(process.resourcesPath || __dirname, 'sidecar', 'Sidecar.exe');
    if (fs.existsSync(prodPath)) return prodPath;

    console.error('[sidecar] Sidecar binary not found! Searched:', devPaths.join('\n'));
    return null;
}

/**
 * Launch the sidecar process.
 * @returns {boolean} true if launched, false if binary not found
 */
function launch() {
    const exePath = getSidecarPath();
    if (!exePath) {
        console.error('[sidecar] Cannot launch — binary not found.');
        console.error('[sidecar] Run: dotnet build sidecar/Sidecar.csproj');
        return false;
    }

    console.log('[sidecar] Launching:', exePath);

    sidecarProcess = spawn(exePath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });

    // Forward sidecar stdout/stderr to Electron console
    sidecarProcess.stdout.on('data', (data) => {
        process.stdout.write(`[sidecar:out] ${data}`);
    });

    sidecarProcess.stderr.on('data', (data) => {
        process.stderr.write(`[sidecar:err] ${data}`);
    });

    sidecarProcess.on('exit', (code, signal) => {
        console.log(`[sidecar] Process exited with code ${code}, signal ${signal}`);
        sidecarProcess = null;
    });

    sidecarProcess.on('error', (err) => {
        console.error('[sidecar] Failed to start:', err.message);
        sidecarProcess = null;
    });

    return true;
}

/**
 * Kill the sidecar process gracefully.
 */
function kill() {
    if (sidecarProcess) {
        console.log('[sidecar] Killing sidecar process...');
        sidecarProcess.kill('SIGTERM');
        sidecarProcess = null;
    }
}

/**
 * Check if the sidecar is running.
 */
function isRunning() {
    return sidecarProcess !== null && !sidecarProcess.killed;
}

module.exports = { launch, kill, isRunning };
