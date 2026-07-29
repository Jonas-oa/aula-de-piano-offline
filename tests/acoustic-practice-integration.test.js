import assert from "node:assert/strict";
import test from "node:test";

import { registerChord, createFollowState } from "../src/core/follow-evaluator.js";
import { midiToFrequency } from "../src/core/music.js";
import { AdaptiveOnsetDetector } from "../src/core/onset-engine.js";
import { PianoRecognitionEngine } from "../src/core/piano-recognition-engine.js";

const SAMPLE_RATE = 48_000;
const SAMPLE_COUNT = 8192;

function rmsOf(samples) {
  let squares = 0;
  for (const sample of samples) squares += sample * sample;
  return Math.sqrt(squares / samples.length);
}

function pianoAttack(midi, {
  fundamental = 0.002,
  second = 0.05,
  third = 0.012,
} = {}) {
  const result = new Float32Array(SAMPLE_COUNT);
  const frequency = midiToFrequency(midi);
  for (let index = 0; index < result.length; index += 1) {
    const phase = (2 * Math.PI * frequency * index) / SAMPLE_RATE;
    result[index] = fundamental * Math.sin(phase)
      + second * Math.sin(phase * 2 + 0.2)
      + third * Math.sin(phase * 3 + 0.6);
  }
  return result;
}

test("fluxo acústico completo avança no Lá 2 mesmo com fundamental atenuada", () => {
  const follow = createFollowState([{ midis: [45] }, { midis: [57] }]);
  const onset = new AdaptiveOnsetDetector();
  const recognition = new PianoRecognitionEngine({ analysisIntervalMs: 0 });
  const a2 = pianoAttack(45);

  recognition.armExpected([45], 0);
  for (let index = 0; index < 20; index += 1) onset.process(0.0008, index * 12);
  const attack = onset.process(rmsOf(a2.subarray(SAMPLE_COUNT - 2048)), 300);
  assert.equal(attack.isAttack, true);

  recognition.armForAttack([45], 300);
  const analysis = recognition.process(a2, SAMPLE_RATE, 312);
  assert.equal(analysis.outcome, "match");
  assert.deepEqual(analysis.inferred, [45]);

  const progress = registerChord(follow, analysis.detected);
  assert.equal(progress.type, "advance");
  assert.equal(follow.index, 1);
  assert.deepEqual(follow.events[follow.index].midis, [57]);
});

test("dezesseis ataques continuam detectáveis sobre ressonância acumulada", () => {
  const detector = new AdaptiveOnsetDetector();
  const attacks = Array.from({ length: 16 }, (_, index) => 504 + index * 504);
  const detected = [];

  for (let timestamp = 0; timestamp <= attacks.at(-1) + 1000; timestamp += 12) {
    let level = 0.0008;
    for (const attackAt of attacks) {
      if (timestamp < attackAt) continue;
      level += 0.025 * Math.exp(-(timestamp - attackAt) / 650);
    }
    if (detector.process(level, timestamp).isAttack) detected.push(timestamp);
  }

  assert.equal(detected.length, attacks.length);
  detected.forEach((timestamp, index) => {
    assert.ok(
      Math.abs(timestamp - attacks[index]) <= 12,
      `ataque ${index + 1} desviou para ${timestamp} ms`,
    );
  });
});
