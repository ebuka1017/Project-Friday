// ═══════════════════════════════════════════════════════════════════════
// electron/test-pipe.js — Sidecar IPC Smoke Test
// Run with: npm run test:pipe (or node electron/test-pipe.js)
// Tests Named Pipe connectivity and basic JSON-RPC communication.
// ═══════════════════════════════════════════════════════════════════════

const net = require('net');

const PIPE_PATH = '\\\\.\\pipe\\friday-sidecar';

async function main() {
    console.log('--- Friday Sidecar Pipe Test ---');
    console.log(`Connecting to: ${PIPE_PATH}`);

    const client = net.connect(PIPE_PATH);

    client.on('connect', async () => {
        console.log('✓ Connected to sidecar pipe\n');

        // Test 1: Ping
        await sendTest(client, 1, 'ping', {});

        // Test 2: UIA dump tree (desktop root, depth 1)
        await sendTest(client, 2, 'uia.dumpTree', { maxDepth: 1 });

        // Allow time for responses
        setTimeout(() => {
            console.log('\n--- Tests complete ---');
            client.destroy();
            process.exit(0);
        }, 3000);
    });

    // Handle responses
    let buffer = '';
    client.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const data = JSON.parse(line);
                    console.log(`  ← Response [id=${data.id}]:`, JSON.stringify(data.result || data.error, null, 2));
                } catch (e) {
                    console.log(`  ← Raw: ${line}`);
                }
            }
        }
    });

    client.on('error', (err) => {
        if (err.code === 'ENOENT') {
            console.error('✗ Sidecar pipe not found. Is the sidecar running?');
            console.error('  Start it with: dotnet run --project sidecar/Sidecar.csproj');
        } else {
            console.error('✗ Connection error:', err.message);
        }
        process.exit(1);
    });
}

function sendTest(client, id, method, params) {
    const msg = JSON.stringify({ id, method, params }) + '\n';
    console.log(`  → [id=${id}] ${method}(${JSON.stringify(params)})`);
    return new Promise((resolve) => {
        client.write(msg, 'utf-8', resolve);
    });
}

main();
