import * as tf from "@tensorflow/tfjs";

const MODEL_SAMPLES = 43_844;
const OUTPUT_NAMES = ["Identity_1", "Identity_2"];

export async function createBasicPitchRuntime(modelUrl) {
  await tf.ready();
  const model = await tf.loadGraphModel(String(modelUrl));

  return {
    async infer(samples) {
      if (!(samples instanceof Float32Array) || samples.length !== MODEL_SAMPLES) {
        throw new Error(`Basic Pitch requer ${MODEL_SAMPLES} amostras.`);
      }

      const input = tf.tensor3d(samples, [1, MODEL_SAMPLES, 1], "float32");
      let outputs = [];
      let result = null;
      try {
        outputs = model.execute(input, OUTPUT_NAMES);
        const tensors = Array.isArray(outputs) ? outputs : [outputs];
        if (tensors.length !== 2) {
          throw new Error("O modelo neural devolveu saídas inesperadas.");
        }
        const [frames, onsets] = await Promise.all([
          tensors[0].data(),
          tensors[1].data(),
        ]);
        result = {
          frames: new Float32Array(frames),
          onsets: new Float32Array(onsets),
          frameCount: tensors[0].shape[1],
          noteCount: tensors[0].shape[2],
        };
      } finally {
        tf.dispose([input, ...(Array.isArray(outputs) ? outputs : [outputs])]);
      }
      result.tensors = tf.memory().numTensors;
      return result;
    },

    dispose() {
      model.dispose();
    },
  };
}
