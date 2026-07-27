import test from "node:test";
import assert from "node:assert/strict";

import { buildScoreEvents } from "../src/core/musicxml.js";

// Atalhos para montar a estrutura que `readMusicXmlDocument` entrega.
const note = (pitch, duration, extra = {}) => {
  const match = /^([A-G])(#|b|##|bb)?(-?\d)$/.exec(pitch);
  return {
    kind: "note",
    duration,
    isChord: false,
    isGrace: false,
    isRest: false,
    pitch,
    staff: 0,
    voice: "1",
    finger: null,
    tieStop: false,
    tieStart: false,
    ...(match ? {} : {}),
    ...extra,
  };
};
const rest = (duration) => note(null, duration, { isRest: true, pitch: null });
const measure = (items, extra = {}) => ({
  number: "",
  implicit: false,
  divisions: 0,
  beats: 0,
  beatType: 0,
  items,
  ...extra,
});
const part = (measures) => ({ measures });

test("lê todas as partes e funde os ataques simultâneos", () => {
  // Piano exportado como duas parts: mão direita e mão esquerda.
  const score = buildScoreEvents({
    parts: [
      part([measure([note("E5", 1), note("D5", 1)], { divisions: 1, beats: 2, beatType: 4 })]),
      part([measure([note("C3", 1), note("G3", 1)], { divisions: 1 })]),
    ],
  });

  assert.equal(score.partCount, 2);
  assert.equal(score.events.length, 2);
  assert.deepEqual(score.events[0].pitches, ["C3", "E5"]);
  assert.deepEqual(score.events[1].pitches, ["G3", "D5"]);
  assert.deepEqual(score.events.map((event) => event.beat), [0, 1]);
});

test("uma parte só com dois staves continua funcionando", () => {
  const score = buildScoreEvents({
    parts: [part([measure([
      note("E5", 2, { staff: 1 }),
      { kind: "backup", duration: 2 },
      note("C3", 2, { staff: 2 }),
    ], { divisions: 1 })])],
  });

  assert.equal(score.events.length, 1);
  assert.deepEqual(score.events[0].notes.map((n) => [n.pitch, n.staff]), [["C3", 2], ["E5", 1]]);
});

test("a clave explícita vence o número local do staff em partes separadas", () => {
  const attributes = (type) => ({
    kind: "attributes",
    divisions: 1,
    beats: 4,
    beatType: 4,
    staves: 1,
    clefs: [{ number: 1, type }],
  });
  const score = buildScoreEvents({
    parts: [
      part([measure([attributes("treble"), note("E5", 4, { staff: 1 })])]),
      part([measure([attributes("bass"), note("C3", 4, { staff: 1 })])]),
    ],
  });

  assert.deepEqual(
    score.events[0].notes.map((entry) => [entry.pitch, entry.staff, entry.clef]),
    [["C3", 1, "bass"], ["E5", 1, "treble"]],
  );
});

test("ligadura de valor estende a nota em vez de pedir novo ataque", () => {
  const score = buildScoreEvents({
    parts: [part([
      measure([note("C4", 4, { tieStart: true })], { divisions: 1, beats: 4, beatType: 4 }),
      measure([note("C4", 4, { tieStop: true })], { divisions: 1 }),
    ])],
  });

  assert.equal(score.events.length, 1, "a nota ligada não pode virar dois ataques");
  assert.equal(score.events[0].beat, 0);
  assert.equal(score.events[0].duration, 8);
  assert.equal(score.events[0].notes[0].tieStart, true);
});

test("corrente de ligaduras encadeadas soma todas as durações", () => {
  const tied = (extra) => note("G4", 4, extra);
  const score = buildScoreEvents({
    parts: [part([
      measure([tied({ tieStart: true })], { divisions: 1, beats: 4, beatType: 4 }),
      measure([tied({ tieStop: true, tieStart: true })]),
      measure([tied({ tieStop: true })]),
    ])],
  });

  assert.equal(score.events.length, 1);
  assert.equal(score.events[0].duration, 12);
});

test("notas de altura diferente não são amarradas por engano", () => {
  const score = buildScoreEvents({
    parts: [part([measure([
      note("C4", 2, { tieStart: true }),
      note("D4", 2, { tieStop: true }),
    ], { divisions: 1 })])],
  });

  assert.equal(score.events.length, 2);
});

test("compassos ficam alinhados quando uma parte é mais curta", () => {
  const score = buildScoreEvents({
    parts: [
      part([
        measure([note("C5", 4)], { divisions: 1, beats: 4, beatType: 4 }),
        measure([note("D5", 4)]),
      ]),
      // A mão esquerda cala o primeiro compasso sem escrever a pausa inteira.
      part([measure([rest(1)], { divisions: 1 }), measure([note("C3", 4)])]),
    ],
  });

  const second = score.events.find((event) => event.pitches.includes("C3"));
  assert.equal(second.beat, 4, "o segundo compasso começa no tempo 4 em ambas as mãos");
  assert.equal(second.measureIndex, 1);
  assert.equal(score.totalBeats, 8);
});

test("anacruse sem marcação é reconhecida quando o último compasso a complementa", () => {
  // Exportador que não escreve `implicit="yes"` nem numera o compasso como 0.
  // A anacruse de 1 tempo e o último compasso de 3 fecham uma barra de 4 — é
  // esse par que distingue anacruse de compasso com pausa final não escrita.
  const score = buildScoreEvents({
    parts: [part([
      measure([note("G4", 1)], { divisions: 1, beats: 4, beatType: 4 }),
      measure([note("C5", 4)]),
      measure([note("D5", 3)]),
    ])],
  });

  assert.equal(score.pickupBeats, 1);
  assert.deepEqual(score.measures.map((item) => item.beat), [0, 1, 5]);
  assert.deepEqual(score.events.map((event) => event.beat), [0, 1, 5]);
});

test("anacruse de uma mão não é esticada por uma parte vazia", () => {
  const score = buildScoreEvents({
    parts: [
      part([
        measure([note("G4", 1)], { divisions: 1, beats: 4, beatType: 4 }),
        measure([note("C5", 4)]),
        measure([note("D5", 3)]),
      ]),
      // Alguns exportadores mantêm os compassos da mão silenciosa, mas não
      // escrevem as pausas. Essa parte não pode transformar a anacruse em 4/4.
      part([
        measure([], { divisions: 1, beats: 4, beatType: 4 }),
        measure([note("C3", 4)]),
        measure([], { divisions: 1 }),
      ]),
    ],
  });

  assert.equal(score.pickupBeats, 1);
  assert.deepEqual(score.measures.map((item) => item.beat), [0, 1, 5]);
  assert.equal(score.events.find((event) => event.pitches.includes("C3")).beat, 1);
});

test("primeiro compasso curto sem complemento permanece inteiro", () => {
  // Sem o fecho no último compasso a leitura é ambígua, e encurtar por engano
  // desalinharia a peça toda. Na dúvida, o compasso fica como está.
  const score = buildScoreEvents({
    parts: [part([
      measure([note("G4", 1)], { divisions: 1, beats: 4, beatType: 4 }),
      measure([note("C5", 4)]),
      measure([note("D5", 4)]),
    ])],
  });

  assert.equal(score.pickupBeats, 0);
  assert.deepEqual(score.measures.map((item) => item.beat), [0, 4, 8]);
});

test("anacruse marcada com implicit continua valendo sozinha", () => {
  const score = buildScoreEvents({
    parts: [part([
      measure([note("G4", 1)], { divisions: 1, beats: 4, beatType: 4, implicit: true }),
      measure([note("C5", 4)]),
    ])],
  });

  assert.equal(score.pickupBeats, 1);
  assert.deepEqual(score.measures.map((item) => item.beat), [0, 1]);
});

test("silêncio final implícito não encurta um compasso completo", () => {
  const score = buildScoreEvents({
    parts: [part([
      measure([note("C4", 2)], { divisions: 1, beats: 4, beatType: 4 }),
      measure([note("D4", 4)]),
    ])],
  });

  assert.equal(score.events[1].beat, 4);
  assert.equal(score.totalBeats, 8);
});

test("acordes, ornamentos e pausas respeitam o cursor do compasso", () => {
  const score = buildScoreEvents({
    parts: [part([measure([
      note("C4", 1),
      note("E4", 1, { isChord: true }),
      note("G4", 1, { isChord: true }),
      note("B4", 0, { isGrace: true }),
      rest(1),
      note("A4", 2),
    ], { divisions: 1, beats: 4, beatType: 4 })])],
  });

  assert.equal(score.events.length, 2);
  assert.deepEqual(score.events[0].midis, [60, 64, 67]);
  assert.equal(score.events[0].duration, 1);
  assert.equal(score.events[1].beat, 2, "a pausa avança o cursor");
  assert.deepEqual(score.events[1].pitches, ["A4"]);
  assert.equal(score.rests.length, 1);
  assert.equal(score.rests[0].beat, 1);
  assert.equal(score.rests[0].duration, 1);
});

test("preserva armadura e linha do tempo dos compassos", () => {
  const score = buildScoreEvents({
    parts: [part([
      measure([
        {
          kind: "attributes",
          divisions: 1,
          beats: 4,
          beatType: 4,
          keyFifths: 2,
          keyMode: "major",
          clefs: [],
        },
        note("D4", 4),
      ]),
      measure([note("A4", 4)]),
    ])],
  });

  assert.equal(score.keyFifths, 2);
  assert.equal(score.keyMode, "major");
  assert.deepEqual(score.measures.map(({ beat, duration }) => [beat, duration]), [[0, 4], [4, 4]]);
});

test("divisions valem por parte e são herdadas pelos compassos seguintes", () => {
  const score = buildScoreEvents({
    parts: [
      part([
        measure([note("C4", 480)], { divisions: 480, beats: 1, beatType: 4 }),
        measure([note("D4", 480)]),
      ]),
      part([measure([note("C2", 2)], { divisions: 2 })]),
    ],
  });

  assert.deepEqual(score.events.map((event) => event.beat), [0, 1]);
  assert.equal(score.events[0].duration, 1);
  assert.deepEqual(score.events[0].pitches, ["C2", "C4"]);
});

test("fórmula de compasso é convertida para tempos de semínima", () => {
  const from = (beats, beatType) => buildScoreEvents({
    parts: [part([measure([note("C4", 1)], { divisions: 1, beats, beatType })])],
  });

  assert.equal(from(4, 4).beatsPerBar, 4);
  assert.equal(from(3, 4).beatsPerBar, 3);
  assert.equal(from(6, 8).beatsPerBar, 3);
  assert.equal(from(12, 8).beatsPerBar, 6);
  assert.equal(from(2, 2).beatsPerBar, 4);
  assert.equal(from(2, 2).timeSignature, "2/2");
});

test("anacruse é detectada pelo primeiro compasso incompleto", () => {
  const score = buildScoreEvents({
    parts: [part([
      measure([note("G4", 1)], {
        divisions: 1,
        beats: 4,
        beatType: 4,
        implicit: true,
      }),
      measure([note("C5", 4)]),
    ])],
  });

  assert.equal(score.pickupBeats, 1);
  assert.equal(score.events[1].beat, 1);
});

test("dedilhado e staff chegam ao renderizador", () => {
  const score = buildScoreEvents({
    parts: [part([measure([
      note("C4", 1, { staff: 2, finger: "1" }),
      note("E4", 1, { isChord: true, staff: 2, finger: "3" }),
    ], { divisions: 1 })])],
  });

  assert.deepEqual(
    score.events[0].notes.map((n) => ({ pitch: n.pitch, staff: n.staff, finger: n.finger })),
    [
      { pitch: "C4", staff: 2, finger: "1" },
      { pitch: "E4", staff: 2, finger: "3" },
    ],
  );
});

test("metadados de grafia chegam ao renderizador sem misturar as vozes", () => {
  const score = buildScoreEvents({
    parts: [part([measure([
      note("C5", 1, {
        staff: 1,
        voice: "1",
        type: "eighth",
        stem: "up",
        beams: [{ number: 1, value: "begin" }],
      }),
      { kind: "backup", duration: 1 },
      note("E4", 1, {
        staff: 1,
        voice: "2",
        type: "eighth",
        dotCount: 1,
        stem: "down",
        beams: [{ number: 1, value: "begin" }],
        timeModification: { actualNotes: 3, normalNotes: 2, normalType: "eighth" },
      }),
    ], { divisions: 2, beats: 4, beatType: 4 })])],
  });

  assert.equal(score.events.length, 1, "a execução continua tratando o ataque como simultâneo");
  assert.deepEqual(
    score.events[0].notes.map((entry) => ({
      pitch: entry.pitch,
      voice: entry.voice,
      type: entry.type,
      dotCount: entry.dotCount,
      stem: entry.stem,
      beams: entry.beams,
      timeModification: entry.timeModification,
    })),
    [
      {
        pitch: "E4",
        voice: "0:2",
        type: "eighth",
        dotCount: 1,
        stem: "down",
        beams: [{ number: 1, value: "begin" }],
        timeModification: { actualNotes: 3, normalNotes: 2, normalType: "eighth" },
      },
      {
        pitch: "C5",
        voice: "0:1",
        type: "eighth",
        dotCount: 0,
        stem: "up",
        beams: [{ number: 1, value: "begin" }],
        timeModification: null,
      },
    ],
  );
});

test("alturas ilegíveis são descartadas sem derrubar a peça", () => {
  const score = buildScoreEvents({
    parts: [part([measure([
      note("C4", 1),
      note("H9", 1),
      note("E4", 1),
    ], { divisions: 1 })])],
  });

  assert.deepEqual(score.events.map((event) => event.pitches), [["C4"], ["E4"]]);
});

test("partitura vazia não quebra o resto do aplicativo", () => {
  const score = buildScoreEvents({ parts: [] });

  assert.deepEqual(score.events, []);
  assert.equal(score.totalBeats, 0);
  assert.equal(score.measureCount, 0);
  assert.equal(score.pickupBeats, 0);
});
