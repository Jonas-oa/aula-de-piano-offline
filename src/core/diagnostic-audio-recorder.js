const DEFAULT_MAX_DURATION_MS = 3 * 60_000;
const DEFAULT_AUDIO_BITS_PER_SECOND = 48_000;
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

function stamp(isoDate) {
  return String(isoDate || new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

export function diagnosticAudioMimeType(MediaRecorderClass = globalThis.MediaRecorder) {
  if (!MediaRecorderClass) return "";
  if (typeof MediaRecorderClass.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((type) => MediaRecorderClass.isTypeSupported(type)) || "";
}

export function diagnosticAudioExtension(mimeType = "") {
  return String(mimeType).toLowerCase().includes("mp4") ? "m4a" : "webm";
}

export function diagnosticAudioFilename(startedAt, mimeType) {
  return `partitura-viva_${stamp(startedAt)}.audio.${diagnosticAudioExtension(mimeType)}`;
}

function firstLiveAudioTrack(stream) {
  const tracks = stream?.getAudioTracks?.() || stream?.getTracks?.() || [];
  return tracks.find((track) => track?.kind === "audio" && track.readyState !== "ended") || null;
}

/**
 * Grava o mesmo MediaStream já aberto pelo motor, sem pedir uma segunda
 * permissão. O arquivo é apenas para diagnóstico humano; as decisões continuam
 * usando o PCM bruto do analisador e do Basic Pitch, nunca o áudio comprimido.
 */
export class DiagnosticAudioRecorder {
  constructor({
    MediaRecorderClass = globalThis.MediaRecorder,
    clock = () => Date.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
    maxDurationMs = DEFAULT_MAX_DURATION_MS,
    audioBitsPerSecond = DEFAULT_AUDIO_BITS_PER_SECOND,
    onStatus = () => {},
  } = {}) {
    this.MediaRecorderClass = MediaRecorderClass;
    this.clock = clock;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.maxDurationMs = maxDurationMs;
    this.audioBitsPerSecond = audioBitsPerSecond;
    this.onStatus = onStatus;
    this.reset();
  }

  get recording() {
    return this.recorder?.state === "recording";
  }

  reset() {
    this.recorder = null;
    this.chunks = [];
    this.startedAt = null;
    this.sessionStartedAt = null;
    this.stopReason = null;
    this.stopRequested = false;
    this.timer = null;
    this.completion = null;
    this.resolveCompletion = null;
    this.result = null;
    this.error = null;
  }

  start(stream, { sessionStartedAt = this.clock() } = {}) {
    if (this.recording) return { status: "recording", mimeType: this.recorder.mimeType || "" };
    this.reset();
    if (!this.MediaRecorderClass) {
      this.onStatus("unsupported");
      return { status: "unsupported" };
    }
    if (!firstLiveAudioTrack(stream)) {
      this.onStatus("no-stream");
      return { status: "no-stream" };
    }

    const requestedType = diagnosticAudioMimeType(this.MediaRecorderClass);
    const options = {
      audioBitsPerSecond: this.audioBitsPerSecond,
      ...(requestedType ? { mimeType: requestedType } : {}),
    };

    try {
      this.recorder = new this.MediaRecorderClass(stream, options);
    } catch {
      // Alguns navegadores expõem MediaRecorder, mas recusam todas as opções.
      // A construção simples ainda permite gravar no formato padrão nativo.
      try {
        this.recorder = new this.MediaRecorderClass(stream);
      } catch (error) {
        this.error = error;
        this.onStatus("error", { error });
        return { status: "error", error };
      }
    }

    this.chunks = [];
    this.startedAt = this.clock();
    this.sessionStartedAt = Number(sessionStartedAt) || this.startedAt;
    this.completion = new Promise((resolve) => { this.resolveCompletion = resolve; });
    this.recorder.ondataavailable = ({ data }) => {
      if (data?.size) this.chunks.push(data);
    };
    this.recorder.onerror = ({ error }) => {
      this.error = error || new Error("Falha ao gravar o áudio de diagnóstico.");
    };
    this.recorder.onstop = () => this.#finalize();

    try {
      this.recorder.start(1000);
    } catch (error) {
      this.error = error;
      this.#finalize();
      this.onStatus("error", { error });
      return { status: "error", error };
    }

    this.timer = this.setTimer(() => { void this.stop("duration-limit"); }, this.maxDurationMs);
    this.onStatus("recording", { mimeType: this.recorder.mimeType || requestedType });
    return { status: "recording", mimeType: this.recorder.mimeType || requestedType };
  }

  async stop(reason = "manual") {
    if (this.result) return this.result;
    if (!this.recorder) return null;
    // `MediaRecorder.stop()` muda o estado para `inactive` antes de entregar o
    // último `dataavailable`. Dois pedidos de encerramento nesse intervalo não
    // podem finalizar o Blob cedo e perder justamente o fim da gravação.
    if (this.stopRequested) return this.completion;
    this.stopRequested = true;
    if (!this.stopReason) this.stopReason = reason;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch (error) {
        this.error = error;
        this.#finalize();
      }
    } else {
      this.#finalize();
    }
    return this.completion;
  }

  #finalize() {
    if (this.result) return;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const stoppedAt = this.clock();
    const mimeType = this.recorder?.mimeType
      || this.chunks.find(({ type }) => type)?.type
      || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    this.result = {
      blob,
      name: diagnosticAudioFilename(new Date(this.sessionStartedAt).toISOString(), mimeType),
      type: mimeType,
      bytes: blob.size,
      durationMs: Math.max(0, stoppedAt - this.startedAt),
      startOffsetMs: Math.max(0, this.startedAt - this.sessionStartedAt),
      truncated: this.stopReason === "duration-limit",
      error: this.error?.message || null,
    };
    this.resolveCompletion?.(this.result);
    this.onStatus("stopped", this.result);
  }
}

export const DIAGNOSTIC_AUDIO_MAX_DURATION_MS = DEFAULT_MAX_DURATION_MS;
