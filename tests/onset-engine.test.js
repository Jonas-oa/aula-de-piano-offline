import assert from "node:assert/strict";
import test from "node:test";

import {
  AdaptiveOnsetDetector,
  OnsetEngine,
} from "../src/core/onset-engine.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeAudio() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const source = { connect() {}, disconnect() {} };
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData(buffer) {
      buffer.fill(0);
    },
    disconnect() {},
  };
  class AudioContext {
    constructor() {
      this.sampleRate = 48_000;
      this.state = "suspended";
    }

    async resume() {
      this.state = "running";
    }

    createMediaStreamSource() {
      return source;
    }

    createAnalyser() {
      return analyser;
    }

    async close() {
      this.state = "closed";
    }
  }
  return { stream, track, AudioContext };
}

function fakeAudioWithWorklet() {
  const audio = fakeAudio();
  const modules = [];
  const connections = [];
  const messages = [];
  class AudioWorkletNode {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage(message) {
          messages.push(message);
        },
      };
    }

    connect(target) {
      connections.push(target);
      return target;
    }

    disconnect() {}
  }
  class AudioContext extends audio.AudioContext {
    constructor() {
      super();
      this.destination = {};
      this.audioWorklet = {
        async addModule(url) {
          modules.push(String(url));
        },
      };
    }

    createGain() {
      return {
        gain: { value: 1 },
        connect(target) {
          connections.push(target);
          return target;
        },
        disconnect() {},
      };
    }
  }
  return { ...audio, AudioContext, AudioWorkletNode, modules, messages };
}

test("preparo automático compartilha um único pedido de microfone", async () => {
  const request = deferred();
  const audio = fakeAudio();
  let calls = 0;
  const previousNavigator = globalThis.navigator;
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => { calls += 1; return request.promise; } } },
  });
  globalThis.window = { AudioContext: audio.AudioContext };

  const engine = new OnsetEngine();
  const first = engine.start();
  const second = engine.start();
  assert.equal(calls, 1);
  request.resolve(audio.stream);
  await Promise.all([first, second]);
  assert.equal(engine.running, true);
  await engine.stop();
  assert.equal(audio.track.stopped, true);

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: previousNavigator,
  });
  globalThis.window = previousWindow;
});

test("sair durante a permissão cancela o preparo sem deixar o microfone aberto", async () => {
  const request = deferred();
  const audio = fakeAudio();
  const previousNavigator = globalThis.navigator;
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => request.promise } },
  });
  globalThis.window = { AudioContext: audio.AudioContext };

  const engine = new OnsetEngine();
  const starting = engine.start();
  await engine.stop();
  request.resolve(audio.stream);
  await starting;

  assert.equal(engine.running, false);
  assert.equal(audio.track.stopped, true);

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: previousNavigator,
  });
  globalThis.window = previousWindow;
});

test("captura PCM é opcional, contínua e não interfere no motor principal", async () => {
  const audio = fakeAudioWithWorklet();
  const chunks = [];
  const statuses = [];
  const previousNavigator = globalThis.navigator;
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => audio.stream } },
  });
  globalThis.window = {
    AudioContext: audio.AudioContext,
    AudioWorkletNode: audio.AudioWorkletNode,
  };

  const engine = new OnsetEngine({
    onPcmChunk: (...args) => chunks.push(args),
    onPcmStatus: (status) => statuses.push(status),
  });
  await engine.start();
  assert.equal(engine.running, true);
  assert.equal(await engine.setPcmCaptureEnabled(true), true);
  assert.match(audio.modules[0], /pcm-capture-processor\.js$/);
  assert.deepEqual(audio.messages.at(-1), { type: "enabled", enabled: true });

  const samples = new Float32Array([0.1, -0.1]);
  engine.pcmCaptureNode.port.onmessage({
    data: { type: "pcm", samples, frame: 2 },
  });
  assert.deepEqual(chunks[0], [samples, 48_000, 2]);

  await engine.setPcmCaptureEnabled(false);
  assert.deepEqual(audio.messages.at(-1), { type: "enabled", enabled: false });
  assert.equal(statuses.at(-1), "disabled");
  assert.equal(engine.running, true);
  await engine.stop();

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: previousNavigator,
  });
  globalThis.window = previousWindow;
});

test("navegador sem AudioWorklet mantém o reconhecimento atual ativo", async () => {
  const audio = fakeAudio();
  const statuses = [];
  const previousNavigator = globalThis.navigator;
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => audio.stream } },
  });
  globalThis.window = { AudioContext: audio.AudioContext };

  const engine = new OnsetEngine({
    onPcmStatus: (status) => statuses.push(status),
  });
  await engine.start();
  assert.equal(await engine.setPcmCaptureEnabled(true), false);
  assert.equal(statuses.at(-1), "unsupported");
  assert.equal(engine.running, true);
  await engine.stop();

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: previousNavigator,
  });
  globalThis.window = previousWindow;
});

test("detector adaptativo aceita ataque suave acima do ambiente", () => {
  const detector = new AdaptiveOnsetDetector();
  for (let index = 0; index < 20; index += 1) {
    assert.equal(detector.process(0.0008, index * 12).isAttack, false);
  }

  const onset = detector.process(0.006, 250);
  assert.equal(onset.isAttack, true);
  assert.ok(onset.rms > onset.threshold);
});

test("detector sinaliza som quase suficiente para orientar o aluno", () => {
  const detector = new AdaptiveOnsetDetector();
  for (let index = 0; index < 20; index += 1) detector.process(0.0008, index * 12);

  const quiet = detector.process(0.0015, 250);
  assert.equal(quiet.isAttack, false);
  assert.equal(quiet.nearAttack, true);
});

test("captação discreta ainda é ataque: o limiar acompanha a sala, não um valor fixo", () => {
  // O microfone abre sem controle automático de ganho, então o nível entregue
  // muda muito de aparelho para aparelho. Com o limiar preso em 0,004 um
  // celular que capta mais baixo nunca produzia um ataque sequer, e a tela de
  // estudo ficava parada sem explicar nada. O que decide é o salto sobre o piso
  // medido na própria sala.
  const detector = new AdaptiveOnsetDetector();
  for (let index = 0; index < 40; index += 1) detector.process(0.0007, index * 12);

  assert.equal(detector.process(0.003, 500).isAttack, true);
});

test("ressonância sustentada não eleva o piso até bloquear as próximas notas", () => {
  const detector = new AdaptiveOnsetDetector();
  for (let index = 0; index < 30; index += 1) detector.process(0.001, index * 12);

  assert.equal(detector.process(0.03, 400).isAttack, true);
  for (let index = 0; index < 500; index += 1) {
    detector.process(0.022, 412 + index * 12);
  }

  assert.ok(detector.floor < 0.004, `piso derivou para ${detector.floor}`);
  detector.process(0.006, 6500);
  assert.equal(detector.process(0.025, 6512).isAttack, true);
});

test("reiniciar o detector descarta a sensibilidade contaminada da sessão anterior", () => {
  const detector = new AdaptiveOnsetDetector();
  detector.floor = 0.08;
  detector.previousRms = 0.04;
  detector.lastOnsetAt = 500;

  detector.reset();

  assert.equal(detector.floor, detector.initialFloor);
  assert.equal(detector.previousRms, 0);
  assert.equal(detector.lastOnsetAt, -Infinity);
  assert.equal(detector.suppressedUntil, -Infinity);
});

test("rearme curto absorve o segundo pico do mesmo ataque", () => {
  const detector = new AdaptiveOnsetDetector();
  for (let ms = 0; ms <= 84; ms += 12) detector.process(0.0004, ms);

  assert.equal(detector.process(0.0069, 100).isAttack, true);
  // O mesmo golpe continua crescendo, mas ainda está dentro do intervalo
  // mínimo. O cursor aceita a nota em seguida e arma a guarda do próximo evento.
  assert.equal(detector.process(0.038, 160).isAttack, false);
  detector.process(0.037, 196);
  detector.suppressFor(110, 196);

  const duplicate = detector.process(0.04, 197);
  assert.equal(duplicate.isAttack, false);
  assert.equal(duplicate.suppressedAttack, true);

  // Depois de cair e ultrapassar a guarda, um toque real continua passando.
  detector.process(0.005, 330);
  const nextNote = detector.process(0.03, 350);
  assert.equal(nextNote.isAttack, true);
  assert.equal(nextNote.suppressedAttack, false);
});
