import assert from "node:assert/strict";
import test from "node:test";

import { OnsetEngine } from "../src/core/onset-engine.js";

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
