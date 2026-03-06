const si = require('systeminformation');

/**
 * Gathers comprehensive system information.
 */
async function getSystemInfo() {
    try {
        const [cpu, mem, battery, graphics, os, disk] = await Promise.all([
            si.cpu(),
            si.mem(),
            si.battery(),
            si.graphics(),
            si.osInfo(),
            si.fsSize()
        ]);

        return {
            cpu: {
                manufacturer: cpu.manufacturer,
                brand: cpu.brand,
                cores: cpu.cores,
                speed: cpu.speed
            },
            memory: {
                total: mem.total,
                free: mem.free,
                used: mem.used
            },
            battery: {
                hasBattery: battery.hasBattery,
                isCharging: battery.isCharging,
                percent: battery.percent
            },
            os: {
                platform: os.platform,
                distro: os.distro,
                release: os.release,
                hostname: os.hostname
            },
            graphics: graphics.controllers.map(c => ({
                model: c.model,
                vram: c.vram
            })),
            disks: disk.map(d => ({
                fs: d.fs,
                size: d.size,
                used: d.used,
                mount: d.mount
            }))
        };
    } catch (err) {
        console.error('[SysInfo] Error gathering info:', err);
        throw err;
    }
}

module.exports = {
    getSystemInfo
};
