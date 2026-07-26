import test from "node:test";
import assert from "node:assert/strict";

import {
  diatonicStep,
  midiToNote,
  midiToPortuguese,
  noteToMidi,
  parsePitch,
  sameMidis,
  uniqueMidis,
} from "../src/core/music.js";

test("converte alturas simples e com alteração", () => {
  assert.equal(noteToMidi("C4"), 60);
  assert.equal(noteToMidi("F#4"), 66);
  assert.equal(noteToMidi("Bb3"), 58);
  assert.equal(noteToMidi("A0"), 21);
  assert.equal(noteToMidi("C8"), 108);
  assert.throws(() => noteToMidi("H4"), /Nota inválida/);
});

test("aceita dobrados, como exige <alter> ±2 do MusicXML", () => {
  assert.equal(noteToMidi("C##4"), 62);
  assert.equal(noteToMidi("Cx4"), 62);
  assert.equal(noteToMidi("Dbb4"), 60);
  // O grau na pauta ignora a alteração: Dó dobrado sustenido continua na linha do Dó.
  assert.equal(diatonicStep("C##4"), diatonicStep("C4"));
  assert.equal(diatonicStep("Dbb4"), diatonicStep("D4"));
});

test("parsePitch descreve letra, alteração e oitava", () => {
  assert.deepEqual(parsePitch("Eb3"), { letter: "E", accidental: "b", alter: -1, octave: 3 });
  assert.deepEqual(parsePitch("G-1"), { letter: "G", accidental: "", alter: 0, octave: -1 });
  assert.equal(parsePitch("nada"), null);
});

test("nomes de nota fecham o ciclo com o MIDI", () => {
  for (const midi of [21, 36, 60, 66, 108]) {
    assert.equal(noteToMidi(midiToNote(midi)), midi);
  }
  assert.equal(midiToPortuguese(60), "Dó 4");
  assert.equal(midiToPortuguese(66, false), "Fá♯");
});

test("uniqueMidis ordena, arredonda e descarta inválidos", () => {
  assert.deepEqual(uniqueMidis([64, 60, 60, NaN, 67.4, undefined]), [60, 64, 67]);
  assert.deepEqual(uniqueMidis(), []);
  assert.equal(sameMidis([60, 64], [60, 64]), true);
  assert.equal(sameMidis([60, 64], [60, 65]), false);
  assert.equal(sameMidis([60], [60, 64]), false);
});
