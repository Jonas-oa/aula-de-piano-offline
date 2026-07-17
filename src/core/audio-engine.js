import { frequencyToMidi, centsFromMidi, midiToNote } from './music.js';

export class AudioPitchEngine {
  constructor({ onPitch, onError, concertPitch = 440 } = {}) {
    this.onPitch = onPitch || (() => {});
    this.onError = onError || (() => {});
    this.concertPitch = concertPitch;
    this.audioContext = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.frameId = null;
    this.running = false;
  }

  setConcertPitch(value) {
    this.concertPitch = Number(value) || 440;
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador não oferece acesso ao microfone em contexto seguro.');
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
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      await this.audioContext.resume();
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 4096;
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
    this.stream = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close();
    this.audioContext = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
  }

  #loop = () => {
    if (!this.running || !this.analyser || !this.buffer) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const result = yinPitch(this.buffer, this.audioContext.sampleRate);
    if (result) {
      const midiFloat = frequencyToMidi(result.frequency, this.concertPitch);
      this.onPitch({
        ...result,
        midiFloat,
        midi: Math.round(midiFloat),
        note: midiToNote(midiFloat),
        cents: centsFromMidi(midiFloat),
      });
    } else {
      this.onPitch(null);
    }
    this.frameId = requestAnimationFrame(this.#loop);
  };
}

export function yinPitch(buffer, sampleRate, threshold = 0.13) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i += 1) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.012) return null;

  const minFrequency = 55;
  const maxFrequency = 1400;
  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(Math.floor(sampleRate / minFrequency), Math.floor(buffer.length / 2));
  const difference = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let i = 0; i < maxTau; i += 1) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const normalized = new Float32Array(maxTau + 1);
  normalized[0] = 1;
  let runningSum = 0;
  let tauEstimate = -1;

  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    normalized[tau] = runningSum === 0 ? 1 : (difference[tau] * tau) / runningSum;
  }

  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (normalized[tau] < threshold) {
      while (tau + 1 <= maxTau && normalized[tau + 1] < normalized[tau]) tau += 1;
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate < 0) {
    let best = minTau;
    for (let tau = minTau + 1; tau <= maxTau; tau += 1) {
      if (normalized[tau] < normalized[best]) best = tau;
    }
    if (normalized[best] > 0.28) return null;
    tauEstimate = best;
  }

  const betterTau = parabolicInterpolation(normalized, tauEstimate);
  const frequency = sampleRate / betterTau;
  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency) return null;

  return {
    frequency,
    clarity: Math.max(0, Math.min(1, 1 - normalized[tauEstimate])),
    rms,
  };
}

function parabolicInterpolation(values, index) {
  const left = values[index - 1] ?? values[index];
  const center = values[index];
  const right = values[index + 1] ?? values[index];
  const divisor = 2 * (2 * center - right - left);
  if (!divisor) return index;
  return index + (right - left) / divisor;
}

export class DemoSynth {
  constructor() {
    this.context = null;
    this.metronomeTimer = null;
  }

  async ensureContext() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    }
    await this.context.resume();
    return this.context;
  }

  async playFrequency(frequency, durationSeconds = 0.45, gainValue = 0.12) {
    const ctx = await this.ensureContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.02);
  }

  async click(accent = false) {
    const ctx = await this.ensureContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    oscillator.type = 'square';
    oscillator.frequency.value = accent ? 1200 : 800;
    gain.gain.setValueAtTime(0.10, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  }

  async startMetronome(bpm, onBeat) {
    this.stopMetronome();
    let beat = 0;
    const interval = Math.round(60000 / bpm);
    await this.click(true);
    onBeat?.(beat);
    beat += 1;
    this.metronomeTimer = window.setInterval(() => {
      this.click(beat % 4 === 0);
      onBeat?.(beat);
      beat += 1;
    }, interval);
  }

  stopMetronome() {
    if (this.metronomeTimer) clearInterval(this.metronomeTimer);
    this.metronomeTimer = null;
  }
}
