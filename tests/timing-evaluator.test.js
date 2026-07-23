import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTiming,
  createPulseGrid,
  eventsToSchedule,
  markMissed,
  matchOnset,
  summarizeAttempts,
} from "../src/core/timing-evaluator.js";

test("classifica ataques adiantados, no tempo e atrasados", () => {
  assert.equal(classifyTiming(-160, 110).grade, "early");
  assert.equal(classifyTiming(-110, 110).grade, "on-time");
  assert.equal(classifyTiming(0, 110).grade, "on-time");
  assert.equal(classifyTiming(111, 110).grade, "late");
});

test("agenda eventos musicais pelo BPM", () => {
  const schedule = eventsToSchedule([
    { beat: 0 },
    { beat: 1 },
    { beat: 2.5 },
  ], 120, 1_000);
  assert.deepEqual(schedule.map((event) => event.expectedMs), [1_000, 1_500, 2_250]);
});

test("associa ataque ao evento mais próximo sem reutilizá-lo", () => {
  const schedule = eventsToSchedule([{ beat: 0 }, { beat: 1 }], 60, 1_000);
  const first = matchOnset(schedule, 1_070);
  assert.equal(first.grade, "on-time");
  assert.equal(first.offsetMs, 70);
  assert.equal(matchOnset(schedule, 1_100), null);
  const second = matchOnset(schedule, 2_170);
  assert.equal(second.grade, "late");
});

test("marca eventos vencidos e resume a sessão", () => {
  const schedule = eventsToSchedule([{ beat: 0 }, { beat: 1 }], 60, 1_000);
  assert.equal(markMissed(schedule, 1_500, 300).length, 1);
  const summary = summarizeAttempts([
    { grade: "on-time", offsetMs: -40 },
    { grade: "late", offsetMs: 180 },
  ], 1);
  assert.deepEqual(summary, {
    total: 3,
    played: 2,
    onTime: 1,
    missed: 1,
    accuracy: 33,
    meanAbsoluteOffsetMs: 110,
  });
});

test("cria grade para PDF com subdivisões", () => {
  const grid = createPulseGrid({
    bpm: 60,
    startMs: 0,
    subdivision: 2,
    bars: 2,
    beatsPerBar: 4,
  });
  assert.equal(grid.length, 16);
  assert.equal(grid[1].expectedMs, 500);
  assert.equal(grid.at(-1).expectedMs, 7_500);
});
