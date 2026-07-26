import test from "node:test";
import assert from "node:assert/strict";

import {
  bassClefGeometry,
  durationNotation,
  isExplicitMeasureBoundary,
  isOnBassStaff,
  keySignaturePitches,
  noteY,
  scoreEventX,
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
  // Em partes separadas, cada parte pode usar staff 1; a clave explícita vence.
  assert.equal(isOnBassStaff({ pitch: "C3", staff: 1, clef: "bass" }, true), true);
  assert.equal(isOnBassStaff({ pitch: "C3", staff: 2, clef: "treble" }, true), false);
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

test("espaçamento horizontal acompanha o tempo musical", () => {
  const song = {
    notes: [
      { beat: 0 },
      { beat: 0.5 },
      { beat: 2 },
    ],
  };
  assert.equal(scoreEventX(song, 1) - scoreEventX(song, 0), 44);
  assert.equal(scoreEventX(song, 2) - scoreEventX(song, 1), 132);
  assert.equal(scoreIndexForDrag(1, -132, 850, 3, song), 2);
});

test("durações pontuadas e bandeirolas são classificadas corretamente", () => {
  assert.deepEqual(durationNotation(3), { base: 2, dots: 1, flags: 0 });
  assert.deepEqual(durationNotation(1.5), { base: 1, dots: 1, flags: 0 });
  assert.deepEqual(durationNotation(0.75), { base: 0.5, dots: 1, flags: 1 });
  assert.deepEqual(durationNotation(0.25), { base: 0.25, dots: 0, flags: 2 });
});

test("armadura usa a ordem musical correta nas duas claves", () => {
  assert.deepEqual(keySignaturePitches(3), ["F5", "C5", "G5"]);
  assert.deepEqual(keySignaturePitches(-2), ["B4", "E5"]);
  assert.deepEqual(keySignaturePitches(2, true), ["F3", "C3"]);
});

test("cada nota cai na linha ou espaço certo das duas claves", () => {
  // Clave de sol: linhas Mi4, Sol4, Si4, Ré5, Fá5 (80 a 128, passo de 6 por grau).
  assert.equal(noteY("E4"), 128, "Mi4 é a primeira linha da clave de sol");
  assert.equal(noteY("F5"), 80, "Fá5 é a quinta linha");
  assert.equal(noteY("A5"), 68, "Lá5 fica na primeira suplementar acima");
  assert.equal(noteY("C4"), 140, "o dó central fica na primeira suplementar abaixo");

  // Clave de fá: linhas Sol2, Si2, Ré3, Fá3, Lá3 (180 a 228).
  assert.equal(noteY("G2", true), 228, "Sol2 é a primeira linha da clave de fá");
  assert.equal(noteY("A3", true), 180, "Lá3 é a quinta linha");
  assert.equal(noteY("C4", true), 168, "o dó central fica na suplementar acima");
  assert.equal(noteY("C2", true), 252, "Dó2 fica na segunda suplementar abaixo");

  // A alteração não muda a linha: Fá♯4 e Fá4 ocupam o mesmo lugar.
  assert.equal(noteY("F#4"), noteY("F4"));
  assert.equal(noteY("Bb3", true), noteY("B3", true));
});
