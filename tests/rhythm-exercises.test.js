import test from "node:test";
import assert from "node:assert/strict";
import { rhythmExercises, parseRhythmPattern, pitchToMidi } from "../src/data/rhythm-exercises.js";

test("mantém 24 exercícios rítmicos reais e de escolha livre", () => {
  assert.equal(rhythmExercises.length, 24);
  assert.deepEqual(
    new Set(rhythmExercises.map((exercise) => exercise.level)),
    new Set(["iniciante", "intermediario", "avancado"]),
  );
  for (const style of ["Jazz", "Blues", "Forró/Baião", "Samba", "Gospel"]) {
    assert.ok(rhythmExercises.some((exercise) => exercise.style === style), `Falta ${style}`);
  }
});

test("todos os exercícios usam as duas mãos e fecham o compasso", () => {
  for (const exercise of rhythmExercises) {
    assert.ok(exercise.events.length >= 16, `${exercise.id} é curto demais`);
    assert.ok(exercise.events.some((event) => event.midis.some((midi) => midi < 60)));
    assert.ok(exercise.events.some((event) => event.midis.some((midi) => midi >= 60)));
    const total = exercise.events.at(-1).beat + exercise.events.at(-1).duration;
    assert.ok(Math.abs(total % exercise.beatsPerBar) < 0.0001, `${exercise.id} não fecha o compasso`);
  }
});

test("parser preserva ataques, acordes e durações", () => {
  const events = parseRhythmPattern("C3+C4+E4/1 G3/.5 A3+D4/.5", 2);
  assert.equal(events.length, 6);
  assert.deepEqual(events.slice(0, 3).map((event) => event.beat), [0, 1, 1.5]);
  assert.deepEqual(events[0].midis, [48, 60, 64]);
  assert.equal(events.at(-1).beat, 3.5);
  assert.equal(pitchToMidi("F#4"), 66);
});
