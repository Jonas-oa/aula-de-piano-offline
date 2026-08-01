import test from "node:test";
import assert from "node:assert/strict";

import {
  diagnosticAudioExtension,
  diagnosticAudioFilename,
  diagnosticAudioMimeType,
  DiagnosticAudioRecorder,
} from "../src/core/diagnostic-audio-recorder.js";

function fakeStream({ ended = false } = {}) {
  return { getAudioTracks: () => [{ kind: "audio", readyState: ended ? "ended" : "live" }] };
}

// Réplica mínima do MediaRecorder: o suficiente para exercitar o encadeamento
// de estados que o navegador impõe — `stop()` marca `inactive` antes de o
// último bloco chegar, e é nessa fresta que o encerramento duplo quebrava.
function fakeMediaRecorderClass({ supported = ["audio/webm;codecs=opus"], failOptions = false } = {}) {
  class FakeMediaRecorder {
    static isTypeSupported(type) {
      return supported.includes(type);
    }

    constructor(stream, options) {
      if (failOptions && options) throw new Error("opções recusadas");
      FakeMediaRecorder.instances.push(this);
      this.stream = stream;
      this.mimeType = options?.mimeType || "audio/webm";
      this.state = "inactive";
    }

    start() {
      this.state = "recording";
    }

    stop() {
      this.state = "inactive";
      // O navegador entrega o último bloco depois de já estar inativo.
      this.ondataavailable?.({ data: { size: 4, type: this.mimeType } });
      this.onstop?.();
    }
  }
  FakeMediaRecorder.instances = [];
  return FakeMediaRecorder;
}

function fakeClock(start = 5_000) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; return now; };
  return clock;
}

function makeRecorder(overrides = {}) {
  const timers = [];
  return {
    timers,
    recorder: new DiagnosticAudioRecorder({
      MediaRecorderClass: fakeMediaRecorderClass(),
      clock: fakeClock(),
      setTimer: (callback, delay) => {
        timers.push({ callback, delay });
        return timers.length - 1;
      },
      clearTimer: (id) => { timers[id] = null; },
      ...overrides,
    }),
  };
}

test("o tipo escolhido é o primeiro que o navegador aceita", () => {
  assert.equal(
    diagnosticAudioMimeType(fakeMediaRecorderClass({ supported: ["audio/webm;codecs=opus", "audio/mp4"] })),
    "audio/webm;codecs=opus",
  );
  assert.equal(
    diagnosticAudioMimeType(fakeMediaRecorderClass({ supported: ["audio/mp4"] })),
    "audio/mp4",
    "o Safari só oferece mp4, e recusar tudo deixaria o iPhone sem diagnóstico",
  );
  assert.equal(diagnosticAudioMimeType(fakeMediaRecorderClass({ supported: [] })), "");
  assert.equal(diagnosticAudioMimeType(undefined), "", "sem MediaRecorder não há tipo");
});

test("a extensão acompanha o formato que o navegador entregou", () => {
  assert.equal(diagnosticAudioExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(diagnosticAudioExtension("audio/mp4"), "m4a");
  assert.equal(diagnosticAudioExtension(""), "webm");
});

test("o nome do áudio casa com o do diário da mesma sessão", () => {
  // Os dois arquivos são anexados juntos e precisam ser reconhecíveis como par.
  const name = diagnosticAudioFilename("2026-07-31T13:45:07.123Z", "audio/webm");
  assert.equal(name, "partitura-viva_2026-07-31_13-45-07.audio.webm");
});

test("sem MediaRecorder ou sem microfone, a gravação é recusada sem quebrar", () => {
  const semClasse = new DiagnosticAudioRecorder({ MediaRecorderClass: undefined });
  assert.deepEqual(semClasse.start(fakeStream()), { status: "unsupported" });

  const { recorder } = makeRecorder();
  assert.deepEqual(recorder.start(null), { status: "no-stream" });
  assert.deepEqual(
    recorder.start(fakeStream({ ended: true })),
    { status: "no-stream" },
    "uma trilha encerrada não grava nada",
  );
});

test("a gravação entrega arquivo, duração e deslocamento do início da sessão", async () => {
  const clock = fakeClock(10_000);
  const { recorder } = makeRecorder({ clock });

  // A sessão começou antes de a gravação subir: o deslocamento é o que alinha
  // o áudio às marcas de tempo do diário.
  const started = recorder.start(fakeStream(), { sessionStartedAt: 9_400 });
  assert.equal(started.status, "recording");
  assert.equal(recorder.recording, true);

  clock.advance(2_500);
  const result = await recorder.stop();

  assert.equal(result.durationMs, 2_500);
  assert.equal(result.startOffsetMs, 600);
  assert.equal(result.truncated, false);
  assert.equal(result.error, null);
  assert.match(result.name, /\.audio\.webm$/);
  assert.ok(result.bytes > 0, "o Blob precisa ter o bloco recebido");
});

test("dois pedidos de encerramento não perdem o fim da gravação", async () => {
  // `MediaRecorder.stop()` muda o estado para `inactive` antes de entregar o
  // último `dataavailable`. Sem a guarda, o segundo pedido finalizava o Blob
  // nessa fresta e o trecho mais interessante — o fim — ficava de fora.
  const { recorder } = makeRecorder();
  recorder.start(fakeStream());

  const [primeiro, segundo] = await Promise.all([recorder.stop(), recorder.stop("manual")]);
  assert.equal(primeiro, segundo, "os dois pedidos precisam devolver o mesmo resultado");
  assert.ok(primeiro.bytes > 0, "o último bloco não pode se perder no encerramento duplo");
});

test("o limite de duração encerra sozinho e marca o corte", async () => {
  const clock = fakeClock();
  const { recorder, timers } = makeRecorder({ clock, maxDurationMs: 1_000 });
  recorder.start(fakeStream());

  assert.equal(timers[0].delay, 1_000);
  clock.advance(1_000);
  timers[0].callback();
  const result = await recorder.stop();

  assert.equal(result.truncated, true, "quem abrir o arquivo precisa saber que ele foi cortado");
});

test("navegador que expõe MediaRecorder mas recusa as opções ainda grava", () => {
  const { recorder } = makeRecorder({
    MediaRecorderClass: fakeMediaRecorderClass({ failOptions: true }),
  });
  assert.equal(recorder.start(fakeStream()).status, "recording");
});

test("começar duas vezes não descarta a gravação em andamento", () => {
  const { recorder } = makeRecorder();
  recorder.start(fakeStream());
  const segunda = recorder.start(fakeStream());

  assert.equal(segunda.status, "recording");
  assert.equal(recorder.chunks.length, 0, "a segunda chamada não pode zerar o que já foi gravado");
});
