import { midiToNote } from "./music.js";

const SAMPLE_MIDIS = [
  21, 24, 27, 30, 33, 36, 39, 42, 45, 48,
  51, 54, 57, 60, 63, 66, 69, 72, 75, 78,
  81, 84, 87, 90, 93, 96, 99, 102, 105, 108,
];

export function sampleForMidi(midi) {
  const numericMidi = Number(midi);
  const target = Math.max(21, Math.min(108, Number.isFinite(numericMidi) ? numericMidi : 60));
  const sampleMidi = SAMPLE_MIDIS.reduce((nearest, candidate) =>
    Math.abs(candidate - target) < Math.abs(nearest - target) ? candidate : nearest,
  );
  const filename = `${midiToNote(sampleMidi)}v10.mp3`;
  return {
    midi: sampleMidi,
    filename,
    playbackRate: 2 ** ((target - sampleMidi) / 12),
  };
}

export function playbackRegion(events, startIndex = 0, endIndex = events.length - 1) {
  if (!events?.length) return { events: [], durationBeats: 0, startIndex: 0, endIndex: -1 };
  const start = Math.max(0, Math.min(Number(startIndex) || 0, events.length - 1));
  const end = Math.max(start, Math.min(Number(endIndex) || 0, events.length - 1));
  const originBeat = Number(events[start].beat) || 0;
  const selected = events.slice(start, end + 1).map((event, offset) => ({
    ...event,
    originalIndex: Number.isInteger(event.originalIndex) ? event.originalIndex : start + offset,
    relativeBeat: Math.max(0, (Number(event.beat) || 0) - originBeat),
    duration: Math.max(0.08, Number(event.duration) || 0.5),
  }));
  const durationBeats = selected.reduce(
    (latest, event) => Math.max(latest, event.relativeBeat + event.duration),
    0,
  );
  return { events: selected, durationBeats, startIndex: start, endIndex: end };
}

export class PianoPlaybackEngine {
  constructor({
    onCursor = () => {},
    onStateChange = () => {},
    onLoadProgress = () => {},
    onEnded = () => {},
    onError = () => {},
  } = {}) {
    this.onCursor = onCursor;
    this.onStateChange = onStateChange;
    this.onLoadProgress = onLoadProgress;
    this.onEnded = onEnded;
    this.onError = onError;
    this.context = null;
    this.input = null;
    this.master = null;
    this.sampleCache = new Map();
    this.activeSources = new Set();
    this.schedulerTimer = null;
    this.animationFrame = null;
    this.session = null;
    this.pausedSession = null;
    this.loading = false;
    this.playRequest = 0;
  }

  get isPlaying() {
    return Boolean(this.session);
  }

  get isPaused() {
    return Boolean(this.pausedSession);
  }

  get isLoading() {
    return this.loading;
  }

  get isActive() {
    return this.isPlaying || this.isPaused || this.isLoading;
  }

  async ensureContext() {
    if (this.context) {
      await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Este navegador não oferece reprodução de áudio.");
    this.context = new AudioContextClass({ latencyHint: "playback" });

    this.input = this.context.createGain();
    const dry = this.context.createGain();
    const wet = this.context.createGain();
    const convolver = this.context.createConvolver();
    const compressor = this.context.createDynamicsCompressor();
    this.master = this.context.createGain();

    dry.gain.value = 0.92;
    wet.gain.value = 0.12;
    this.master.gain.value = 0.78;
    compressor.threshold.value = -18;
    compressor.knee.value = 14;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.24;
    convolver.buffer = this.createRoomImpulse(1.35, 2.3);

    this.input.connect(dry).connect(compressor);
    this.input.connect(convolver).connect(wet).connect(compressor);
    compressor.connect(this.master).connect(this.context.destination);
    await this.context.resume();
  }

  createRoomImpulse(seconds, decay) {
    const length = Math.round(this.context.sampleRate * seconds);
    const impulse = this.context.createBuffer(2, length, this.context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const envelope = (1 - index / length) ** decay;
        data[index] = (Math.random() * 2 - 1) * envelope;
      }
    }
    return impulse;
  }

  sampleUrl(filename) {
    const encoded = filename.replace("#", "%23");
    return new URL(`../../assets/audio/piano/acoustic-grand/${encoded}`, import.meta.url);
  }

  loadSample(sampleMidi) {
    if (this.sampleCache.has(sampleMidi)) return this.sampleCache.get(sampleMidi);
    const definition = sampleForMidi(sampleMidi);
    const promise = fetch(this.sampleUrl(definition.filename))
      .then((response) => {
        if (!response.ok) throw new Error(`A amostra ${definition.filename} não pôde ser carregada.`);
        return response.arrayBuffer();
      })
      .then((bytes) => this.context.decodeAudioData(bytes))
      .catch((error) => {
        this.sampleCache.delete(sampleMidi);
        throw error;
      });
    this.sampleCache.set(sampleMidi, promise);
    return promise;
  }

  async prepare(events, request = this.playRequest) {
    await this.ensureContext();
    const sampleMidis = [...new Set(
      events.flatMap((event) => event.midis || []).map((midi) => sampleForMidi(midi).midi),
    )];
    if (!sampleMidis.length) throw new Error("A partitura não possui notas reproduzíveis.");
    let loaded = 0;
    if (request === this.playRequest) {
      this.onLoadProgress({ loaded, total: sampleMidis.length });
    }
    await Promise.all(sampleMidis.map(async (sampleMidi) => {
      await this.loadSample(sampleMidi);
      loaded += 1;
      if (request === this.playRequest) {
        this.onLoadProgress({ loaded, total: sampleMidis.length });
      }
    }));
  }

  async play(events, {
    bpm = 72,
    startIndex = 0,
    endIndex = events.length - 1,
    loop = false,
    offsetBeats = 0,
  } = {}) {
    const region = playbackRegion(events, startIndex, endIndex);
    if (!region.events.length || !region.durationBeats) {
      throw new Error("O trecho selecionado não possui notas.");
    }
    this.stop({ preserveCursor: true, notify: false });
    const request = this.playRequest;
    this.loading = true;
    this.onStateChange("loading");
    try {
      await this.prepare(region.events, request);
    } catch (error) {
      if (request !== this.playRequest) return;
      this.loading = false;
      this.onStateChange("stopped");
      this.onError(error);
      throw error;
    }
    if (request !== this.playRequest) return;

    const safeBpm = Math.max(30, Math.min(240, Number(bpm) || 72));
    const safeOffset = Math.max(0, Math.min(Number(offsetBeats) || 0, region.durationBeats - 0.001));
    this.session = {
      region,
      bpm: safeBpm,
      loop: Boolean(loop),
      startPositionBeats: safeOffset,
      startedAt: this.context.currentTime + 0.06,
      nextEventIndex: 0,
      nextCycle: 0,
      lastCursorIndex: null,
    };
    this.loading = false;
    while (this.eventAbsoluteBeat(this.session) < safeOffset - 0.0001) this.advanceEvent(this.session);
    this.pausedSession = null;
    this.onStateChange("playing");
    this.schedule();
    this.tickCursor();
  }

  eventAbsoluteBeat(session) {
    const event = session.region.events[session.nextEventIndex];
    if (!event) return Number.POSITIVE_INFINITY;
    return session.nextCycle * session.region.durationBeats + event.relativeBeat;
  }

  advanceEvent(session) {
    session.nextEventIndex += 1;
    if (session.nextEventIndex < session.region.events.length) return;
    if (!session.loop) return;
    session.nextEventIndex = 0;
    session.nextCycle += 1;
  }

  schedule() {
    if (!this.session) return;
    const session = this.session;
    const secondsPerBeat = 60 / session.bpm;
    const elapsed = Math.max(0, this.context.currentTime - session.startedAt);
    const positionBeats = session.startPositionBeats + elapsed / secondsPerBeat;
    const horizonBeats = positionBeats + 0.65 / secondsPerBeat;

    while (session.nextEventIndex < session.region.events.length) {
      const absoluteBeat = this.eventAbsoluteBeat(session);
      if (absoluteBeat > horizonBeats) break;
      if (absoluteBeat >= positionBeats - 0.04 / secondsPerBeat) {
        const event = session.region.events[session.nextEventIndex];
        const when = session.startedAt + (absoluteBeat - session.startPositionBeats) * secondsPerBeat;
        this.scheduleEvent(event, when, secondsPerBeat);
      }
      const previousIndex = session.nextEventIndex;
      this.advanceEvent(session);
      if (!session.loop && previousIndex === session.region.events.length - 1) break;
    }

    if (!session.loop && positionBeats >= session.region.durationBeats) {
      this.finish();
      return;
    }
    this.schedulerTimer = window.setTimeout(() => this.schedule(), 80);
  }

  async scheduleEvent(event, when, secondsPerBeat) {
    for (const [noteIndex, midi] of (event.midis || []).entries()) {
      const definition = sampleForMidi(midi);
      const buffer = await this.loadSample(definition.midi);
      if (!this.session || when < this.context.currentTime - 0.04) continue;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      const noteSeconds = Math.max(0.08, event.duration * secondsPerBeat);
      const releaseSeconds = Math.min(1.1, Math.max(0.38, noteSeconds * 0.55));
      const startAt = Math.max(when, this.context.currentTime);
      const chordGain = 0.76 / Math.sqrt(Math.max(1, event.midis.length));
      const accent = 0.92 + ((event.originalIndex + noteIndex) % 4 === 0 ? 0.08 : 0);

      source.buffer = buffer;
      source.playbackRate.value = definition.playbackRate;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(chordGain * accent, startAt + 0.008);
      gain.gain.setValueAtTime(chordGain * accent, startAt + noteSeconds);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + noteSeconds + releaseSeconds);
      source.connect(gain).connect(this.input);
      source.start(startAt);
      source.stop(startAt + noteSeconds + releaseSeconds + 0.05);
      this.activeSources.add(source);
      source.onended = () => this.activeSources.delete(source);
    }
  }

  currentPositionBeats() {
    if (!this.session) return this.pausedSession?.offsetBeats || 0;
    const secondsPerBeat = 60 / this.session.bpm;
    return this.session.startPositionBeats
      + Math.max(0, this.context.currentTime - this.session.startedAt) / secondsPerBeat;
  }

  tickCursor() {
    if (!this.session) return;
    const { region, loop } = this.session;
    const absolute = this.currentPositionBeats();
    const position = loop ? absolute % region.durationBeats : Math.min(absolute, region.durationBeats);
    let event = region.events[0];
    for (const candidate of region.events) {
      if (candidate.relativeBeat > position + 0.0001) break;
      event = candidate;
    }
    if (event.originalIndex !== this.session.lastCursorIndex) {
      this.session.lastCursorIndex = event.originalIndex;
      this.onCursor(event.originalIndex);
    }
    this.animationFrame = window.requestAnimationFrame(() => this.tickCursor());
  }

  setLoop(loop) {
    if (this.session) this.session.loop = Boolean(loop);
    if (this.pausedSession) this.pausedSession.loop = Boolean(loop);
  }

  pause() {
    if (!this.session) return;
    const position = this.currentPositionBeats();
    const offsetBeats = this.session.loop
      ? position % this.session.region.durationBeats
      : Math.min(position, this.session.region.durationBeats - 0.001);
    this.pausedSession = {
      events: this.session.region.events.map((event) => ({
        ...event,
        beat: event.relativeBeat,
      })),
      bpm: this.session.bpm,
      startIndex: 0,
      endIndex: this.session.region.events.length - 1,
      loop: this.session.loop,
      offsetBeats,
    };
    this.clearPlaybackTimers();
    this.stopActiveSources();
    this.session = null;
    this.onStateChange("paused");
  }

  async resume() {
    if (!this.pausedSession) return;
    const paused = this.pausedSession;
    await this.play(paused.events, paused);
  }

  stop({ preserveCursor = false, notify = true } = {}) {
    this.playRequest += 1;
    this.loading = false;
    this.clearPlaybackTimers();
    this.stopActiveSources();
    this.session = null;
    this.pausedSession = null;
    if (!preserveCursor) this.onCursor(0);
    if (notify) this.onStateChange("stopped");
  }

  finish() {
    const region = this.session?.region;
    this.clearPlaybackTimers();
    this.session = null;
    this.pausedSession = null;
    this.onStateChange("stopped");
    this.onEnded(region);
  }

  clearPlaybackTimers() {
    window.clearTimeout(this.schedulerTimer);
    window.cancelAnimationFrame(this.animationFrame);
    this.schedulerTimer = null;
    this.animationFrame = null;
  }

  stopActiveSources() {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // A fonte pode já ter terminado naturalmente.
      }
    }
    this.activeSources.clear();
  }
}
