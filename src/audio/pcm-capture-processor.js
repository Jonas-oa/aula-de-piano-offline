const CHUNK_SIZE = 2048;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.buffer = new Float32Array(CHUNK_SIZE);
    this.writeIndex = 0;
    this.frame = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type !== "enabled") return;
      this.enabled = Boolean(data.enabled);
      if (!this.enabled) this.writeIndex = 0;
    };
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!this.enabled || !channel) return true;

    let readIndex = 0;
    while (readIndex < channel.length) {
      const available = CHUNK_SIZE - this.writeIndex;
      const amount = Math.min(available, channel.length - readIndex);
      this.buffer.set(channel.subarray(readIndex, readIndex + amount), this.writeIndex);
      this.writeIndex += amount;
      readIndex += amount;
      this.frame += amount;

      if (this.writeIndex === CHUNK_SIZE) {
        const samples = this.buffer;
        this.port.postMessage({
          type: "pcm",
          samples,
          frame: this.frame,
        }, [samples.buffer]);
        this.buffer = new Float32Array(CHUNK_SIZE);
        this.writeIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
