import test from "node:test";
import assert from "node:assert/strict";
import {
  parseReadingPattern,
  readingExercises,
  READING_LEVELS,
  READING_SKILLS,
} from "../src/data/reading-exercises.js";

const EPSILON = 1e-7;

test("oferece 36 exercícios livres, distribuídos do nível 0 ao 8", () => {
  assert.equal(readingExercises.length, 36);
  assert.equal(READING_LEVELS.length, 9);
  for (const level of READING_LEVELS) {
    assert.equal(
      readingExercises.filter((exercise) => exercise.level === level.id).length,
      4,
      `Nível ${level.id} deve ter quatro exercícios`,
    );
  }
  assert.deepEqual(
    new Set(readingExercises.map((exercise) => exercise.skill)),
    new Set(READING_SKILLS),
  );
});

test("não inclui bloqueios, metas obrigatórias nem estado de aluno", () => {
  const gatedFields = ["locked", "unlocked", "requiredScore", "progress", "studentId"];
  for (const exercise of readingExercises) {
    assert.equal(exercise.type, "reading");
    assert.equal(exercise.composer, "Exercício original do aplicativo");
    for (const field of gatedFields) assert.equal(field in exercise, false, `${exercise.id}: ${field}`);
  }
});

test("todos os compassos, eventos, pausas e alturas são válidos", () => {
  for (const exercise of readingExercises) {
    assert.ok(exercise.events.length > 0, `${exercise.id} precisa ter notas`);
    assert.ok(exercise.measures.length >= 2, `${exercise.id} é curto demais`);

    const attacks = [...exercise.events, ...exercise.rests].sort((a, b) => a.beat - b.beat);
    const finalBeat = Math.max(...attacks.map(({ beat, duration }) => beat + duration));
    const notatedBeats = exercise.measures.length * exercise.beatsPerBar;
    assert.ok(Math.abs(finalBeat - notatedBeats) < EPSILON, `${exercise.id} não fecha o compasso`);

    for (const event of exercise.events) {
      assert.ok(event.duration > 0);
      assert.equal(event.pitches.length, event.midis.length);
      assert.equal(event.notes.length, event.midis.length);
      assert.ok(event.midis.every(Number.isFinite), `${exercise.id} contém altura inválida`);
      assert.equal(event.measureIndex, Math.floor((event.beat + EPSILON) / exercise.beatsPerBar));
    }
  }
});

test("a sequência cobre leitura visual, pausas, acidentes, acordes e métricas irregulares", () => {
  assert.ok(readingExercises.some(({ rests }) => rests.length > 0), "Faltam pausas escritas");
  assert.ok(readingExercises.some(({ events }) => events.some(({ duration }) => duration === 0.25)), "Faltam semicolcheias");
  assert.ok(readingExercises.some(({ events }) => events.some(({ midis }) => midis.length >= 6)), "Faltam acordes densos");
  assert.ok(readingExercises.some(({ timeSignature }) => timeSignature === "5/8"));
  assert.ok(readingExercises.some(({ timeSignature }) => timeSignature === "7/8"));
  assert.ok(readingExercises.some(({ timeSignature }) => timeSignature === "12/8"));
  assert.ok(readingExercises.some(({ keyFifths }) => Math.abs(keyFifths) >= 4));
});

test("parser preserva acordes, mãos, pausas, compassos e repetições", () => {
  const parsed = parseReadingPattern("C3+E4/1 R/.5 F#4/.5", { repeats: 2, beatsPerBar: 2 });
  assert.equal(parsed.events.length, 4);
  assert.equal(parsed.rests.length, 2);
  assert.equal(parsed.totalBeats, 4);
  assert.deepEqual(parsed.events[0].midis, [48, 64]);
  assert.deepEqual(parsed.events[0].notes.map(({ staff }) => staff), [2, 1]);
  assert.equal(parsed.events.at(-1).measureNumber, 2);
});
