require('dotenv').config();
const connectivityTester = require('./electron/connectivity-tester');

async function runTest() {
    console.log('--- Friday API Integration Test ---');
    const results = await connectivityTester.testAll();
    
    console.log('\nFinal Connectivity Results:');
    Object.entries(results).forEach(([svc, res]) => {
        let status = res.ok ? '✅ OK' : `❌ FAIL (${res.error})`;
        if (res.ok && res.warning) status = `⚠️ WARN (${res.warning})`;
        console.log(`${svc.padEnd(12)}: ${status}`);
    });
}

runTest().catch(err => {
    console.error('Test script failed:', err);
    process.exit(1);
});
