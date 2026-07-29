import assert from "node:assert/strict";
import test from "node:test";

test("AudioWorklet entrega cada amostra uma vez e só quando habilitado", async () => {
  const posted = [];
  let ProcessorClass = null;
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage(message, transfers) {
          posted.push({ message, transfers });
        },
      };
    }
  };
  globalThis.registerProcessor = (name, implementation) => {
    assert.equal(name, "pcm-capture-processor");
    ProcessorClass = implementation;
  };

  try {
    await import("../src/audio/pcm-capture-processor.js?unit-test");
    const processor = new ProcessorClass();
    const makeBlock = (start) => Float32Array.from(
      { length: 128 },
      (_, index) => start + index,
    );

    processor.process([[makeBlock(0)]]);
    assert.equal(posted.length, 0);
    processor.port.onmessage({ data: { type: "enabled", enabled: true } });
    for (let block = 0; block < 16; block += 1) {
      processor.process([[makeBlock(block * 128)]]);
    }

    assert.equal(posted.length, 1);
    assert.equal(posted[0].message.frame, 2048);
    assert.deepEqual(
      [...posted[0].message.samples],
      Array.from({ length: 2048 }, (_, index) => index),
    );
    assert.equal(posted[0].transfers[0], posted[0].message.samples.buffer);
  } finally {
    globalThis.AudioWorkletProcessor = previousProcessor;
    globalThis.registerProcessor = previousRegister;
  }
});
