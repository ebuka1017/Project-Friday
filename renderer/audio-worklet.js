// ═══════════════════════════════════════════════════════════════════════
// renderer/audio-worklet.js — PCM Audio capture processor
// Runs in a background Web Audio API thread to chunk microphone data
// into 16kHz 16-bit PCM before sending to the VoiceClient.
// ═══════════════════════════════════════════════════════════════════════

class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048; // 2048 samples per chunk (128ms at 16kHz)
        this.buffer = new Float32Array(this.bufferSize);
        this.framesInQueue = 0;
        this.speechFrameCount = 0;
        this.thresholdToTrigger = 2; // Must see 2 consecutive speech frames (~256ms total)
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channel = input[0];

        // Calculate RMS (Energy) for VAD
        let sumSquared = 0;
        for (let i = 0; i < channel.length; i++) {
            sumSquared += channel[i] * channel[i];
            this.buffer[this.framesInQueue++] = channel[i];

            if (this.framesInQueue >= this.bufferSize) {
                const rms = Math.sqrt(sumSquared / this.bufferSize);

                // If RMS exceeds threshold (Raised to 0.05 to prevent feedback loops)
                if (rms > 0.05) {
                    this.speechFrameCount++;
                    if (this.speechFrameCount >= this.thresholdToTrigger) {
                        this.port.postMessage({ type: 'vad_speech', rms });
                    }
                } else {
                    this.speechFrameCount = 0; // Reset on silence/noise
                }

                // Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
                const int16Buffer = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                    let s = Math.max(-1, Math.min(1, this.buffer[j]));
                    int16Buffer[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                // Send PCM data to main thread
                this.port.postMessage({ type: 'audio_data', buffer: int16Buffer.buffer }, [int16Buffer.buffer]);

                // Reset
                this.framesInQueue = 0;
                sumSquared = 0;
                this.buffer = new Float32Array(this.bufferSize);
            }
        }

        return true;
    }
}

registerProcessor('recorder-worklet', RecorderProcessor);
