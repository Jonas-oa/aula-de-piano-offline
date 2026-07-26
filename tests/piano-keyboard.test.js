import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PIANO_START,
  PIANO_KEY_COUNT,
  pianoKeyLayout,
  pianoRangeForMidis,
} from "../src/ui/piano-keyboard.js";

test("teclado didático mantém 49 teclas e o padrão físico correto", () => {
  const layout = pianoKeyLayout();
  assert.equal(layout.length, PIANO_KEY_COUNT);
  assert.equal(layout[0].midi, DEFAULT_PIANO_START);
  assert.equal(layout.at(-1).midi, DEFAULT_PIANO_START + 48);

  const firstOctave = layout.slice(0, 12);
  assert.deepEqual(
    firstOctave.filter((key) => key.black).map((key) => key.midi % 12),
    [1, 3, 6, 8, 10],
  );
  assert.ok(firstOctave.every((key) => key.width > 0));
});

test("faixa do teclado acompanha notas fora das quatro oitavas padrão", () => {
  assert.equal(pianoRangeForMidis([60, 64, 67]), 36);
  assert.equal(pianoRangeForMidis([24, 28, 31]), 24);
  assert.equal(pianoRangeForMidis([84, 88]), 48);
});
