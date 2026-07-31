// Sintetiza trechos de piano a partir das mesmas 30 amostras do Salamander que
// o aplicativo instala. O objetivo é alimentar o modelo neural com timbre real
// — harmônicos, ataque percussivo e cauda longa de corda — sem depender de
// gravação externa nem de rede.
//
// Limite honesto deste material: é piano real, mas não é captação de
// microfone. Não há sala, ruído de fundo, resposta de microfone nem compressão
// do aparelho. Um resultado bom aqui prova que o modelo dá conta do sinal; não
// prova que o microfone entrega esse sinal. Um resultado ruim aqui, por outro
// lado, condena o caminho inteiro, porque nenhuma captação melhora o que o
// modelo já não reconhece no melhor caso possível.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MPEGDecoder } from "mpg123-decoder";

import { sampleForMidi } from "../../src/core/piano-playback-engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE_DIR = path.join(ROOT, "assets/audio/piano/acoustic-grand");

export const SOURCE_SAMPLE_RATE = 44_100;

let decoderPromise = null;
const sampleCache = new Map();

function decoder() {
  decoderPromise ??= (async () => {
    const instance = new MPEGDecoder();
    await instance.ready;
    return instance;
  })();
  return decoderPromise;
}

async function loadSample(filename) {
  const cached = sampleCache.get(filename);
  if (cached) return cached;

  const instance = await decoder();
  const bytes = await fs.readFile(path.join(SAMPLE_DIR, filename));
  const decoded = instance.decode(new Uint8Array(bytes));
  instance.reset();

  const [left, right] = decoded.channelData;
  const mono = new Float32Array(decoded.samplesDecoded);
  for (let index = 0; index < mono.length; index += 1) {
    mono[index] = right ? (left[index] + right[index]) / 2 : left[index];
  }
  sampleCache.set(filename, mono);
  return mono;
}

/**
 * Mistura uma nota transposta dentro do buffer, com a mesma escolha de amostra
 * e a mesma razão de transposição que `PianoPlaybackEngine` usa ao tocar.
 */
function mixNote(target, source, startSample, playbackRate, gain) {
  const length = Math.floor(source.length / playbackRate);
  for (let index = 0; index < length; index += 1) {
    const position = startSample + index;
    if (position >= target.length) return;
    if (position < 0) continue;
    const read = index * playbackRate;
    const whole = Math.floor(read);
    const fraction = read - whole;
    const current = source[whole] ?? 0;
    const next = source[whole + 1] ?? current;
    target[position] += (current + (next - current) * fraction) * gain;
  }
}

/**
 * @param {Array<{ midis: number[], atMs: number }>} events
 * @returns {Promise<Float32Array>} sinal mono a 44,1 kHz
 */
export async function renderPassage(events, { tailMs = 2_600 } = {}) {
  if (!events?.length) throw new Error("O trecho precisa de pelo menos um evento.");

  const lastAtMs = events.reduce((latest, event) => Math.max(latest, event.atMs), 0);
  const total = Math.ceil(((lastAtMs + tailMs) / 1000) * SOURCE_SAMPLE_RATE);
  const mix = new Float32Array(total);

  for (const event of events) {
    const midis = event.midis ?? [];
    // Mesma compensação de acorde do motor de reprodução: sem ela, quatro notas
    // juntas saturariam o sinal e o modelo receberia distorção, não piano.
    const gain = 0.76 / Math.sqrt(Math.max(1, midis.length));
    const startSample = Math.round((event.atMs / 1000) * SOURCE_SAMPLE_RATE);
    for (const midi of midis) {
      const definition = sampleForMidi(midi);
      const source = await loadSample(definition.filename);
      mixNote(mix, source, startSample, definition.playbackRate, gain);
    }
  }

  return mix;
}

/** Recorta a janela que termina em `endMs`, preenchendo com silêncio o que falta. */
export function windowEndingAt(audio, endMs, sampleRate, length) {
  const end = Math.round((endMs / 1000) * sampleRate);
  const start = end - length;
  const window = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = start + index;
    if (position >= 0 && position < audio.length) window[index] = audio[position];
  }
  return window;
}
