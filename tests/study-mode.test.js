import test from "node:test";
import assert from "node:assert/strict";
import {
  exitStudyDisplay,
  isLandscape,
  requestStudyDisplay,
} from "../src/core/study-display.js";
import { isBlackMidi, midiLabel } from "../src/ui/piano-keyboard.js";

test("modo de estudo solicita tela cheia antes de bloquear paisagem", async () => {
  const calls = [];
  const documentRef = {
    fullscreenElement: null,
    documentElement: {
      async requestFullscreen() {
        calls.push("fullscreen");
        documentRef.fullscreenElement = documentRef.documentElement;
      },
    },
  };
  const screenRef = {
    orientation: {
      async lock(value) {
        calls.push(`lock:${value}`);
      },
    },
  };

  const result = await requestStudyDisplay({ documentRef, screenRef });
  assert.deepEqual(calls, ["fullscreen", "lock:landscape"]);
  assert.deepEqual(result, { fullscreen: true, landscape: true });
});

test("saída libera orientação e tela cheia", async () => {
  const calls = [];
  const documentRef = {
    fullscreenElement: {},
    async exitFullscreen() {
      calls.push("exit");
    },
  };
  const screenRef = {
    orientation: {
      unlock() {
        calls.push("unlock");
      },
    },
  };
  await exitStudyDisplay({ documentRef, screenRef });
  assert.deepEqual(calls, ["unlock", "exit"]);
});

test("fallback reconhece a orientação pela janela", () => {
  assert.equal(isLandscape({ screenRef: {}, windowRef: { innerWidth: 900, innerHeight: 500 } }), true);
  assert.equal(isLandscape({ screenRef: {}, windowRef: { innerWidth: 500, innerHeight: 900 } }), false);
});

test("teclado identifica teclas pretas e nomes em português", () => {
  assert.equal(isBlackMidi(61), true);
  assert.equal(isBlackMidi(60), false);
  assert.equal(midiLabel(60), "Dó 4");
  assert.equal(midiLabel(66), "Fá♯ 4");
});
