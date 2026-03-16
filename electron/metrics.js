/**
 * Friday Metrics (Karpathy pattern)
 * Benchmarks Friday's performance. Focuses on the "Jarvis Demo" metrics.
 */
class MetricsCalculator {
    /**
     * Friday's version of "val_bpb" (lower is better).
     */
    computeResponseScore({ 
        latencyMs,       // Time from trigger to action complete
        correctActions,  // Did it do what the user expected?
        userInterrupts,  // How many times did user correct it?
        silentActions    // Actions performed without interrupting user
    }) {
        const latencyScore = Math.min(latencyMs / 3000, 1); // Normalize to 0-1 (3s = max)
        const accuracyScore = correctActions / (correctActions + userInterrupts + 0.001);
        const ambientScore = silentActions / (silentActions + userInterrupts + 0.001);
        
        // Weights: Accuracy (50%), Latency (30%), Ambient/Autonomy (20%)
        // LOWER IS BETTER
        const finalScore = (latencyScore * 0.3) + ((1 - accuracyScore) * 0.5) + ((1 - ambientScore) * 0.2);
        
        return {
            finalScore,
            latencyScore,
            accuracyScore,
            ambientScore
        };
    }
}

module.exports = new MetricsCalculator();
