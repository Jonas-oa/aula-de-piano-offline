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
  return { frames, onsets, frameCount, noteCount };
}

function rmsOf(samples) {
  let squares = 0;
  for (const sample of samples) squares += sample * sample;
  return Math.sqrt(squares / samples.length);
}

function sineAt(frequency, sampleRate, length) {
  return Float32Array.from(
    { length },
    (_, index) => Math.sin((2 * Math.PI * frequency * index) / sampleRate),
  );
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

test("reamostragem barra o agudo que dobraria para dentro da banda", () => {
  const sampleRate = 48_000;
  // 15 kHz não existe como fundamental no piano e, sem filtro, a decimação o
  // devolveria como um fantasma em 7 kHz — em cima da região que o modelo usa.
  const alias = sineAt(15_000, sampleRate, 24_000);
  const musical = sineAt(1_000, sampleRate, 24_000);

  const aliasRms = rmsOf(new StreamingLinearResampler().process(alias, sampleRate));
  const musicalRms = rmsOf(new StreamingLinearResampler().process(musical, sampleRate));

  assert.ok(aliasRms < rmsOf(alias) * 0.2, `sobrou agudo demais: ${aliasRms}`);
  assert.ok(musicalRms > rmsOf(musical) * 0.9, `o filtro comeu o sinal útil: ${musicalRms}`);
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

test("janela cobre todo o áudio desde que a nota foi armada", () => {
  const armado = summarizeBasicPitchOutputs(
    fakeModelOutput({ active: [{ midi: 57, frame: 0.9, onset: 0.8, at: 110 }] }),
    [57],
    { startFrame: 99 },
  );
  // Com a janela fixa de 12 quadros esse ataque cairia no vão entre duas
  // inferências e o portão nunca o veria.
  assert.equal(armado.analyzedFrames, 58);
  assert.equal(evaluateNeuralFollowResult(armado, [57]).accepted, true);

  const semJanelaFixa = summarizeBasicPitchOutputs(
    fakeModelOutput({ active: [{ midi: 57, frame: 0.9, onset: 0.8, at: 110 }] }),
    [57],
  );
  assert.equal(evaluateNeuralFollowResult(semJanelaFixa, [57]).reason, "below-threshold");
});

test("nota recém-armada não é julgada por áudio anterior a ela", () => {
  const result = summarizeBasicPitchOutputs(
    fakeModelOutput({ active: [{ midi: 57, frame: 0.95, onset: 0.9, at: 120 }] }),
    [57],
    { startFrame: 400 },
  );

  assert.equal(result.analyzedFrames, 0);
  assert.equal(result.startFrame, result.endFrame);
  assert.equal(evaluateNeuralFollowResult(result, [57]).reason, "below-threshold");
});

test("altura ainda soando não disputa dominância com a nota atual", () => {
  const result = summarizeBasicPitchOutputs(
    fakeModelOutput({
      active: [
        { midi: 60, frame: 0.72, onset: 0.61 },
        // O Lá3 anterior continua vibrando e ainda traz o próprio ataque na
        // janela, agora que ela cobre o trecho inteiro desde o armar.
        { midi: 57, frame: 0.88, onset: 0.79 },
      ],
    }),
    [60],
  );

  assert.equal(evaluateNeuralFollowResult(result, [60]).reason, "ambiguous");
  const comRessonancia = evaluateNeuralFollowResult(result, [60], { ignoreMidis: [57] });
  assert.equal(comRessonancia.accepted, true);
  assert.equal(comRessonancia.reason, "match");
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

test("a janela analisada acompanha o instante em que o cursor armou a nota", async () => {
  let now = 0;
  const results = [];
  const engine = new NeuralPianoShadowEngine({
    clock: () => now,
    inferenceIntervalMs: 0,
    runtimeLoader: async () => ({
      infer: async () => fakeModelOutput({ active: [{ midi: 69, frame: 0.9, onset: 0.8 }] }),
      dispose() {},
    }),
    onResult: (result) => results.push(result),
  });

  assert.equal(await engine.setEnabled(true), true);
  // A nota foi armada 600 ms atrás: tudo o que soou desde então precisa entrar
  // na conta, e não apenas os últimos 139 ms do buffer.
  engine.setExpected([69], -600);
  engine.requestInference();
  engine.pushPcm(new Float32Array(50_000), 22_050);
  await nextTurn();

  assert.equal(results.length, 1);
  assert.equal(results[0].endFrame, 157);
  assert.equal(results[0].startFrame, 99);
  assert.ok(results[0].analyzedFrames * (256 / 22.05) > 600);
});

test("pré-carregamento prepara o modelo sem ligar captura nem inferência", async () => {
  let loads = 0;
  let inferCalls = 0;
  const statuses = [];
  const engine = new NeuralPianoShadowEngine({
    clock: () => 125,
    runtimeLoader: async () => {
      loads += 1;
      return {
        infer: async () => {
          inferCalls += 1;
          return fakeModelOutput();
        },
        dispose() {},
      };
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(await engine.preload(), true);
  assert.equal(await engine.preload(), true);
  assert.equal(loads, 1);
  assert.equal(engine.enabled, false);
  assert.equal(inferCalls, 0);
  assert.deepEqual(statuses, ["loading", "ready"]);
});

test("modelo neural só infere quando o acústico pede fallback", async () => {
  let inferCalls = 0;
  const engine = new NeuralPianoShadowEngine({
    clock: () => 0,
    inferenceIntervalMs: 0,
    runtimeLoader: async () => ({
      infer: async () => {
        inferCalls += 1;
        return fakeModelOutput({ active: [{ midi: 69, frame: 0.9, onset: 0.8 }] });
      },
      dispose() {},
    }),
  });

  assert.equal(await engine.setEnabled(true), true);
  engine.setExpected([69]);
  engine.pushPcm(new Float32Array(50_000), 22_050);
  await nextTurn();
  assert.equal(inferCalls, 0, "encher o buffer sozinho não deve gastar inferência");

  assert.equal(engine.requestInference(), true);
  engine.pushPcm(new Float32Array(2048), 22_050);
  await nextTurn();
  assert.equal(inferCalls, 1);
});

test("parar e recomeçar durante o carregamento não deixa o modelo morto", async () => {
  let releaseLoad;
  const loadGate = new Promise((resolve) => { releaseLoad = resolve; });
  let loads = 0;
  const runtime = {
    disposed: false,
    infer: async () => fakeModelOutput({ active: [{ midi: 69, frame: 0.9, onset: 0.8 }] }),
    dispose() { this.disposed = true; },
  };
  const engine = new NeuralPianoShadowEngine({
    clock: () => 0,
    runtimeLoader: async () => {
      loads += 1;
      await loadGate;
      return runtime;
    },
  });

  const primeiroInicio = engine.setEnabled(true);
  await engine.setEnabled(false);          // o aluno pressionou Parar
  const segundoInicio = engine.setEnabled(true); // e Iniciar outra vez
  releaseLoad();

  assert.equal(await primeiroInicio, false);
  assert.equal(await segundoInicio, true);
  assert.equal(loads, 1);
  assert.equal(runtime.disposed, false);
  assert.equal(engine.runtime, runtime);

  // Descartar de vez continua liberando o modelo, e uma sessão nova revive a
  // engine em vez de recusar tudo para sempre.
  engine.dispose();
  assert.equal(runtime.disposed, true);
  assert.equal(await engine.setEnabled(true), true);
  assert.equal(loads, 2);
});

test("modelo é descartado quando a inferência falha, para a sessão seguinte recarregar", async () => {
  const statuses = [];
  let loads = 0;
  const engine = new NeuralPianoShadowEngine({
    clock: () => 0,
    inferenceIntervalMs: 0,
    runtimeLoader: async () => {
      loads += 1;
      return {
        infer: async () => { throw new Error("contexto WebGL perdido"); },
        dispose() {},
      };
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(await engine.setEnabled(true), true);
  engine.setExpected([69]);
  engine.requestInference();
  engine.pushPcm(new Float32Array(50_000), 22_050);
  await nextTurn();

  assert.equal(statuses.at(-1), "error");
  assert.equal(engine.runtime, null);
  assert.equal(await engine.setEnabled(true), true);
  assert.equal(loads, 2);
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
  engine.requestInference();
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
