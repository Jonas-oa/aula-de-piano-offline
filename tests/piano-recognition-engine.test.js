import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeExpectedChord,
  PianoRecognitionEngine,
} from "../src/core/piano-recognition-engine.js";
import { midiToFrequency } from "../src/core/music.js";

const SAMPLE_RATE = 48_000;
const SAMPLE_COUNT = 8192;

function pianoSignal(midis, { amplitude = 0.17, noise = 0.0005 } = {}) {
  const result = new Float32Array(SAMPLE_COUNT);
  let seed = 123456789;
  for (let index = 0; index < result.length; index += 1) {
    let value = 0;
    for (const midi of midis) {
      const frequency = midiToFrequency(midi);
      const phase = (2 * Math.PI * frequency * index) / SAMPLE_RATE;
      value += amplitude * Math.sin(phase);
      value += amplitude * 0.24 * Math.sin(phase * 2 + 0.3);
      value += amplitude * 0.09 * Math.sin(phase * 3 + 0.7);
    }
    seed = (1664525 * seed + 1013904223) >>> 0;
    value += noise * ((seed / 0xffffffff) * 2 - 1);
    result[index] = value;
  }
  return result;
}

function lowPianoSignal(midi) {
  const result = new Float32Array(SAMPLE_COUNT);
  const frequency = midiToFrequency(midi);
  for (let index = 0; index < result.length; index += 1) {
    const phase = (2 * Math.PI * frequency * index) / SAMPLE_RATE;
    result[index] = 0.014 * Math.sin(phase)
      + 0.055 * Math.sin(phase * 2 + 0.2)
      + 0.008 * Math.sin(phase * 3 + 0.6);
  }
  return result;
}

test("reconhece nota avulsa e rejeita uma altura diferente", () => {
  const correct = analyzeExpectedChord(pianoSignal([60]), SAMPLE_RATE, [60]);
  assert.equal(correct.status, "match");
  assert.deepEqual(correct.detected, [60]);

  const wrong = analyzeExpectedChord(pianoSignal([62]), SAMPLE_RATE, [60]);
  assert.notEqual(wrong.status, "match");
  assert.deepEqual(wrong.missing, [60]);
  assert.ok(wrong.extra.includes(62));
});

test("reconhece tríades maiores e menores em todas as fundamentais", () => {
  for (let root = 48; root < 60; root += 1) {
    for (const intervals of [[0, 4, 7], [0, 3, 7]]) {
      const chord = intervals.map((interval) => root + interval);
      const result = analyzeExpectedChord(pianoSignal(chord), SAMPLE_RATE, chord);
      assert.equal(
        result.status,
        "match",
        `falhou no acorde ${chord.join("-")}: ${JSON.stringify({
          missing: result.missing,
          extra: result.extra,
        })}`,
      );
    }
  }
});

test("informa notas ausentes e extras sem aceitar o acorde", () => {
  const expected = [60, 64, 67];
  const incomplete = analyzeExpectedChord(pianoSignal([60, 67]), SAMPLE_RATE, expected);
  assert.notEqual(incomplete.status, "match");
  assert.ok(incomplete.missing.includes(64));

  const extra = analyzeExpectedChord(pianoSignal([60, 64, 67, 70]), SAMPLE_RATE, expected);
  assert.equal(extra.status, "extra");
  assert.ok(extra.extra.includes(70));
});

test("silêncio não produz notas", () => {
  const result = analyzeExpectedChord(new Float32Array(SAMPLE_COUNT), SAMPLE_RATE, [60, 64, 67]);
  assert.equal(result.status, "silence");
  assert.deepEqual(result.detected, []);
});

test("reconhece Mi 3 grave mesmo quando o segundo harmônico é mais forte", () => {
  const result = analyzeExpectedChord(lowPianoSignal(52), SAMPLE_RATE, [52]);
  assert.equal(result.status, "match");
  assert.deepEqual(result.detected, [52]);
  assert.deepEqual(result.extra, []);
});

test("motor temporal exige estabilidade e encerra tentativas incorretas", () => {
  const engine = new PianoRecognitionEngine({
    stableFrames: 2,
    analysisIntervalMs: 0,
    attemptWindowMs: 100,
  });
  const signal = pianoSignal([60, 64, 67]);
  engine.startAttempt([60, 64, 67], 0);
  assert.equal(engine.process(signal, SAMPLE_RATE, 10).outcome, "pending");
  assert.equal(engine.process(signal, SAMPLE_RATE, 20).outcome, "match");

  engine.startAttempt([60, 64, 67], 1000);
  const wrong = engine.process(pianoSignal([60, 67]), SAMPLE_RATE, 1100);
  assert.equal(wrong.outcome, "wrong");
  assert.ok(wrong.missing.includes(64));
});

test("escuta contínua responde em um quadro para nota avulsa e não expira no silêncio", () => {
  const engine = new PianoRecognitionEngine({
    analysisIntervalMs: 0,
    attemptWindowMs: 100,
  });
  engine.armExpected([52], 0);
  engine.noteAttack();
  assert.equal(engine.process(lowPianoSignal(52), SAMPLE_RATE, 10).outcome, "match");

  engine.armExpected([52], 1000);
  assert.equal(engine.process(new Float32Array(SAMPLE_COUNT), SAMPLE_RATE, 1200).outcome, "pending");
  assert.equal(engine.isArmedFor([52]), true);
});

test("nota repetida exige soltura ou um novo ataque antes de avançar outra vez", () => {
  const engine = new PianoRecognitionEngine({ analysisIntervalMs: 0 });
  const signal = lowPianoSignal(52);

  engine.armExpected([52], 0);
  engine.noteAttack();
  assert.equal(engine.process(signal, SAMPLE_RATE, 10).outcome, "match");
  engine.armExpected([52], 20);
  assert.equal(engine.process(signal, SAMPLE_RATE, 30).outcome, "pending");

  engine.process(new Float32Array(SAMPLE_COUNT), SAMPLE_RATE, 40);
  engine.noteAttack();
  assert.equal(engine.process(signal, SAMPLE_RATE, 50).outcome, "match");
});

test("escuta contínua exige ataque novo e contabiliza um erro por ataque", () => {
  const engine = new PianoRecognitionEngine({
    analysisIntervalMs: 0,
    stableFrames: 1,
  });
  const correct = pianoSignal([60]);
  const wrong = pianoSignal([62]);

  engine.armExpected([60], 0);
  assert.equal(
    engine.process(correct, SAMPLE_RATE, 10).outcome,
    "pending",
    "ressonância sem ataque não pode avançar",
  );

  engine.noteAttack();
  const firstWrong = engine.process(wrong, SAMPLE_RATE, 20);
  assert.equal(firstWrong.outcome, "wrong");
  assert.equal(firstWrong.status, "wrong");
  assert.equal(engine.process(wrong, SAMPLE_RATE, 30).outcome, "pending");

  engine.noteAttack();
  assert.equal(engine.process(correct, SAMPLE_RATE, 40).outcome, "match");
});

test("o primeiro ataque depois de armar já vale, sem esperar a batida seguinte", () => {
  // Caminho real do modo professor quando o cursor foi movido sem rearmar (por
  // exemplo, arrastando a pauta): o ataque chega junto com o evento esperado.
  // Se o ataque for registrado antes de armar, `startAttempt` o descarta e o
  // aluno precisa tocar a nota duas vezes para o cursor andar.
  const engine = new PianoRecognitionEngine();
  const correct = pianoSignal([64]);

  engine.armForAttack([64], 0);
  assert.equal(
    engine.process(correct, SAMPLE_RATE, 10).outcome,
    "match",
    "a nota tocada no mesmo instante do armar precisa ser reconhecida",
  );
});

test("armForAttack não descarta o progresso de um evento já armado", () => {
  // Rearmar o mesmo evento a cada quadro zeraria os quadros estáveis e um
  // acorde nunca fecharia.
  const engine = new PianoRecognitionEngine();
  const chord = [60, 64, 67];
  const signal = pianoSignal(chord);

  engine.armForAttack(chord, 0);
  const first = engine.attempt;
  engine.armForAttack(chord, 5);
  assert.equal(engine.attempt, first, "o mesmo evento não pode virar tentativa nova");
});

test("erro de semitom é apontado em vez de virar vazamento", () => {
  // O engano mais comum do aluno: tocar a tecla vizinha da nota escrita.
  const wrongNeighbour = analyzeExpectedChord(
    pianoSignal([60, 64, 66]),
    SAMPLE_RATE,
    [60, 64, 67],
  );
  assert.deepEqual(wrongNeighbour.missing, [67]);
  assert.ok(wrongNeighbour.extra.includes(66), "o Fá♯ tocado precisa ser relatado");

  // Com a nota certa e a vizinha soando juntas, só a intrusa é extra.
  const both = analyzeExpectedChord(pianoSignal([60, 61]), SAMPLE_RATE, [60]);
  assert.equal(both.status, "extra");
  assert.deepEqual(both.extra, [61]);
});

test("acorde correto não gera nota extra por vazamento espectral", () => {
  for (const chord of [[60, 64, 67], [48, 60, 64, 67], [36, 43, 52, 60, 64, 67, 72, 79]]) {
    const analysis = analyzeExpectedChord(pianoSignal(chord), SAMPLE_RATE, chord);
    assert.equal(analysis.status, "match", `acorde ${chord.join("+")} deveria bater`);
    assert.deepEqual(analysis.extra, [], `acorde ${chord.join("+")} não pode ter extras`);
  }
});

test("no grave o motor se cala em vez de inventar nota extra", () => {
  // A 65 Hz, dois semitons distam menos que a resolução do quadro: apontar a
  // vizinha ali seria ruído, não informação.
  const low = analyzeExpectedChord(pianoSignal([36]), SAMPLE_RATE, [36]);
  assert.equal(low.status, "match");
  assert.deepEqual(low.extra, []);
});

test("uma oitava acima não é confundida com a nota escrita", () => {
  const analysis = analyzeExpectedChord(pianoSignal([72]), SAMPLE_RATE, [60]);
  assert.deepEqual(analysis.missing, [60]);
  assert.ok(analysis.extra.includes(72));
});
