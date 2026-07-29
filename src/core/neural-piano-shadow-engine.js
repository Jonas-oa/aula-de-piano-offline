const MODEL_SAMPLE_RATE = 22_050;
const MODEL_SAMPLE_COUNT = 43_844;
const MODEL_NOTE_COUNT = 88;
const FIRST_PIANO_MIDI = 21;
const DEFAULT_INFERENCE_INTERVAL_MS = 400;
const RELIABLE_END_PADDING = 15;
const RECENT_FRAME_COUNT = 12;

const defaultClock = () => performance.now();
const defaultRuntimeLoader = async () => {
  const { createBasicPitchRuntime } = await import(
    "../../vendor/basic-pitch/basic-pitch-runtime.js"
  );
  const modelUrl = new URL("../../vendor/basic-pitch/model/model.json", import.meta.url);
  return createBasicPitchRuntime(modelUrl);
};

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
  }

  process(samples, sourceSampleRate) {
    if (!(samples instanceof Float32Array) || !samples.length) return new Float32Array();
    if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
      throw new Error("Taxa de amostragem inválida.");
    }
    if (this.sourceSampleRate && this.sourceSampleRate !== sourceSampleRate) this.reset();
    this.sourceSampleRate = sourceSampleRate;
    const ratio = sourceSampleRate / this.targetSampleRate;
    const output = [];

    let readIndex = 0;
    if (!this.hasPreviousSample) {
      this.previousSample = samples[0];
      this.hasPreviousSample = true;
      output.push(this.previousSample);
      this.nextOutputFrame = ratio;
      this.sourceFrame = 1;
      readIndex = 1;
    }

    for (; readIndex < samples.length; readIndex += 1) {
      const currentSample = samples[readIndex];
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

export function summarizeBasicPitchOutputs({
  frames,
  onsets,
  frameCount,
  noteCount,
}, expectedMidis = []) {
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
  const startFrame = Math.max(0, endFrame - RECENT_FRAME_COUNT);
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
  return { detected, expected, startFrame, endFrame };
}

export class NeuralPianoShadowEngine {
  constructor({
    onStatus,
    onResult,
    onDiagnostic,
    runtimeLoader = defaultRuntimeLoader,
    clock = defaultClock,
    inferenceIntervalMs = DEFAULT_INFERENCE_INTERVAL_MS,
  } = {}) {
    this.onStatus = onStatus || (() => {});
    this.onResult = onResult || (() => {});
    this.onDiagnostic = onDiagnostic || (() => {});
    this.runtimeLoader = runtimeLoader;
    this.clock = clock;
    this.inferenceIntervalMs = inferenceIntervalMs;
    this.resampler = new StreamingLinearResampler();
    this.buffer = new FloatRingBuffer(MODEL_SAMPLE_COUNT);
    this.enabled = false;
    this.runtime = null;
    this.loadingPromise = null;
    this.inferenceActive = false;
    this.lastInferenceAt = -Infinity;
    this.expectedMidis = [];
    this.sequence = 0;
  }

  async setEnabled(enabled) {
    const generation = ++this.sequence;
    this.enabled = Boolean(enabled);
    this.resampler.reset();
    this.buffer.reset();
    this.lastInferenceAt = -Infinity;
    if (!this.enabled) {
      this.onStatus("disabled");
      return true;
    }

    if (!this.runtime) {
      this.onStatus("loading");
      this.loadingPromise ||= this.runtimeLoader();
      try {
        const runtime = await this.loadingPromise;
        if (generation !== this.sequence || !this.enabled) {
          runtime.dispose?.();
          return false;
        }
        this.runtime = runtime;
      } catch (error) {
        if (generation !== this.sequence) return false;
        this.enabled = false;
        this.onStatus("error", error);
        return false;
      } finally {
        this.loadingPromise = null;
      }
    }
    this.onStatus("warming", { progress: 0 });
    return true;
  }

  setExpected(midis = []) {
    this.expectedMidis = [...new Set(midis)].filter(Number.isFinite);
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
      this.inferenceActive
      || now - this.lastInferenceAt < this.inferenceIntervalMs
    ) return;
    this.lastInferenceAt = now;
    void this.#infer(this.sequence, now);
  }

  async #infer(generation, startedAt) {
    this.inferenceActive = true;
    try {
      const raw = await this.runtime.infer(this.buffer.snapshot());
      if (generation !== this.sequence || !this.enabled) return;
      const summary = summarizeBasicPitchOutputs(raw, this.expectedMidis);
      const result = {
        ...summary,
        latencyMs: Math.round(this.clock() - startedAt),
        tensorCount: raw.tensors,
        timestamp: Date.now(),
      };
      this.onStatus("active");
      this.onResult(result);
      this.onDiagnostic(result);
    } catch (error) {
      if (generation !== this.sequence) return;
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
    this.runtime?.dispose?.();
    this.runtime = null;
    this.loadingPromise = null;
    this.resampler.reset();
    this.buffer.reset();
    this.onStatus("disabled");
  }
}
