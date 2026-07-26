import test from "node:test";
import assert from "node:assert/strict";

import {
  playbackRegion,
  sampleForMidi,
} from "../src/core/piano-playback-engine.js";

test("seleciona amostra exata para notas disponíveis", () => {
  assert.deepEqual(sampleForMidi(60), {
    midi: 60,
    filename: "C4v10.mp3",
    playbackRate: 1,
  });
  assert.deepEqual(sampleForMidi(66), {
    midi: 66,
    filename: "F#4v10.mp3",
    playbackRate: 1,
  });
});

test("transpõe a amostra mais próxima e limita ao alcance do piano", () => {
  const betweenSamples = sampleForMidi(61);
  assert.equal(betweenSamples.midi, 60);
  assert.ok(Math.abs(betweenSamples.playbackRate - 2 ** (1 / 12)) < 1e-12);
  assert.equal(sampleForMidi(0).midi, 21);
  assert.equal(sampleForMidi(127).midi, 108);
  assert.equal(sampleForMidi("inválido").midi, 60);
});

test("recorta região A–B preservando índices e deslocando os tempos", () => {
  const events = [
    { beat: 0, duration: 1, midis: [60] },
    { beat: 1.5, duration: 0.5, midis: [62] },
    { beat: 3, duration: 2, midis: [64, 67] },
    { beat: 5.5, duration: 1, midis: [65] },
  ];
  const region = playbackRegion(events, 1, 2);

  assert.equal(region.startIndex, 1);
  assert.equal(region.endIndex, 2);
  assert.equal(region.durationBeats, 3.5);
  assert.deepEqual(
    region.events.map(({ originalIndex, relativeBeat, duration }) => ({
      originalIndex,
      relativeBeat,
      duration,
    })),
    [
      { originalIndex: 1, relativeBeat: 0, duration: 0.5 },
      { originalIndex: 2, relativeBeat: 1.5, duration: 2 },
    ],
  );
});

test("preserva índice original ao reconstruir uma sessão pausada", () => {
  const events = [
    { beat: 0, duration: 1, midis: [60], originalIndex: 8 },
    { beat: 1, duration: 1, midis: [62], originalIndex: 9 },
  ];
  assert.deepEqual(
    playbackRegion(events).events.map((event) => event.originalIndex),
    [8, 9],
  );
});
