export class OnsetEngine {
  constructor({ onOnset, onLevel, onError } = {}) {
    this.onOnset = onOnset || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onError = onError || (() => {});
    this.running = false;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.frameId = null;
    this.floor = 0.006;
    this.previousRms = 0;
    this.lastOnsetAt = -Infinity;
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não permite usar o microfone.");
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      this.context = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
      });
      await this.context.resume();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.buffer = new Float32Array(this.analyser.fftSize);
      this.source.connect(this.analyser);
      this.running = true;
      this.#loop();
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  async stop() {
    this.running = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
  }

  #loop = () => {
    if (!this.running || !this.analyser || !this.buffer) return;

    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const value of this.buffer) sum += value * value;
    const rms = Math.sqrt(sum / this.buffer.length);

    if (rms < this.floor * 1.7) {
      this.floor = this.floor * 0.985 + rms * 0.015;
    } else {
      this.floor = this.floor * 0.998 + rms * 0.002;
    }

    const rise = rms - this.previousRms;
    const now = performance.now();
    const threshold = Math.max(0.014, this.floor * 2.7);
    const isAttack = rms > threshold
      && rise > Math.max(0.0045, this.floor * 0.65)
      && now - this.lastOnsetAt > 75;

    this.onLevel(Math.min(1, rms / Math.max(threshold * 2.5, 0.04)));
    if (isAttack) {
      this.lastOnsetAt = now;
      this.onOnset(now);
    }

    this.previousRms = rms;
    this.frameId = requestAnimationFrame(this.#loop);
  };
}

export class MidiInput {
  constructor({ onNote, onStatus } = {}) {
    this.onNote = onNote || (() => {});
    this.onStatus = onStatus || (() => {});
    this.access = null;
    this.inputs = [];
  }

  async connect() {
    if (!navigator.requestMIDIAccess) {
      throw new Error("Web MIDI não está disponível neste navegador.");
    }
    this.access = await navigator.requestMIDIAccess();
    this.#bindInputs();
    this.access.onstatechange = () => this.#bindInputs();
    return this.inputs.length;
  }

  disconnect() {
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = [];
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.onStatus("disconnected", 0);
  }

  #bindInputs() {
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = [...this.access.inputs.values()];
    for (const input of this.inputs) {
      input.onmidimessage = (event) => {
        const [status, note, velocity] = event.data;
        if ((status & 0xf0) === 0x90 && velocity > 0) {
          this.onNote({ midi: note, velocity, timestamp: performance.now() });
        }
      };
    }
    this.onStatus(this.inputs.length ? "connected" : "empty", this.inputs.length);
  }
}
