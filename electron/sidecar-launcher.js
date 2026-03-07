// ═══════════════════════════════════════════════════════════════════════
// electron/sidecar-launcher.js — C# Sidecar Process Manager
// Spawns and manages the lifecycle of the Native AOT sidecar binary.
// ═══════════════════════════════════════════════════════════════════════

const { spawn, execSync } = require('child_process');
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

    // Fallback: assume we're in production and it's in the resources folder
    const prodPaths = [
        path.join(process.resourcesPath, 'sidecar', 'Sidecar.exe'),
        path.join(process.resourcesPath, 'Sidecar.exe'),
        path.join(path.dirname(process.execPath), 'resources', 'sidecar', 'Sidecar.exe'),
        path.join(path.dirname(process.execPath), 'Sidecar.exe'),
        path.join(process.cwd(), 'Sidecar.exe'),
        path.join(process.cwd(), 'resources', 'sidecar', 'Sidecar.exe')
    ];

    for (const p of prodPaths) {
        if (fs.existsSync(p)) {
            console.log('[sidecar] Found in production at:', p);
            return p;
        }
    }

    console.error('[sidecar] Sidecar binary not found! Searched production and dev paths.');
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

    // Ensure no zombie sidecars are running
    try {
        execSync('taskkill /F /IM Sidecar.exe /T', { stdio: 'ignore' });
    } catch (e) { /* ignore if not running */ }

    sidecarProcess = spawn(exePath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: path.dirname(exePath)
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
