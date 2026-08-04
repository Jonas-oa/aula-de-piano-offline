const DEFAULT_LOOKAHEAD_SECONDS = 0.12;
const DEFAULT_TIMER_MS = 25;

function normalizedBpm(value) {
  return Math.max(30, Math.min(240, Number(value) || 72));
}

function normalizedBeatsPerBar(value) {
  return Math.max(1, Math.round(Number(value) || 4));
}

/**
 * Agenda os pulsos pelo relógio do AudioContext. O timer só alimenta uma curta
 * janela futura; portanto, atrasos da interface não deslocam cada clique.
 */
export class MetronomeEngine {
  constructor({
    contextFactory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis),
    lookaheadSeconds = DEFAULT_LOOKAHEAD_SECONDS,
    timerMs = DEFAULT_TIMER_MS,
    onBeat = () => {},
  } = {}) {
    this.contextFactory = contextFactory;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.lookaheadSeconds = lookaheadSeconds;
    this.timerMs = timerMs;
    this.onBeat = onBeat;
    this.context = null;
    this.timer = null;
    this.sources = new Set();
    this.nextBeatAt = 0;
    this.beatIndex = 0;
    this.bpm = 72;
    this.beatsPerBar = 4;
    this.isActive = false;
  }

  async start({ bpm = this.bpm, beatsPerBar = this.beatsPerBar } = {}) {
    this.stop();
    this.bpm = normalizedBpm(bpm);
    this.beatsPerBar = normalizedBeatsPerBar(beatsPerBar);
    this.context ||= this.contextFactory();
    await this.context.resume?.();
    this.isActive = true;
    this.beatIndex = 0;
    this.nextBeatAt = this.context.currentTime + 0.04;
    this.#scheduleWindow();
    this.timer = this.setIntervalFn?.(() => this.#scheduleWindow(), this.timerMs) ?? null;
    return true;
  }

  stop() {
    if (this.timer != null) this.clearIntervalFn?.(this.timer);
    this.timer = null;
    this.isActive = false;
    this.beatIndex = 0;
    for (const source of this.sources) {
      try {
        source.stop(this.context?.currentTime);
      } catch {
        // A fonte pode já ter terminado entre o clique e a interrupção.
      }
    }
    this.sources.clear();
  }

  setTempo(value) {
    this.bpm = normalizedBpm(value);
    if (this.isActive && this.context) {
      const latestUsefulBeat = this.context.currentTime + (60 / this.bpm);
      this.nextBeatAt = Math.min(this.nextBeatAt, latestUsefulBeat);
    }
    return this.bpm;
  }

  setBeatsPerBar(value) {
    this.beatsPerBar = normalizedBeatsPerBar(value);
    this.beatIndex %= this.beatsPerBar;
    return this.beatsPerBar;
  }

  #scheduleWindow() {
    if (!this.isActive || !this.context) return;
    const horizon = this.context.currentTime + this.lookaheadSeconds;
    while (this.nextBeatAt <= horizon) {
      const accent = this.beatIndex === 0;
      this.#scheduleClick(this.nextBeatAt, accent);
      this.onBeat({
        at: this.nextBeatAt,
        accent,
        beat: this.beatIndex + 1,
        beatsPerBar: this.beatsPerBar,
        bpm: this.bpm,
      });
      this.nextBeatAt += 60 / this.bpm;
      this.beatIndex = (this.beatIndex + 1) % this.beatsPerBar;
    }
  }

  #scheduleClick(at, accent) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.setValueAtTime(accent ? 1050 : 780, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.09 : 0.065, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.onended = () => this.sources.delete(oscillator);
    this.sources.add(oscillator);
    oscillator.start(at);
    oscillator.stop(at + 0.06);
  }
}
