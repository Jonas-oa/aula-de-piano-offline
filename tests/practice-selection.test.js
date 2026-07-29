import assert from "node:assert/strict";
import test from "node:test";

import {
  availablePracticeHands,
  derivePracticeEvents,
  normalizeMeasureRange,
  practiceHandForNote,
  selectedPracticeEvents,
} from "../src/core/practice-selection.js";

const events = [
  {
    beat: 0,
    duration: 2,
    measureIndex: 0,
    measureNumber: "1",
    notes: [
      { pitch: "C3", midi: 48, staff: 1, clef: "bass", partIndex: 1, duration: 2 },
      { pitch: "E4", midi: 64, staff: 1, clef: "treble", partIndex: 0, duration: 1 },
    ],
    midis: [48, 64],
    pitches: ["C3", "E4"],
  },
  {
    beat: 2,
    duration: 2,
    measureIndex: 0,
    measureNumber: "1",
    notes: [{ pitch: "G4", midi: 67, staff: 1, clef: "treble", duration: 2 }],
    midis: [67],
    pitches: ["G4"],
  },
  {
    beat: 4,
    duration: 1,
    measureIndex: 1,
    measureNumber: "2",
    notes: [{ pitch: "G2", midi: 43, staff: 2, clef: "bass", duration: 1 }],
    midis: [43],
    pitches: ["G2"],
  },
  {
    beat: 5,
    duration: 1,
    measureIndex: 1,
    measureNumber: "2",
    notes: [{ pitch: "D5", midi: 74, staff: 1, clef: "treble", duration: 1 }],
    midis: [74],
    pitches: ["D5"],
  },
];

test("a clave vence o staff local ao identificar a mão", () => {
  assert.equal(practiceHandForNote({ staff: 1, clef: "bass", midi: 48 }), "left");
  assert.equal(practiceHandForNote({ staff: 2, clef: "treble", midi: 72 }), "right");
  assert.equal(practiceHandForNote({ staff: 2, midi: 64 }), "left");
});

test("deriva uma sessão por mão sem alterar os eventos da partitura", () => {
  const snapshot = structuredClone(events);
  const right = derivePracticeEvents(events, "right");
  const left = derivePracticeEvents(events, "left");

  assert.deepEqual(right.map((event) => event.originalIndex), [0, 1, 3]);
  assert.deepEqual(right.map((event) => event.midis), [[64], [67], [74]]);
  assert.deepEqual(left.map((event) => event.originalIndex), [0, 2]);
  assert.deepEqual(left.map((event) => event.midis), [[48], [43]]);
  assert.deepEqual(events, snapshot);
});

test("informa quais mãos realmente existem na peça", () => {
  assert.deepEqual(availablePracticeHands(events), { right: true, left: true });
  assert.deepEqual(
    availablePracticeHands(events.map((event) => ({
      ...event,
      notes: event.notes.filter((note) => note.clef === "treble"),
    }))),
    { right: true, left: false },
  );
});

test("seleção é encaixada nos limites dos compassos", () => {
  assert.deepEqual(
    normalizeMeasureRange(events, 1, 2),
    { a: 0, b: 3, startMeasure: 0, endMeasure: 1 },
  );
  assert.deepEqual(
    normalizeMeasureRange(events, 2, 2),
    { a: 2, b: 3, startMeasure: 1, endMeasure: 1 },
  );
});

test("trecho e mão são combinados preservando índices da pauta", () => {
  const selected = selectedPracticeEvents(events, "right", { a: 2, b: 3 });
  assert.deepEqual(selected.map((event) => event.originalIndex), [3]);
  assert.deepEqual(selected[0].midis, [74]);
});
