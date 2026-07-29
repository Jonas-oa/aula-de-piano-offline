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

  const quiet = detector.process(0.003, 250);
  assert.equal(quiet.isAttack, false);
  assert.equal(quiet.nearAttack, true);
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
});
