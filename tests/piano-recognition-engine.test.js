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
  assert.equal(engine.process(lowPianoSignal(52), SAMPLE_RATE, 10).outcome, "match");

  engine.armExpected([52], 1000);
  assert.equal(engine.process(new Float32Array(SAMPLE_COUNT), SAMPLE_RATE, 1200).outcome, "pending");
  assert.equal(engine.isArmedFor([52]), true);
});

test("nota repetida exige soltura ou um novo ataque antes de avançar outra vez", () => {
  const engine = new PianoRecognitionEngine({ analysisIntervalMs: 0 });
  const signal = lowPianoSignal(52);

  engine.armExpected([52], 0);
  assert.equal(engine.process(signal, SAMPLE_RATE, 10).outcome, "match");
  engine.armExpected([52], 20);
  assert.equal(engine.process(signal, SAMPLE_RATE, 30).outcome, "pending");

  engine.process(new Float32Array(SAMPLE_COUNT), SAMPLE_RATE, 40);
  assert.equal(engine.process(signal, SAMPLE_RATE, 50).outcome, "match");
});
