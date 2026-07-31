// Carrega o mesmo modelo vendorizado que o aplicativo instala, mas no backend
// de CPU do TensorFlow.js, para que a verificação rode em Node sem GPU.
//
// O runtime do aplicativo (`scripts/basic-pitch-runtime-entry.js`) exige WebGL
// de propósito: sem aceleração a inferência bloquearia o thread que lê o
// microfone. Essa recusa protege o aluno, não o modelo — os pesos e a saída são
// idênticos. Aqui não há microfone concorrendo, então a CPU serve, e o que se
// mede continua sendo exatamente o modelo que vai para o aparelho.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as tf from "@tensorflow/tfjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL_DIR = path.join(ROOT, "vendor/basic-pitch/model");
const MODEL_SAMPLES = 43_844;
const OUTPUT_NAMES = ["Identity_1", "Identity_2"];

/** IOHandler de disco: `tf.loadGraphModel` só aceita URL buscável ou handler. */
function fileSystemHandler(modelJson, weights) {
  return {
    load: async () => ({
      modelTopology: modelJson.modelTopology,
      weightSpecs: modelJson.weightsManifest.flatMap((group) => group.weights),
      weightData: weights.buffer.slice(
        weights.byteOffset,
        weights.byteOffset + weights.byteLength,
      ),
      format: modelJson.format,
      generatedBy: modelJson.generatedBy,
      convertedBy: modelJson.convertedBy,
      signature: modelJson.signature,
      userDefinedMetadata: modelJson.userDefinedMetadata,
    }),
  };
}

export async function createCpuBasicPitchRuntime() {
  await tf.ready();
  const [modelJson, weights] = await Promise.all([
    fs.readFile(path.join(MODEL_DIR, "model.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(MODEL_DIR, "group1-shard1of1.bin")),
  ]);
  const model = await tf.loadGraphModel(fileSystemHandler(modelJson, weights));

  return {
    backend: tf.getBackend(),

    async infer(samples) {
      if (!(samples instanceof Float32Array) || samples.length !== MODEL_SAMPLES) {
        throw new Error(`Basic Pitch requer ${MODEL_SAMPLES} amostras.`);
      }
      const input = tf.tensor3d(samples, [1, MODEL_SAMPLES, 1], "float32");
      let outputs = [];
      try {
        outputs = model.execute(input, OUTPUT_NAMES);
        const [frames, onsets] = await Promise.all([
          outputs[0].data(),
          outputs[1].data(),
        ]);
        return {
          frames: new Float32Array(frames),
          onsets: new Float32Array(onsets),
          frameCount: outputs[0].shape[1],
          noteCount: outputs[0].shape[2],
        };
      } finally {
        tf.dispose([input, ...outputs]);
      }
    },

    dispose() {
      model.dispose();
    },
  };
}

export { MODEL_SAMPLES };
