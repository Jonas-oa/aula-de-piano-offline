import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateNeuralFollowResult,
  FloatRingBuffer,
  NeuralPianoShadowEngine,
  StreamingLinearResampler,
  summarizeBasicPitchOutputs,
} from "../src/core/neural-piano-shadow-engine.js";
import {
  createFollowState,
  currentEvent,
  registerChord,
} from "../src/core/follow-evaluator.js";

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

test("portão neural aceita somente a nota esperada com presença e ataque fortes", () => {
  const result = summarizeBasicPitchOutputs(
    fakeModelOutput({
      active: [
        { midi: 57, frame: 0.87, onset: 0.77 },
        { midi: 55, frame: 0.71, onset: 0.56 },
        { midi: 69, frame: 0.25, onset: 0.76 },
      ],
    }),
    [57],
  );

  const decision = evaluateNeuralFollowResult(result, [57]);
  assert.equal(decision.accepted, true);
  assert.equal(decision.reason, "match");
  assert.deepEqual(decision.expected, [57]);
  assert.ok(Math.abs(decision.confidence - 0.77) < 1e-6);
  assert.ok(Math.abs(decision.strongestUnexpected - 0.56) < 1e-6);
});

test("portão neural recusa nota fraca, ambígua ou calculada para cursor antigo", () => {
  const weak = summarizeBasicPitchOutputs(
    fakeModelOutput({ active: [{ midi: 57, frame: 0.8, onset: 0.2 }] }),
    [57],
  );
  assert.equal(evaluateNeuralFollowResult(weak, [57]).reason, "below-threshold");

  const ambiguous = summarizeBasicPitchOutputs(
    fakeModelOutput({
      active: [
        { midi: 57, frame: 0.7, onset: 0.6 },
        { midi: 55, frame: 0.8, onset: 0.7 },
      ],
    }),
    [57],
  );
  assert.equal(evaluateNeuralFollowResult(ambiguous, [57]).reason, "ambiguous");
  assert.equal(evaluateNeuralFollowResult(ambiguous, [60]).reason, "stale-expected");
});

test("portão neural bloqueia o falso positivo observado no diagnóstico do celular", () => {
  const result = summarizeBasicPitchOutputs(
    fakeModelOutput({
      active: [
        { midi: 60, frame: 0.104, onset: 0.12 },
        { midi: 81, frame: 0.709, onset: 0.718 },
      ],
    }),
    [60],
  );

  const decision = evaluateNeuralFollowResult(result, [60]);
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, "below-threshold");
  assert.deepEqual(decision.belowThreshold, [60]);
});

test("simulação integrada impede avanço duplo quando o motor atual chega primeiro", () => {
  const follow = createFollowState([{ midis: [57] }, { midis: [60] }]);
  const neuralForFirstNote = summarizeBasicPitchOutputs(
    fakeModelOutput({ active: [{ midi: 57, frame: 0.87, onset: 0.77 }] }),
    [57],
  );
  assert.equal(
    evaluateNeuralFollowResult(neuralForFirstNote, currentEvent(follow).midis).accepted,
    true,
  );

  // Enquanto o modelo calculava, o motor acústico atual reconheceu a nota.
  assert.equal(registerChord(follow, [57]).type, "advance");
  assert.deepEqual(currentEvent(follow).midis, [60]);

  // O resultado neural atrasado pertence ao evento anterior e não pode avançar
  // o Dó4 que agora está no cursor.
  const stale = evaluateNeuralFollowResult(
    neuralForFirstNote,
    currentEvent(follow).midis,
  );
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "stale-expected");
  assert.equal(follow.index, 1);
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

  engine.setExpected([60]);
  finishInference();
  await nextTurn();
  assert.equal(results.length, 1);
  // A inferência iniciada para Lá4 não pode ser reatribuída ao Dó4 enquanto
  // o modelo ainda está calculando.
  assert.equal(results[0].expected[0].midi, 69);
  assert.equal(results[0].latencyMs, 20);
});
