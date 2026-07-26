import { midiToFrequency, sameMidis, uniqueMidis } from "./music.js";

const DEFAULTS = {
  minRms: 0.004,
  minAmplitude: 0.0035,
  expectedRelativeThreshold: 0.075,
  extraRelativeThreshold: 0.36,
  scanPaddingSemitones: 12,
  stableFrames: 2,
  analysisIntervalMs: 36,
  attemptWindowMs: 460,
};

function rmsOf(samples) {
  if (!samples?.length) return 0;
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  let sum = 0;
  for (const sample of samples) {
    const centered = sample - mean;
    sum += centered * centered;
  }
  return Math.sqrt(sum / samples.length);
}

function goertzelAmplitude(samples, sampleRate, frequency) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previousPrevious = 0;
  let windowSum = 0;
  const denominator = Math.max(1, samples.length - 1);

  for (let index = 0; index < samples.length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / denominator);
    const value = samples[index] * window;
    const current = value + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = current;
    windowSum += window;
  }

  const power = previousPrevious * previousPrevious
    + previous * previous
    - coefficient * previous * previousPrevious;
  return (2 * Math.sqrt(Math.max(0, power))) / Math.max(1, windowSum);
}

function isHarmonicAlias(midi, amplitude, amplitudes, expectedSet, minAmplitude) {
  if (expectedSet.has(midi)) return false;
  const frequency = midiToFrequency(midi);
  for (const [lowerMidi, lowerAmplitude] of amplitudes) {
    if (lowerMidi >= midi) continue;
    const ratio = frequency / midiToFrequency(lowerMidi);
    const harmonic = Math.round(ratio);
    if (harmonic < 2 || harmonic > 5) continue;
    const cents = 1200 * Math.log2(ratio / harmonic);
    if (Math.abs(cents) > 28) continue;

    // Em notas graves de piano, o segundo harmônico pode superar a
    // fundamental no microfone do celular. Quando a fundamental esperada está
    // realmente presente, não trate esse harmônico natural como uma nota extra.
    if (
      expectedSet.has(lowerMidi)
      && lowerAmplitude >= minAmplitude
      && amplitude <= Math.max(lowerAmplitude * 6, minAmplitude * 16)
    ) return true;

    if (lowerAmplitude > amplitude && amplitude < lowerAmplitude * 0.72) return true;
  }
  return false;
}

/**
 * Reconhece as alturas de um ataque acústico orientado pelo evento esperado.
 *
 * O MusicXML limita a busca a uma região musical útil. Isso torna a detecção
 * polifônica mais estável que tentar transcrever qualquer som do ambiente e
 * ainda permite informar notas ausentes e notas extras.
 */
export function analyzeExpectedChord(samples, sampleRate, expectedMidis, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const expected = uniqueMidis(expectedMidis);
  const rms = rmsOf(samples);
  const empty = {
    status: "silence",
    expected,
    detected: [],
    missing: expected,
    extra: [],
    completeness: 0,
    confidence: 0,
    rms,
  };
  if (!expected.length || !samples?.length || !sampleRate || rms < config.minRms) return empty;

  const low = Math.max(21, expected[0] - config.scanPaddingSemitones);
  const high = Math.min(108, expected.at(-1) + config.scanPaddingSemitones);
  const amplitudes = new Map();
  for (let midi = low; midi <= high; midi += 1) {
    amplitudes.set(midi, goertzelAmplitude(samples, sampleRate, midiToFrequency(midi)));
  }

  const strongest = Math.max(0, ...amplitudes.values());
  const expectedStrongest = Math.max(0, ...expected.map((midi) => amplitudes.get(midi) || 0));
  const expectedThreshold = Math.max(
    config.minAmplitude,
    Math.min(
      strongest * config.expectedRelativeThreshold,
      expectedStrongest * 0.55,
    ),
  );
  const expectedSet = new Set(expected);
  const presentExpected = expected.filter((midi) =>
    (amplitudes.get(midi) || 0) >= expectedThreshold,
  );

  const extraThreshold = Math.max(
    config.minAmplitude * 1.6,
    expectedStrongest * config.extraRelativeThreshold,
  );
  const extras = [];
  for (const [midi, amplitude] of amplitudes) {
    if (expectedSet.has(midi) || amplitude < extraThreshold) continue;
    if (isHarmonicAlias(midi, amplitude, amplitudes, expectedSet, config.minAmplitude)) continue;
    extras.push(midi);
  }

  // Picos vizinhos podem aparecer por pequena desafinação. Mantém somente o
  // pico mais forte dentro de cada grupo cromático contíguo.
  const compactExtras = extras.filter((midi) =>
    !extras.some((other) =>
      other !== midi
      && Math.abs(other - midi) <= 1
      && (amplitudes.get(other) || 0) > (amplitudes.get(midi) || 0),
    ),
  );
  const missing = expected.filter((midi) => !presentExpected.includes(midi));
  const detected = [...presentExpected, ...compactExtras].sort((a, b) => a - b);
  const completeness = expected.length
    ? presentExpected.length / expected.length
    : 0;
  const strength = expected.length
    ? expected.reduce((sum, midi) => {
      const amplitude = amplitudes.get(midi) || 0;
      return sum + Math.min(1, amplitude / Math.max(expectedThreshold * 2.5, 0.0001));
    }, 0) / expected.length
    : 0;
  const confidence = Math.max(0, Math.min(1,
    completeness * 0.7 + strength * 0.3 - compactExtras.length * 0.12,
  ));

  let status = "match";
  if (missing.length) status = presentExpected.length ? "incomplete" : "wrong";
  else if (compactExtras.length) status = "extra";

  return {
    status,
    expected,
    detected,
    missing,
    extra: compactExtras,
    completeness,
    confidence,
    rms,
    amplitudes,
  };
}

/**
 * Agrupa quadros do analisador em uma tentativa iniciada por um ataque.
 * Dois quadros coerentes confirmam a nota/acorde; silêncio, notas ausentes ou
 * extras encerram como erro somente no fim da janela, evitando feedback nervoso.
 */
export class PianoRecognitionEngine {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.attempt = null;
    this.lastMatchedExpected = [];
  }

  startAttempt(
    expectedMidis,
    timestamp = performance.now(),
    { continuous = false, waitForRelease = false } = {},
  ) {
    const expected = uniqueMidis(expectedMidis);
    this.attempt = expected.length ? {
      expected,
      continuous,
      waitForRelease,
      startedAt: timestamp,
      deadline: timestamp + this.options.attemptWindowMs,
      lastAnalysisAt: -Infinity,
      stableMatches: 0,
      best: null,
    } : null;
    return this.attempt;
  }

  armExpected(expectedMidis, timestamp = performance.now()) {
    const expected = uniqueMidis(expectedMidis);
    return this.startAttempt(expected, timestamp, {
      continuous: true,
      waitForRelease: sameMidis(expected, this.lastMatchedExpected),
    });
  }

  isArmedFor(expectedMidis) {
    const expected = uniqueMidis(expectedMidis);
    const active = this.attempt?.expected || [];
    return sameMidis(expected, active);
  }

  noteAttack() {
    if (!this.attempt?.waitForRelease) return;
    this.attempt.waitForRelease = false;
    this.attempt.stableMatches = 0;
  }

  reset() {
    this.attempt = null;
    this.lastMatchedExpected = [];
  }

  process(samples, sampleRate, timestamp = performance.now()) {
    const attempt = this.attempt;
    if (!attempt) return null;
    if (timestamp - attempt.lastAnalysisAt < this.options.analysisIntervalMs) return null;
    attempt.lastAnalysisAt = timestamp;

    const analysis = analyzeExpectedChord(
      samples,
      sampleRate,
      attempt.expected,
      this.options,
    );
    if (attempt.waitForRelease) {
      if (analysis.status !== "match") {
        attempt.waitForRelease = false;
        attempt.stableMatches = 0;
      }
      return { outcome: "pending", ...analysis };
    }
    const score = analysis.completeness
      + analysis.confidence * 0.25
      - analysis.extra.length * 0.15;
    const bestScore = attempt.best
      ? attempt.best.completeness + attempt.best.confidence * 0.25 - attempt.best.extra.length * 0.15
      : -Infinity;
    if (score > bestScore) attempt.best = analysis;

    attempt.stableMatches = analysis.status === "match"
      ? attempt.stableMatches + 1
      : 0;
    const requiredStableFrames = attempt.expected.length === 1
      ? 1
      : this.options.stableFrames;
    if (attempt.stableMatches >= requiredStableFrames) {
      this.attempt = null;
      this.lastMatchedExpected = [...attempt.expected];
      return { outcome: "match", ...analysis };
    }
    if (!attempt.continuous && timestamp >= attempt.deadline) {
      const best = attempt.best || analysis;
      this.attempt = null;
      return { outcome: "wrong", ...best };
    }
    return { outcome: "pending", ...analysis };
  }
}
