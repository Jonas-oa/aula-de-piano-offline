import assert from "node:assert/strict";
import test from "node:test";

import {
  FloatRingBuffer,
  NeuralPianoShadowEngine,
  StreamingLinearResampler,
  summarizeBasicPitchOutputs,
} from "../src/core/neural-piano-shadow-engine.js";

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeModelOutput({ frameCount = 172, active = [] } = {}) {
  const noteCount = 88;
  const frames = new Float32Array(frameCount * noteCount);
  const onsets = new Float32Array(frameCount * noteCount);
  for (const { midi, frame = 0, onset = 0, at = 150 } of active) {
    const offset = at * noteCount + midi - 21;
    frames[offset] = frame;
    onsets[offset] = onset;
  }
  return { frames, onsets, frameCount, noteCount, tensors: 7 };
}

test("reamostragem contínua não cria emendas diferentes entre blocos", () => {
  const input = Float32Array.from(
    { length: 4096 },
    (_, index) => Math.sin(2 * Math.PI * 440 * index / 48_000),
  );
  const whole = new StreamingLinearResampler().process(input, 48_000);
  const splitResampler = new StreamingLinearResampler();
  const first = splitResampler.process(input.subarray(0, 1700), 48_000);
  const second = splitResampler.process(input.subarray(1700), 48_000);
  const split = new Float32Array(first.length + second.length);
  split.set(first);
  split.set(second, first.length);

  assert.equal(split.length, whole.length);
  for (let index = 0; index < whole.length; index += 1) {
    assert.ok(Math.abs(split[index] - whole[index]) < 1e-6);
  }
});

test("buffer circular preserva sempre as amostras mais recentes em ordem", () => {
  const buffer = new FloatRingBuffer(5);
  buffer.push(new Float32Array([1, 2, 3]));
  assert.deepEqual([...buffer.snapshot()], [1, 2, 3]);
  buffer.push(new Float32Array([4, 5, 6, 7]));
  assert.deepEqual([...buffer.snapshot()], [3, 4, 5, 6, 7]);
});

test("saída neural mapeia as 88 posições para MIDI e mantém o Lá", () => {
  const summary = summarizeBasicPitchOutputs(
    fakeModelOutput({
      active: [
        { midi: 21, frame: 0.82, onset: 0.63 },
        { midi: 69, frame: 0.91, onset: 0.72 },
      ],
    }),
    [69],
  );

  assert.deepEqual(summary.detected.map(({ midi }) => midi), [69, 21]);
  assert.equal(summary.expected[0].midi, 69);
  assert.ok(summary.expected[0].probability > 0.9);
  assert.equal(summary.endFrame, 157);
});

test("modo sombra espera dois segundos e nunca sobrepõe inferências", async () => {
  let now = 0;
  let inferCalls = 0;
  let finishInference;
  const inference = new Promise((resolve) => {
    finishInference = resolve;
  });
  const results = [];
  const statuses = [];
  const engine = new NeuralPianoShadowEngine({
    clock: () => now,
    inferenceIntervalMs: 0,
    runtimeLoader: async () => ({
      infer: async () => {
        inferCalls += 1;
        await inference;
        return fakeModelOutput({ active: [{ midi: 69, frame: 0.8 }] });
      },
      dispose() {},
    }),
    onResult: (result) => results.push(result),
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(await engine.setEnabled(true), true);
  engine.setExpected([69]);
  engine.pushPcm(new Float32Array(20_000), 22_050);
  assert.equal(inferCalls, 0);
  assert.equal(statuses.at(-1), "warming");

  engine.pushPcm(new Float32Array(30_000), 22_050);
  await nextTurn();
  assert.equal(inferCalls, 1);
  now = 20;
  engine.pushPcm(new Float32Array(10_000), 22_050);
  await nextTurn();
  assert.equal(inferCalls, 1);

  finishInference();
  await nextTurn();
  assert.equal(results.length, 1);
  assert.equal(results[0].expected[0].midi, 69);
  assert.equal(results[0].latencyMs, 20);
});
