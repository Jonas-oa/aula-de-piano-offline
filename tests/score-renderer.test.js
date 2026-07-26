import test from "node:test";
import assert from "node:assert/strict";

import {
  bassClefGeometry,
  isExplicitMeasureBoundary,
  isOnBassStaff,
  scoreHeadline,
  scoreIndexForDrag,
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

test("clave de Fá referencia a quarta linha da pauta, entre os dois pontos", () => {
  const geometry = bassClefGeometry();
  const fourthLineFromBottom = geometry.staffLines.at(-4);

  assert.equal(geometry.fLineY, fourthLineFromBottom);
  assert.equal(
    (geometry.dotYs[0] + geometry.dotYs[1]) / 2,
    geometry.fLineY,
  );
  assert.ok(geometry.dotYs[0] < geometry.fLineY);
  assert.ok(geometry.dotYs[1] > geometry.fLineY);
});

test("a clave segue o staff do MusicXML, não o corte pelo dó central", () => {
  // Mão esquerda escrita acima do dó central: pertence à clave de fá.
  assert.equal(isOnBassStaff({ pitch: "E4", staff: 2 }, true), true);
  // Mão direita cruzando para o grave: continua na clave de sol.
  assert.equal(isOnBassStaff({ pitch: "A2", staff: 1 }, true), false);
  // Sem staff (exercícios e transcrições antigas), vale o palpite pelo dó central.
  assert.equal(isOnBassStaff({ pitch: "A2" }, true), true);
  assert.equal(isOnBassStaff({ pitch: "E4" }, true), false);
  // Pauta simples nunca manda nada para a clave de fá.
  assert.equal(isOnBassStaff({ pitch: "A2", staff: 2 }, false), false);
  assert.equal(isOnBassStaff({ pitch: "inválido" }, true), false);
});

test("cabeçalho não exibe separador solto quando falta a tonalidade", () => {
  const base = { id: "x", bpm: 72, timeSignature: "3/4", notes: [] };

  assert.equal(scoreHeadline(base), "72 bpm · 3/4");
  assert.equal(scoreHeadline({ ...base, key: "Dó maior" }), "Dó maior · 72 bpm · 3/4");
  assert.equal(scoreHeadline({ ...base, key: "", timeSignature: "", beatsPerBar: 0 }), "72 bpm");
  assert.doesNotMatch(scoreHeadline(base), /^\s*·/);
});

test("arrastar a pauta converte o deslocamento em avanço e retorno de notas", () => {
  assert.equal(scoreIndexForDrag(10, -88, 850, 660), 11);
  assert.equal(scoreIndexForDrag(10, 88, 850, 660), 9);
  assert.equal(scoreIndexForDrag(0, 880, 850, 660), 0);
  assert.equal(scoreIndexForDrag(659, -880, 850, 660), 659);
});
