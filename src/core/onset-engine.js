// Quadro de análise. O reconhecimento de altura quer uma janela longa (quanto
// maior, melhor separa semitons graves); o detector de ataque quer uma janela
// curta (quanto menor, mais cedo percebe a batida). Em vez de escolher um meio
// termo ruim para os dois, usamos o quadro inteiro para a altura e só a cauda
// mais recente para o ataque.
const FRAME_SIZE = 8192;      // ~170 ms a 48 kHz
const ONSET_TAIL = 2048;      // ~43 ms mais recentes
const POLL_INTERVAL_MS = 12;  // cadência própria, independente da tela
const LEVEL_INTERVAL_MS = 50; // o medidor não precisa de mais que isso

function rmsOf(samples) {
  let squares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    squares += samples[index] * samples[index];
  }
  return Math.sqrt(squares / samples.length);
}

export class OnsetEngine {
  constructor({
    onOnset,
    onLevel,
    onSamples,
    onError,
    onStatus,
  } = {}) {
    this.onOnset = onOnset || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onSamples = onSamples || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.onsetTail = null;
    this.timerId = null;
    this.floor = 0.006;
    this.previousRms = 0;
    this.lastOnsetAt = -Infinity;
    this.lastLevelAt = -Infinity;
    this.startPromise = null;
    this.startGeneration = 0;
  }

  async start() {
    if (this.running) {
      this.onStatus("active");
      return;
    }
    if (this.startPromise) return this.startPromise;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não permite usar o microfone.");
    }

    const generation = ++this.startGeneration;
    const pending = this.#open(generation);
    this.startPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.startPromise === pending) this.startPromise = null;
    }
  }

  async #open(generation) {
    let stream = null;
    let context = null;
    let source = null;
    let analyser = null;
    try {
      this.onStatus("requesting");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      if (generation !== this.startGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
      });
      await context.resume();
      if (generation !== this.startGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = FRAME_SIZE;
      analyser.smoothingTimeConstant = 0;
      this.stream = stream;
      this.context = context;
      this.source = source;
      this.analyser = analyser;
      this.buffer = new Float32Array(analyser.fftSize);
      this.onsetTail = this.buffer.subarray(this.buffer.length - ONSET_TAIL);
      source.connect(analyser);
      this.running = true;
      this.onStatus("active");
      this.#tick();
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      source?.disconnect();
      analyser?.disconnect();
      if (context && context.state !== "closed") await context.close();
      if (generation !== this.startGeneration) return;
      this.running = false;
      this.stream = null;
      this.context = null;
      this.source = null;
      this.analyser = null;
      this.buffer = null;
      this.onsetTail = null;
      this.onStatus("error");
      this.onError(error);
      throw error;
    }
  }

  async stop() {
    this.startGeneration += 1;
    this.startPromise = null;
    this.running = false;
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.onsetTail = null;
    this.previousRms = 0;
    this.lastOnsetAt = -Infinity;
    this.onStatus("stopped");
  }

  // A cadência é própria, e não a da tela. Com requestAnimationFrame a escuta
  // parava junto com o desenho — justamente quando o aparelho fica apoiado no
  // piano, com a tela escurecendo — e variava entre telas de 60 e 120 Hz.
  #tick = () => {
    if (!this.running || !this.analyser || !this.buffer) return;

    this.analyser.getFloatTimeDomainData(this.buffer);
    const now = performance.now();
    const rms = rmsOf(this.onsetTail);

    if (rms < this.floor * 1.7) {
      this.floor = this.floor * 0.985 + rms * 0.015;
    } else {
      this.floor = this.floor * 0.998 + rms * 0.002;
    }

    const rise = rms - this.previousRms;
    const threshold = Math.max(0.014, this.floor * 2.7);
    const isAttack = rms > threshold
      && rise > Math.max(0.0045, this.floor * 0.65)
      && now - this.lastOnsetAt > 75;

    if (now - this.lastLevelAt >= LEVEL_INTERVAL_MS) {
      this.lastLevelAt = now;
      this.onLevel(Math.min(1, rms / Math.max(threshold * 2.5, 0.04)));
    }
    this.onSamples(this.buffer, this.context.sampleRate, now);
    if (isAttack) {
      this.lastOnsetAt = now;
      this.onOnset(now);
    }

    this.previousRms = rms;
    this.timerId = setTimeout(this.#tick, POLL_INTERVAL_MS);
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
