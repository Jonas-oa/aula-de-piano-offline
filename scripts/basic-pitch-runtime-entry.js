import * as tf from "@tensorflow/tfjs";

const MODEL_SAMPLES = 43_844;
const OUTPUT_NAMES = ["Identity_1", "Identity_2"];

// Sem GPU o TensorFlow.js calcula no próprio thread da interface. O motor
// acústico lê o microfone por um AnalyserNode que só guarda os ~170 ms mais
// recentes, então uma inferência de CPU bloquearia o thread e faria o
// aplicativo perder áudio de verdade — o motor que deveria ser a redundância
// ficaria surdo justamente nos aparelhos mais fracos. É melhor recusar o
// neural e deixar o acústico trabalhar sozinho.
async function requireAcceleratedBackend() {
  await tf.ready();
  if (tf.getBackend() === "webgl") return;
  try {
    await tf.setBackend("webgl");
  } catch {
    // A mensagem abaixo é a que o aluno vê; o erro cru do backend não ajuda.
  }
  if (tf.getBackend() !== "webgl") {
    throw new Error(
      "Este aparelho não oferece aceleração por GPU para o modelo neural.",
    );
  }
}

export async function createBasicPitchRuntime(modelUrl) {
  await requireAcceleratedBackend();
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
      return result;
    },

    dispose() {
      model.dispose();
    },
  };
}
