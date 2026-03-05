// ═══════════════════════════════════════════════════════════════════════
// renderer/audio-worklet.js — PCM Audio capture processor
// Runs in a background Web Audio API thread to chunk microphone data
// into 16kHz 16-bit PCM before sending to the VoiceClient.
// ═══════════════════════════════════════════════════════════════════════

class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096; // 4096 samples per chunk
        this.buffer = new Float32Array(this.bufferSize);
        this.framesInQueue = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channel = input[0];

        for (let i = 0; i < channel.length; i++) {
            this.buffer[this.framesInQueue++] = channel[i];

            if (this.framesInQueue >= this.bufferSize) {
                // Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
                const int16Buffer = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                    let s = Math.max(-1, Math.min(1, this.buffer[j]));
                    int16Buffer[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                // Send chunk to main thread
                this.port.postMessage(int16Buffer.buffer, [int16Buffer.buffer]);

                // Reset queue
                this.framesInQueue = 0;
                this.buffer = new Float32Array(this.bufferSize);
            }
        }

        return true;
    }
}

registerProcessor('recorder-worklet', RecorderProcessor);
