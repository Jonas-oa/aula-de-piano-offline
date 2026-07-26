import test from "node:test";
import assert from "node:assert/strict";

import {
  isExplicitMeasureBoundary,
  scoreIndexesToRefresh,
  scoreVerticalBounds,
  scoreViewBox,
} from "../src/ui/score-renderer.js";

function grandScore(pitches) {
  return {
    clef: "grand",
    notes: pitches.map((pitch, index) => ({
      measureIndex: Math.floor(index / 2),
      pitches: [{ pitch, duration: 0.5 }],
    })),
  };
}

test("enquadramento vertical abre espaço para notas muito agudas e graves", () => {
  const centered = scoreVerticalBounds(grandScore(["C5", "E5"]), 0);
  const high = scoreVerticalBounds(grandScore(["C8", "E7"]), 0);
  const low = scoreVerticalBounds(grandScore(["C1", "E1"]), 0);

  assert.ok(high.minY < centered.minY);
  assert.ok(high.height > centered.height);
  assert.ok(low.maxY > centered.maxY);
  assert.ok(low.height > centered.height);
  assert.match(scoreViewBox(grandScore(["C8"]), 0), /^35 -?\d+ 850 \d+$/);
});

test("enquadramento considera somente a janela de notas que está sendo estudada", () => {
  const score = grandScore([
    "C8", "D8", "C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6", "D5", "E5",
  ]);
  const beginning = scoreVerticalBounds(score, 0);
  const later = scoreVerticalBounds(score, 10);

  assert.ok(beginning.minY < later.minY);
});

test("linhas de compasso seguem a medida explícita do MusicXML", () => {
  const notes = [
    { measureIndex: 0 },
    { measureIndex: 0 },
    { measureIndex: 1 },
    { measureIndex: 1 },
    { measureIndex: 3 },
  ];

  assert.equal(isExplicitMeasureBoundary(notes, 0), true);
  assert.equal(isExplicitMeasureBoundary(notes, 1), false);
  assert.equal(isExplicitMeasureBoundary(notes, 2), true);
  assert.equal(isExplicitMeasureBoundary(notes, 3), false);
  assert.equal(isExplicitMeasureBoundary(notes, 4), true);
});

test("avanço da pauta atualiza apenas as notas vizinhas em peças longas", () => {
  assert.deepEqual(scoreIndexesToRefresh(660, null, 0).length, 660);
  assert.deepEqual(scoreIndexesToRefresh(660, 9, 10), [8, 9, 10]);
  assert.deepEqual(scoreIndexesToRefresh(660, 10, 11), [9, 10, 11]);
});
