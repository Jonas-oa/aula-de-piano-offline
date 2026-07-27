import test from "node:test";
import assert from "node:assert/strict";

import {
  PianoPlaybackEngine,
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

test("altera o andamento em reprodução preservando a posição musical", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    clearTimeout() {},
    cancelAnimationFrame() {},
  };
  try {
    const engine = new PianoPlaybackEngine();
    let schedules = 0;
    let cursorTicks = 0;
    engine.context = { currentTime: 2 };
    engine.schedule = () => { schedules += 1; };
    engine.tickCursor = () => { cursorTicks += 1; };
    engine.session = {
      region: {
        durationBeats: 4,
        events: [
          { relativeBeat: 0 },
          { relativeBeat: 1 },
          { relativeBeat: 2 },
          { relativeBeat: 3 },
        ],
      },
      bpm: 60,
      loop: false,
      startPositionBeats: 0,
      startedAt: 0,
      nextEventIndex: 3,
      nextCycle: 0,
      lastCursorIndex: 2,
    };

    engine.setTempo(120);

    assert.equal(engine.session.bpm, 120);
    assert.equal(engine.session.startPositionBeats, 2);
    assert.equal(engine.session.nextEventIndex, 2);
    assert.equal(engine.session.startedAt, 2.04);
    assert.equal(schedules, 1);
    assert.equal(cursorTicks, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("alterar o andamento pausado não inicia a reprodução", () => {
  const engine = new PianoPlaybackEngine();
  engine.pausedSession = { bpm: 72 };

  assert.equal(engine.setTempo(54), 54);
  assert.equal(engine.pausedSession.bpm, 54);
  assert.equal(engine.session, null);
});
