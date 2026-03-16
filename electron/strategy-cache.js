const Store = require('electron-store');
// Handle ESM/CJS interop for electron-store
const store = new (Store.default || Store)({ name: 'friday-strategies' });

/**
 * Strategy Cache (Karpathy pattern)
 * Remembers which tools/actions worked for specific apps or contexts.
 */
class StrategyCache {
    recordOutcome(strategyKey, succeeded) {
        const current = store.get(strategyKey, { wins: 0, attempts: 0 });
        store.set(strategyKey, {
            wins: current.wins + (succeeded ? 1 : 0),
            attempts: current.attempts + 1,
            lastUsed: Date.now()
        });
        console.log(`[StrategyCache] Recorded ${succeeded ? 'WIN' : 'LOSS'} for ${strategyKey}`);
    }

    shouldTryStrategy(strategyKey, threshold = 0.4) {
        const s = store.get(strategyKey, { wins: 0, attempts: 0 });
        if (s.attempts < 3) return true; // Not enough data, give it a chance
        const winRate = s.wins / s.attempts;
        return winRate >= threshold;
    }

    getStats(strategyKey) {
        return store.get(strategyKey, { wins: 0, attempts: 0 });
    }
}

module.exports = new StrategyCache();
