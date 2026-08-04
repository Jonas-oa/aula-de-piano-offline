const MODEL_SAMPLE_RATE = 22_050;
const MODEL_SAMPLE_COUNT = 43_844;
const MODEL_NOTE_COUNT = 88;
const FIRST_PIANO_MIDI = 21;
const DEFAULT_INFERENCE_INTERVAL_MS = 400;
const RELIABLE_END_PADDING = 15;
const RECENT_FRAME_COUNT = 12;
// O modelo devolve um quadro a cada 256 amostras, e o buffer inteiro cobre
// pouco menos de dois segundos. Com esses dois números o motor sabe a que
// instante do relógio cada quadro corresponde.
const FRAME_HOP_SAMPLES = 256;
const FRAME_DURATION_MS = (1000 * FRAME_HOP_SAMPLES) / MODEL_SAMPLE_RATE;
const BUFFER_DURATION_MS = (1000 * MODEL_SAMPLE_COUNT) / MODEL_SAMPLE_RATE;
// O cursor arma a nota só depois de reconhecer a anterior. Num trecho ligado o
// aluno já está na nota seguinte quando isso acontece, então a janela começa um
// pouco antes do instante em que armou.
const ARMING_LOOKBACK_MS = 250;
// Reamostrar por interpolação simples dobra para dentro da banda tudo o que
// passa de 11 kHz. O filtro corta antes de decimar; sem ele o modelo recebe um
// agudo fantasma que não existe no piano.
const ANTIALIAS_CUTOFF_RATIO = 0.83;
const BUTTERWORTH_CASCADE_Q = [0.541_196, 1.306_563];
export const NEURAL_FOLLOW_THRESHOLDS = Object.freeze({
  frame: 0.55,
  onset: 0.35,
});

const defaultClock = () => performance.now();
const defaultRuntimeLoader = async () => {
  const { createBasicPitchRuntime } = await import(
    "../../vendor/basic-pitch/basic-pitch-runtime.js"
  );
  const modelUrl = new URL("../../vendor/basic-pitch/model/model.json", import.meta.url);
  return createBasicPitchRuntime(modelUrl);
};

function createLowPassBiquad(cutoffHz, sampleRate, q) {
  const w0 = (2 * Math.PI * Math.min(cutoffHz, sampleRate * 0.45)) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const shared = (1 - cosW0) / 2;
  return {
    b0: shared / a0,
    b1: (1 - cosW0) / a0,
    b2: shared / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
}

function stepBiquad(filter, input) {
  const output = filter.b0 * input
    + filter.b1 * filter.x1
    + filter.b2 * filter.x2
    - filter.a1 * filter.y1
    - filter.a2 * filter.y2;
  filter.x2 = filter.x1;
  filter.x1 = input;
  filter.y2 = filter.y1;
  filter.y1 = output;
  return output;
}

export class StreamingLinearResampler {
  constructor(targetSampleRate = MODEL_SAMPLE_RATE) {
    this.targetSampleRate = targetSampleRate;
    this.reset();
  }

  reset() {
    this.sourceSampleRate = 0;
    this.sourceFrame = 0;
    this.nextOutputFrame = 0;
    this.previousSample = 0;
    this.hasPreviousSample = false;
    this.antialiasFilters = [];
  }

  #buildAntialiasFilters(sourceSampleRate) {
    if (sourceSampleRate <= this.targetSampleRate) return [];
    const cutoff = (this.targetSampleRate / 2) * ANTIALIAS_CUTOFF_RATIO;
    return BUTTERWORTH_CASCADE_Q.map((q) =>
      createLowPassBiquad(cutoff, sourceSampleRate, q));
  }

  #limitBand(sample) {
    let value = sample;
    for (const filter of this.antialiasFilters) value = stepBiquad(filter, value);
    return value;
  }

  process(samples, sourceSampleRate) {
    if (!(samples instanceof Float32Array) || !samples.length) return new Float32Array();
    if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
      throw new Error("Taxa de amostragem inválida.");
    }
    if (this.sourceSampleRate && this.sourceSampleRate !== sourceSampleRate) this.reset();
    if (!this.sourceSampleRate) {
      this.antialiasFilters = this.#buildAntialiasFilters(sourceSampleRate);
    }
    this.sourceSampleRate = sourceSampleRate;
    const ratio = sourceSampleRate / this.targetSampleRate;
    const output = [];

    let readIndex = 0;
    if (!this.hasPreviousSample) {
      this.previousSample = this.#limitBand(samples[0]);
      this.hasPreviousSample = true;
      output.push(this.previousSample);
      this.nextOutputFrame = ratio;
      this.sourceFrame = 1;
      readIndex = 1;
    }

    for (; readIndex < samples.length; readIndex += 1) {
      const currentSample = this.#limitBand(samples[readIndex]);
      const currentFrame = this.sourceFrame;
      while (this.nextOutputFrame <= currentFrame) {
        const fraction = this.nextOutputFrame - (currentFrame - 1);
        output.push(
          this.previousSample + (currentSample - this.previousSample) * fraction,
        );
        this.nextOutputFrame += ratio;
      }
      this.previousSample = currentSample;
      this.sourceFrame += 1;
    }
    return Float32Array.from(output);
  }
}

export class FloatRingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity);
    this.reset();
  }

  reset() {
    this.writeIndex = 0;
    this.length = 0;
    this.data.fill(0);
  }

  push(samples) {
    for (let index = 0; index < samples.length; index += 1) {
      this.data[this.writeIndex] = samples[index];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.length = Math.min(this.capacity, this.length + 1);
    }
  }

  snapshot() {
    if (this.length < this.capacity) return this.data.slice(0, this.length);
    const result = new Float32Array(this.capacity);
    const tailLength = this.capacity - this.writeIndex;
    result.set(this.data.subarray(this.writeIndex), 0);
    result.set(this.data.subarray(0, this.writeIndex), tailLength);
    return result;
  }
}

/**
 * Resume os quadros do modelo em probabilidade por altura.
 *
 * `startFrame` permite cobrir todo o áudio desde que a nota foi armada, em vez
 * de um pedaço fixo no fim do buffer. Com a janela fixa, a maior parte do sinal
 * caía entre duas inferências e o ataque nunca era visto; com a janela ancorada
 * no cursor, nenhum trecho fica de fora. Quando a nota acabou de ser armada a
 * janela fica vazia de propósito — não há áudio novo a julgar ainda.
 */
/**
 * Qual quadro do buffer corresponde ao instante em que a nota foi armada.
 * O áudio mais recente do buffer é aproximadamente o relógio de agora; a
 * folga do `ARMING_LOOKBACK_MS` cobre a latência da placa e o aluno que já
 * atacou a nota antes de o cursor chegar nela.
 */
export function analysisStartFrame(armedAt, snapshotAt) {
  if (!Number.isFinite(armedAt)) return undefined;
  const bufferStartsAt = snapshotAt - BUFFER_DURATION_MS;
  return Math.ceil(
    (armedAt - ARMING_LOOKBACK_MS - bufferStartsAt) / FRAME_DURATION_MS,
  );
}

export function summarizeBasicPitchOutputs({
  frames,
  onsets,
  frameCount,
  noteCount,
}, expectedMidis = [], { startFrame: requestedStartFrame } = {}) {
  if (
    !(frames instanceof Float32Array)
    || !(onsets instanceof Float32Array)
    || noteCount !== MODEL_NOTE_COUNT
    || frames.length !== frameCount * noteCount
    || onsets.length !== frames.length
  ) {
    throw new Error("Saída inválida do modelo Basic Pitch.");
  }

  const endFrame = Math.max(1, frameCount - RELIABLE_END_PADDING);
  const requested = Number.isFinite(requestedStartFrame)
    ? requestedStartFrame
    : endFrame - RECENT_FRAME_COUNT;
  const startFrame = Math.min(endFrame, Math.max(0, Math.round(requested)));
  const notes = [];
  for (let noteIndex = 0; noteIndex < noteCount; noteIndex += 1) {
    let frameProbability = 0;
    let onsetProbability = 0;
    for (let frameIndex = startFrame; frameIndex < endFrame; frameIndex += 1) {
      const offset = frameIndex * noteCount + noteIndex;
      frameProbability = Math.max(frameProbability, frames[offset]);
      onsetProbability = Math.max(onsetProbability, onsets[offset]);
    }
    notes.push({
      midi: FIRST_PIANO_MIDI + noteIndex,
      frameProbability,
      onsetProbability,
      probability: Math.max(frameProbability, onsetProbability),
    });
  }

  const expected = [...new Set(expectedMidis)]
    .filter((midi) => midi >= FIRST_PIANO_MIDI && midi < FIRST_PIANO_MIDI + noteCount)
    .map((midi) => notes[midi - FIRST_PIANO_MIDI]);
  const detected = notes
    .filter((note) => note.probability >= 0.15)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 8);
  return {
    detected,
    expected,
    startFrame,
    endFrame,
    analyzedFrames: endFrame - startFrame,
  };
}

function normalizedMidis(midis = []) {
  return [...new Set((midis || [])
    .filter(Number.isFinite)
    .map((midi) => Math.round(midi)))]
    .sort((a, b) => a - b);
}

function sameMidis(left, right) {
  return left.length === right.length
    && left.every((midi, index) => midi === right[index]);
}

/**
 * `ignoreMidis` recebe as alturas de eventos já aceitos que ainda podem estar
 * soando. Uma corda de piano vibra por segundos, e agora que a janela cobre
 * todo o áudio desde que a nota foi armada o ataque anterior aparece dentro
 * dela. Sem essa lista ele venceria a nota atual na comparação de dominância e
 * bloquearia justamente as melodias ligadas — o mesmo motivo pelo qual o motor
 * acústico já não cobra essas alturas como nota extra.
 */
export function evaluateNeuralFollowResult(
  result,
  currentExpectedMidis,
  { thresholds = NEURAL_FOLLOW_THRESHOLDS, ignoreMidis = [] } = {},
) {
  const expected = normalizedMidis(currentExpectedMidis);
  const inferredFor = normalizedMidis(result?.expected?.map(({ midi }) => midi));
  if (!expected.length) {
    return { accepted: false, reason: "no-expected", expected };
  }
  if (!sameMidis(expected, inferredFor)) {
    return { accepted: false, reason: "stale-expected", expected, inferredFor };
  }

  const expectedNotes = expected.map((midi) =>
    result.expected.find((note) => Math.round(note.midi) === midi));
  const belowThreshold = expectedNotes.filter((note) =>
    !note
    || note.frameProbability < thresholds.frame
    || note.onsetProbability < thresholds.onset);
  if (belowThreshold.length) {
    return {
      accepted: false,
      reason: "below-threshold",
      expected,
      belowThreshold: belowThreshold.map(({ midi } = {}) => midi).filter(Number.isFinite),
    };
  }

  const confidence = Math.min(...expectedNotes.map((note) =>
    Math.min(note.frameProbability, note.onsetProbability)));
  const expectedSet = new Set(expected);
  const ignoredSet = new Set(normalizedMidis(ignoreMidis));
  const strongestUnexpected = Math.max(
    0,
    ...(result.detected || [])
      .filter(({ midi }) => {
        const rounded = Math.round(midi);
        return !expectedSet.has(rounded) && !ignoredSet.has(rounded);
      })
      .map((note) => Math.min(note.frameProbability, note.onsetProbability)),
  );
  if (strongestUnexpected >= confidence) {
    return {
      accepted: false,
      reason: "ambiguous",
      expected,
      confidence,
      strongestUnexpected,
    };
  }

  return {
    accepted: true,
    reason: "match",
    expected,
    confidence,
    strongestUnexpected,
  };
}

export class NeuralPianoShadowEngine {
  constructor({
    onStatus,
    onResult,
    runtimeLoader = defaultRuntimeLoader,
    clock = defaultClock,
    inferenceIntervalMs = DEFAULT_INFERENCE_INTERVAL_MS,
  } = {}) {
    this.onStatus = onStatus || (() => {});
    this.onResult = onResult || (() => {});
    this.runtimeLoader = runtimeLoader;
    this.clock = clock;
    this.inferenceIntervalMs = inferenceIntervalMs;
    this.resampler = new StreamingLinearResampler();
    this.buffer = new FloatRingBuffer(MODEL_SAMPLE_COUNT);
    this.enabled = false;
    this.runtime = null;
    this.loadingPromise = null;
    this.disposed = false;
    this.inferenceActive = false;
    this.inferenceRequested = false;
    this.lastInferenceAt = -Infinity;
    this.expectedMidis = [];
    this.expectedArmedAt = null;
    this.sequence = 0;
  }

  async setEnabled(enabled) {
    const generation = ++this.sequence;
    this.enabled = Boolean(enabled);
    this.resampler.reset();
    this.buffer.reset();
    this.inferenceRequested = false;
    this.lastInferenceAt = -Infinity;
    if (!this.enabled) {
      this.onStatus("disabled");
      return true;
    }
    // Ligar outra vez revive uma engine descartada; sem isto ela recusaria
    // qualquer sessão seguinte para sempre.
    this.disposed = false;

    try {
      const runtime = await this.#loadRuntime();
      if (!runtime || generation !== this.sequence || !this.enabled) return false;
    } catch (error) {
      if (generation !== this.sequence) return false;
      this.enabled = false;
      this.onStatus("error", error);
      return false;
    }
    this.onStatus("warming", { progress: 0 });
    return true;
  }

  // Compila o modelo enquanto o aluno ainda está lendo a partitura. A captura
  // PCM e as inferências continuam desligadas; portanto o pré-carregamento não
  // usa o microfone nem ocupa CPU continuamente. Ao pressionar Iniciar, os
  // shaders já estão prontos e o primeiro fallback não paga a espera observada
  // de 2,4 a 6,4 segundos.
  async preload() {
    if (this.runtime) return true;
    this.disposed = false;
    try {
      return Boolean(await this.#loadRuntime());
    } catch (error) {
      this.onStatus("error", error);
      return false;
    }
  }

  async #loadRuntime() {
    if (this.runtime) return this.runtime;
    if (!this.loadingPromise) {
      const startedAt = this.clock();
      this.onStatus("loading");
      this.loadingPromise = this.runtimeLoader().then((runtime) => {
        if (this.disposed) {
          runtime.dispose?.();
          return null;
        }
        this.runtime = runtime;
        this.onStatus("ready", {
          loadMs: Math.max(0, Math.round(this.clock() - startedAt)),
        });
        return runtime;
      }).finally(() => {
        this.loadingPromise = null;
      });
    }
    return this.loadingPromise;
  }

  // O instante em que o cursor armou a nota delimita o áudio que pode
  // confirmá-la. É registrado em toda chamada, e não apenas quando as alturas
  // mudam: notas repetidas armam duas vezes o mesmo Dó, e reaproveitar o
  // instante antigo deixaria o ataque anterior confirmar o evento seguinte.
  setExpected(midis = [], armedAt = this.clock()) {
    this.expectedMidis = [...new Set(midis)].filter(Number.isFinite);
    this.expectedArmedAt = Number.isFinite(armedAt) ? armedAt : null;
    // Uma solicitação pertence ao evento que a criou. Se o acústico avançou
    // antes de o fallback começar, a nota seguinte espera a própria demanda.
    this.inferenceRequested = false;
  }

  requestInference() {
    if (!this.enabled || this.inferenceActive || this.inferenceRequested) return false;
    this.inferenceRequested = true;
    return true;
  }

  pushPcm(samples, sampleRate) {
    if (!this.enabled || !this.runtime) return;
    const resampled = this.resampler.process(samples, sampleRate);
    this.buffer.push(resampled);
    if (this.buffer.length < MODEL_SAMPLE_COUNT) {
      this.onStatus("warming", {
        progress: this.buffer.length / MODEL_SAMPLE_COUNT,
      });
      return;
    }

    const now = this.clock();
    if (
      !this.inferenceRequested
      || this.inferenceActive
      || now - this.lastInferenceAt < this.inferenceIntervalMs
    ) return;
    this.inferenceRequested = false;
    this.lastInferenceAt = now;
    void this.#infer(this.sequence, now);
  }

  async #infer(generation, startedAt) {
    this.inferenceActive = true;
    // O modelo pode demorar centenas de milissegundos no celular. A nota
    // esperada precisa pertencer ao áudio que iniciou esta inferência, não ao
    // cursor que talvez já tenha avançado enquanto o modelo calculava.
    const expectedMidis = [...this.expectedMidis];
    const startFrame = analysisStartFrame(this.expectedArmedAt, startedAt);
    try {
      const raw = await this.runtime.infer(this.buffer.snapshot());
      if (generation !== this.sequence || !this.enabled) return;
      const summary = summarizeBasicPitchOutputs(raw, expectedMidis, { startFrame });
      this.onStatus("active");
      this.onResult({
        ...summary,
        latencyMs: Math.round(this.clock() - startedAt),
      });
    } catch (error) {
      if (generation !== this.sequence) return;
      // Um contexto WebGL perdido invalida o modelo carregado. Descartá-lo aqui
      // faz a próxima sessão recarregar em vez de repetir a mesma falha.
      this.runtime?.dispose?.();
      this.runtime = null;
      this.enabled = false;
      this.onStatus("error", error);
    } finally {
      this.inferenceActive = false;
      // A pausa começa depois da inferência. Em aparelhos lentos, contá-la
      // desde o início faria o modelo recomeçar imediatamente e ocupar CPU sem
      // descanso assim que terminasse um quadro.
      this.lastInferenceAt = this.clock();
    }
  }

  dispose() {
    this.sequence += 1;
    this.enabled = false;
    this.disposed = true;
    this.runtime?.dispose?.();
    this.runtime = null;
    this.loadingPromise = null;
    this.expectedArmedAt = null;
    this.inferenceRequested = false;
    this.resampler.reset();
    this.buffer.reset();
    this.onStatus("disabled");
  }
}
