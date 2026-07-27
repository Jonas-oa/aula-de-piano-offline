import test from "node:test";
import assert from "node:assert/strict";

import {
  MIN_EVENT_SPACING,
  automaticBeamPlan,
  bassClefGeometry,
  beamLineGeometry,
  durationNotation,
  explicitBeamRuns,
  isExplicitMeasureBoundary,
  isOnBassStaff,
  keySignaturePitches,
  noteY,
  notationForPitch,
  metricBeamPattern,
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
  assert.equal(geometry.symbol, "𝄢", "usa o símbolo musical tipográfico padrão");
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
  assert.equal(scoreEventX(song, 1) - scoreEventX(song, 0), MIN_EVENT_SPACING);
  assert.equal(scoreEventX(song, 2) - scoreEventX(song, 1), 132);
  assert.equal(scoreIndexForDrag(1, -132, 850, 3, song), 2);
});

test("ataques rápidos mantêm distância mínima para hastes e acidentes não se sobreporem", () => {
  const song = {
    notes: [
      { beat: 0 },
      { beat: 0.125 },
      { beat: 0.25 },
      { beat: 0.5 },
    ],
  };
  const gaps = song.notes.slice(1).map((_, index) =>
    scoreEventX(song, index + 1) - scoreEventX(song, index));

  assert.deepEqual(gaps, [MIN_EVENT_SPACING, MIN_EVENT_SPACING, MIN_EVENT_SPACING]);
  assert.ok(MIN_EVENT_SPACING >= 60, "a largura precisa acomodar cabeça, haste e alteração");
});

test("durações pontuadas e bandeirolas são classificadas corretamente", () => {
  assert.deepEqual(durationNotation(3), { base: 2, dots: 1, flags: 0 });
  assert.deepEqual(durationNotation(1.5), { base: 1, dots: 1, flags: 0 });
  assert.deepEqual(durationNotation(0.75), { base: 0.5, dots: 1, flags: 1 });
  assert.deepEqual(durationNotation(0.25), { base: 0.25, dots: 0, flags: 2 });
});

test("figura explícita do MusicXML vence a duração sonora de uma tercina", () => {
  assert.deepEqual(
    notationForPitch({ type: "eighth", dotCount: 0, duration: 1 / 3 }),
    { base: 0.5, dots: 0, flags: 1 },
  );
  assert.deepEqual(
    notationForPitch({ type: "16th", dotCount: 1, duration: 0.375 }),
    { base: 0.25, dots: 1, flags: 2 },
  );
});

test("beams explícitos respeitam begin, continue, end e hooks", () => {
  const node = (value) => ({ beams: value ? [{ number: 1, value }] : [] });
  const a = node("begin");
  const b = node("continue");
  const c = node("end");
  const hook = node("forward hook");
  const runs = explicitBeamRuns([a, b, c, node(""), hook], 1);

  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0], { type: "run", nodes: [a, b, c] });
  assert.deepEqual(runs[1], { type: "forward hook", nodes: [hook] });
});

test("pulsação automática diferencia compassos simples, compostos e irregulares", () => {
  assert.deepEqual(metricBeamPattern("4/4"), [1, 1, 1, 1]);
  assert.deepEqual(metricBeamPattern("6/8"), [1.5, 1.5]);
  assert.deepEqual(metricBeamPattern("9/8"), [1.5, 1.5, 1.5]);
  assert.deepEqual(metricBeamPattern("5/8"), [1, 1.5]);
  assert.deepEqual(metricBeamPattern("7/8"), [1, 1, 1.5]);
});

test("fallback agrupa por pulso sem atravessar pausas, compassos ou marcação explícita", () => {
  const node = (beat, extra = {}) => ({
    beat,
    duration: 0.5,
    flags: 1,
    beams: [],
    measureIndex: Math.floor(beat / 4),
    ...extra,
  });
  const explicit = node(2, { beams: [{ number: 1, value: "forward hook" }] });
  const planned = automaticBeamPlan([
    node(0),
    node(0.5),
    node(1),
    node(1.5),
    explicit,
    node(2.5),
    node(3.5),
    node(4),
    node(4.5),
  ], {
    timeSignature: "4/4",
    beatsPerBar: 4,
    measures: [
      { index: 0, beat: 0, duration: 4, timeSignature: "4/4" },
      { index: 1, beat: 4, duration: 4, timeSignature: "4/4" },
    ],
  });

  assert.deepEqual(planned.slice(0, 4).map(({ beams }) => beams[0]?.value), [
    "begin", "end", "begin", "end",
  ]);
  assert.deepEqual(planned[4].beams, explicit.beams, "a marcação de origem tem prioridade");
  assert.deepEqual(planned[5].beams, [], "não atravessa a lacuna deixada por uma pausa");
  assert.deepEqual(planned.slice(7).map(({ beams }) => beams[0]?.value), ["begin", "end"]);
});

test("fallback sem linha do tempo reinicia o agrupamento em cada compasso", () => {
  const planned = automaticBeamPlan(
    Array.from({ length: 12 }, (_, index) => ({
      beat: index * 0.5,
      duration: 0.5,
      flags: 1,
      beams: [],
    })),
    { timeSignature: "4/4", beatsPerBar: 4, measures: [] },
  );

  assert.deepEqual(
    planned.map(({ beams }) => beams[0]?.value),
    [
      "begin", "end", "begin", "end", "begin", "end", "begin", "end",
      "begin", "end", "begin", "end",
    ],
  );
});

test("beam explícito incompleto não apaga a bandeirola de segurança", () => {
  const runs = explicitBeamRuns([
    { beams: [{ number: 1, value: "begin" }] },
    { beams: [] },
  ]);
  assert.deepEqual(runs, []);
});

test("fallback de semicolcheias cria beam secundário e hook quando necessário", () => {
  const planned = automaticBeamPlan([
    { beat: 0, duration: 0.5, flags: 1, beams: [], measureIndex: 0 },
    { beat: 0.5, duration: 0.25, flags: 2, beams: [], measureIndex: 0 },
    { beat: 0.75, duration: 0.25, flags: 2, beams: [], measureIndex: 0 },
  ], {
    timeSignature: "4/4",
    beatsPerBar: 4,
    measures: [{ index: 0, beat: 0, duration: 4, timeSignature: "4/4" }],
  });

  assert.deepEqual(planned.map(({ beams }) => beams), [
    [{ number: 1, value: "begin" }],
    [{ number: 1, value: "continue" }, { number: 2, value: "begin" }],
    [{ number: 1, value: "end" }, { number: 2, value: "end" }],
  ]);
});

test("inclinação do beam é limitada e todas as hastes alcançam a barra", () => {
  const nodes = [
    { stemX: 10, tipY: 50, stemUp: true },
    { stemX: 50, tipY: 20, stemUp: true },
    { stemX: 90, tipY: 80, stemUp: true },
  ];
  const geometry = beamLineGeometry(nodes);
  const slope = (geometry.at(-1).beamY - geometry[0].beamY)
    / (geometry.at(-1).stemX - geometry[0].stemX);

  assert.ok(Math.abs(slope) <= 0.1800001);
  geometry.forEach((item, index) => assert.ok(item.beamY <= nodes[index].tipY));
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
