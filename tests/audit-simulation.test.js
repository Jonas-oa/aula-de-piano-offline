import assert from "node:assert/strict";
import test from "node:test";

import { buildScoreEvents } from "../src/core/musicxml.js";
import { playbackRegion } from "../src/core/piano-playback-engine.js";

const attributes = (clef, extra = {}) => ({
  kind: "attributes",
  divisions: 1,
  beats: 4,
  beatType: 4,
  staves: 1,
  clefs: [{ number: 1, type: clef }],
  keyFifths: 2,
  keyMode: "major",
  ...extra,
});
const note = (pitch, duration, extra = {}) => ({
  kind: "note",
  duration,
  isChord: false,
  isGrace: false,
  isRest: false,
  pitch,
  staff: 1,
  voice: "1",
  finger: null,
  tieStop: false,
  tieStart: false,
  ...extra,
});
const rest = (duration) => note(null, duration, { isRest: true, pitch: null });
const measure = (number, items) => ({
  number: String(number),
  implicit: false,
  divisions: 1,
  beats: number === 1 ? 4 : 0,
  beatType: number === 1 ? 4 : 0,
  items,
});

test("simulação integrada preserva duas mãos, pausa, ligadura, clave e compasso", () => {
  const score = buildScoreEvents({
    title: "Simulação de auditoria",
    parts: [
      {
        measures: [
          measure(1, [
            attributes("treble"),
            note("D5", 2, { tieStart: true, finger: "3" }),
            rest(2),
          ]),
          measure(2, [
            note("D5", 2, { tieStop: true }),
            note("E5", 2, { finger: "4" }),
          ]),
        ],
      },
      {
        measures: [
          measure(1, [attributes("bass"), note("C3", 4)]),
          measure(2, [note("G2", 4)]),
        ],
      },
    ],
  });

  assert.equal(score.keyFifths, 2);
  assert.equal(score.totalBeats, 8);
  assert.deepEqual(score.measures.map((item) => item.beat), [0, 4]);
  assert.deepEqual(score.rests.map((item) => [item.beat, item.duration]), [[2, 2]]);
  assert.deepEqual(
    score.events.map((event) => event.pitches),
    [["C3", "D5"], ["G2"], ["E5"]],
  );
  assert.deepEqual(
    score.events[0].notes.map((entry) => [entry.pitch, entry.clef]),
    [["C3", "bass"], ["D5", "treble"]],
  );
  assert.equal(score.events[0].notes.find((entry) => entry.pitch === "D5").duration, 6);

  const playback = playbackRegion(score.events, 0, score.events.length - 1);
  assert.equal(playback.durationBeats, 8);
  assert.deepEqual(playback.events.map((event) => event.relativeBeat), [0, 4, 6]);
});
