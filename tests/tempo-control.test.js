import test from "node:test";
import assert from "node:assert/strict";

import {
  clampTempo,
  tempoFromPercent,
  tempoPercent,
} from "../src/core/tempo-control.js";

test("andamento permanece entre 30 e 240 BPM", () => {
  assert.equal(clampTempo(12), 30);
  assert.equal(clampTempo(95.6), 96);
  assert.equal(clampTempo(300), 240);
  assert.equal(clampTempo("inválido", 84), 84);
});

test("converte BPM e porcentagem usando o andamento original", () => {
  assert.equal(tempoPercent(54, 72), 75);
  assert.equal(tempoPercent(72, 72), 100);
  assert.equal(tempoFromPercent(72, 50), 36);
  assert.equal(tempoFromPercent(72, 75), 54);
  assert.equal(tempoFromPercent(72, 100), 72);
});

test("presets respeitam os limites seguros do motor", () => {
  assert.equal(tempoFromPercent(40, 50), 30);
  assert.equal(tempoFromPercent(220, 120), 240);
});
