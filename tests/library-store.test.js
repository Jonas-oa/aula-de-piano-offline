import test from "node:test";
import assert from "node:assert/strict";

import { audioIdsToDiscard } from "../src/core/library-store.js";

function session(id, audio = false) {
  return { id, ...(audio ? { audioAsset: { bytes: new ArrayBuffer(1) } } : {}) };
}

test("sessões sem áudio não apagam o único diagnóstico existente", () => {
  const records = [
    session("01", true),
    session("02"),
    session("03"),
    session("04"),
    session("05"),
    session("06"),
  ];

  assert.deepEqual(audioIdsToDiscard(records, 5), []);
});

test("o limite remove somente os áudios mais antigos", () => {
  const records = [
    session("01", true),
    session("02"),
    session("03", true),
    session("04", true),
    session("05"),
    session("06", true),
  ];

  assert.deepEqual(audioIdsToDiscard(records, 3), ["01"]);
});
