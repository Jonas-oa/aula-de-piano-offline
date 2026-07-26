import { midiToFrequency, sameMidis, uniqueMidis } from "./music.js";

const DEFAULTS = {
  minRms: 0.004,
  minAmplitude: 0.0035,
  expectedRelativeThreshold: 0.075,
  extraRelativeThreshold: 0.36,
  scanPaddingSemitones: 12,
  // Um vizinho precisa ser bem mais forte para o pico ser tratado como vazamento.
  sidebandRatio: 2,
  // Bins mínimos entre semitons para o quadro conseguir distingui-los.
  resolutionBins: 1.5,
  stableFrames: 2,
  analysisIntervalMs: 36,
  attemptWindowMs: 460,
};

function rmsOf(samples) {
  if (!samples?.length) return 0;
  let total = 0;
  let squares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    total += sample;
    squares += sample * sample;
  }
  const mean = total / samples.length;
  return Math.sqrt(Math.max(0, squares / samples.length - mean * mean));
}

// A janela de Hann e o buffer de trabalho dependem só do tamanho do quadro, que
// na prática nunca muda. Antes o cosseno da janela era recalculado para cada
// altura pesquisada — dezenas de vezes por quadro, em torno de sete milhões de
// chamadas por segundo num acorde de duas mãos.
const WINDOW_CACHE = new Map();

function windowFor(length) {
  let cached = WINDOW_CACHE.get(length);
  if (cached) return cached;
  const shape = new Float32Array(length);
  const denominator = Math.max(1, length - 1);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    shape[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / denominator);
    sum += shape[index];
  }
  cached = { shape, sum: Math.max(1, sum), windowed: new Float32Array(length) };
  if (WINDOW_CACHE.size > 4) WINDOW_CACHE.clear();
  WINDOW_CACHE.set(length, cached);
  return cached;
}

function applyWindow(samples) {
  const cached = windowFor(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    cached.windowed[index] = samples[index] * cached.shape[index];
  }
  return cached;
}

function goertzelAmplitude(windowed, sampleRate, frequency, windowSum) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previousPrevious = 0;

  for (let index = 0; index < windowed.length; index += 1) {
    const current = windowed[index] + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = current;
  }

  const power = previousPrevious * previousPrevious
    + previous * previous
    - coefficient * previous * previousPrevious;
  return (2 * Math.sqrt(Math.max(0, power))) / windowSum;
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
  const { windowed, sum: windowSum } = applyWindow(samples);
  const amplitudes = new Map();
  for (let midi = low; midi <= high; midi += 1) {
    amplitudes.set(
      midi,
      goertzelAmplitude(windowed, sampleRate, midiToFrequency(midi), windowSum),
    );
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
  // Limite físico do quadro: com N amostras a R Hz, dois semitons vizinhos só se
  // separam acima de certa frequência. No grave do piano a distância entre
  // semitons é menor que um bin — Dó2 e Dó♯2 caem no mesmo lugar. Apontar "nota
  // extra" nessa região seria inventar erro, então o motor se cala ali. A nota
  // esperada continua sendo conferida por presença, que não exige separá-la da
  // vizinha.
  const binHz = sampleRate / samples.length;
  const semitoneRatio = 2 ** (1 / 12) - 1;
  const canResolveNeighbours = (midi) =>
    midiToFrequency(midi) * semitoneRatio >= binHz * config.resolutionBins;

  const extras = [];
  for (const [midi, amplitude] of amplitudes) {
    if (expectedSet.has(midi) || amplitude < extraThreshold) continue;
    if (!canResolveNeighbours(midi)) continue;
    if (isHarmonicAlias(midi, amplitude, amplitudes, expectedSet, config.minAmplitude)) continue;
    extras.push(midi);
  }

  // Picos vizinhos aparecem por vazamento espectral, e o vizinho mais forte
  // costuma ser a própria nota esperada — comparar apenas extras entre si fazia
  // a banda lateral de uma nota certa virar "nota extra".
  //
  // A proporção separa os dois casos com folga: medido em quadro de 4096
  // amostras, o vazamento fica perto de 2,5% do pico vizinho, enquanto um erro
  // real de semitom (tocar Fá♯ junto do Sol escrito) chega a 100%. Sem esse
  // limiar, o engano mais comum do aluno passaria despercebido.
  const compactExtras = extras.filter((midi) => {
    const amplitude = amplitudes.get(midi) || 0;
    for (const neighbour of [midi - 1, midi + 1]) {
      const neighbourAmplitude = amplitudes.get(neighbour) || 0;
      if (neighbourAmplitude > amplitude * config.sidebandRatio) return false;
    }
    return true;
  });
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
