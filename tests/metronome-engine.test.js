import test from "node:test";
import assert from "node:assert/strict";
import { MetronomeEngine } from "../src/core/metronome-engine.js";

function fakeAudioContext() {
  const scheduled = [];
  const sources = [];
  const context = {
    currentTime: 10,
    destination: {},
    resumed: 0,
    async resume() { this.resumed += 1; },
    createOscillator() {
      const source = {
        frequency: { setValueAtTime(value, at) { scheduled.push({ type: "frequency", value, at }); } },
        connect() { return { connect() { return context.destination; } }; },
        start(at) { scheduled.push({ type: "start", at }); },
        stop(at) { scheduled.push({ type: "stop", at }); },
        onended: null,
      };
      sources.push(source);
      return source;
    },
    createGain() {
      return {
        gain: {
          setValueAtTime(value, at) { scheduled.push({ type: "gain", value, at }); },
          exponentialRampToValueAtTime(value, at) { scheduled.push({ type: "ramp", value, at }); },
        },
        connect() { return context.destination; },
      };
    },
  };
  return { context, scheduled, sources };
}

test("agenda pulsos pelo relógio do áudio e acentua o primeiro tempo", async () => {
  const audio = fakeAudioContext();
  const beats = [];
  let timerCallback = null;
  const engine = new MetronomeEngine({
    contextFactory: () => audio.context,
    setIntervalFn: (callback) => { timerCallback = callback; return 7; },
    clearIntervalFn: () => {},
    lookaheadSeconds: 0.12,
    onBeat: (beat) => beats.push(beat),
  });

  await engine.start({ bpm: 120, beatsPerBar: 3 });
  assert.equal(engine.isActive, true);
  assert.equal(audio.context.resumed, 1);
  assert.deepEqual(beats.map(({ beat, accent }) => [beat, accent]), [[1, true]]);
  assert.equal(audio.scheduled.find(({ type }) => type === "frequency").value, 1050);

  audio.context.currentTime = 10.55;
  timerCallback();
  assert.deepEqual(beats.map(({ beat, accent }) => [beat, accent]), [
    [1, true],
    [2, false],
  ]);
  assert.equal(audio.scheduled.filter(({ type }) => type === "frequency")[1].value, 780);
});

test("atualiza andamento, normaliza compasso e cancela fontes ao desligar", async () => {
  const audio = fakeAudioContext();
  const cleared = [];
  const engine = new MetronomeEngine({
    contextFactory: () => audio.context,
    setIntervalFn: () => 12,
    clearIntervalFn: (timer) => cleared.push(timer),
  });

  await engine.start({ bpm: 500, beatsPerBar: 0 });
  assert.equal(engine.bpm, 240);
  assert.equal(engine.beatsPerBar, 4);
  assert.equal(engine.setTempo(20), 30);
  assert.equal(engine.setBeatsPerBar(3.6), 4);
  engine.stop();

  assert.equal(engine.isActive, false);
  assert.deepEqual(cleared, [12]);
  assert.equal(engine.sources.size, 0);
  assert.ok(audio.scheduled.filter(({ type }) => type === "stop").length >= 2);
});
