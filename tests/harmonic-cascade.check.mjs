// Uma tecla só não pode andar quatro notas.
//
// Reproduz, com as amostras reais do Salamander, a falha relatada numa sessão
// de verdade: o aluno tocou um Lá2 e o cursor avançou Lá3, Mi4, Dó4 e Lá4 em
// 984 ms. A abertura da Passacaglia é cruel para captação por microfone porque
// as notas seguintes são 220, 330 e 440 Hz — os harmônicos 2, 3 e 4 do próprio
// Lá2. Enquanto ele soa, as três notas seguintes da partitura estão fisicamente
// presentes no som dele, com proeminência de 10 a 30. O portão de altura não
// tem como recusá-las: a nota realmente está ali.
//
// Quem tinha de recusar era o portão de ataque, e ele aceitava 8% de subida
// sobre o quadro anterior. Uma corda de piano não morre lisa — as três cordas
// da mesma tecla batem entre si —, então cada ondulação do decaimento virava
// uma batida nova e destrancava o avanço seguinte.
//
// Fica fora do `npm test` porque decodifica as trinta amostras do Salamander,
// como as demais verificações com áudio real.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createFollowState,
  currentEvent,
  progress,
  registerChord,
} from "../src/core/follow-evaluator.js";
import { AdaptiveOnsetDetector } from "../src/core/onset-engine.js";
import { PianoRecognitionEngine } from "../src/core/piano-recognition-engine.js";
import { renderPassage, SOURCE_SAMPLE_RATE, windowEndingAt } from "./helpers/piano-audio.js";

const FRAME = 8192;
const TAIL = 2048;
// Abertura da Passacaglia, exatamente como o diário da sessão registrou.
const ABERTURA = [[45], [57], [64], [60], [69]];

function tocar(audio, partitura, { ateMs }) {
  const follow = createFollowState(partitura.map((midis) => ({ midis })));
  const detector = new AdaptiveOnsetDetector();
  const recognition = new PianoRecognitionEngine();
  const armar = (ms) => {
    const esperado = currentEvent(follow)?.midis || [];
    if (esperado.length) recognition.armExpected(esperado, ms);
  };
  armar(0);

  for (let ms = 12; ms <= ateMs; ms += 12) {
    const quadro = windowEndingAt(audio, ms, SOURCE_SAMPLE_RATE, FRAME);
    const cauda = windowEndingAt(audio, ms, SOURCE_SAMPLE_RATE, TAIL);
    let quadrados = 0;
    for (const amostra of cauda) quadrados += amostra * amostra;
    const onset = detector.process(Math.sqrt(quadrados / cauda.length), ms);

    const analise = recognition.process(quadro, SOURCE_SAMPLE_RATE, ms);
    if (analise?.outcome === "match" || analise?.outcome === "wrong") {
      const resultado = registerChord(follow, analise.detected);
      if (resultado.type === "advance" || resultado.type === "complete") {
        detector.suppressFor(110, ms);
        armar(ms);
      }
    }
    if (onset.isAttack) {
      const esperado = currentEvent(follow)?.midis || [];
      if (esperado.length) recognition.armForAttack(esperado, ms);
    }
  }
  return progress(follow).done;
}

test("uma tecla só não avança a cascata de harmônicos da Passacaglia", async () => {
  // Só o Lá2, e mais nada. As três notas seguintes da partitura estão dentro
  // do som dele; nenhuma foi tocada.
  const audio = await renderPassage([{ midis: [45], atMs: 300 }], { tailMs: 4500 });
  const andou = tocar(audio, ABERTURA, { ateMs: 4600 });

  assert.equal(andou, 1, "o Lá2 tocado vale um avanço, e só um");
});

test("melodia ligada tocada de verdade avança até o fim", async () => {
  // A contrapartida: apertar o portão de ataque não pode custar o aluno que
  // toca de verdade, ligado, com a nota anterior ainda soando. Aqui cada nota
  // sobe entre 4,63 e 29 sobre o vale recente, folga larga sobre o limiar de 2.
  const escala = [[60], [62], [64], [65], [67], [69], [71], [72]];
  const audio = await renderPassage(
    escala.map((midis, indice) => ({ midis, atMs: 400 + indice * 800 })),
    { tailMs: 2500 },
  );
  const andou = tocar(audio, escala, { ateMs: 400 + escala.length * 800 + 1200 });

  assert.equal(andou, escala.length, "a escala inteira precisa ser reconhecida");
});

test("repetir a nota perdida faz o cursor andar", async () => {
  // O custo do limite acima é uma repetição, não um bloqueio: com o Lá2 já mais
  // decaído, o mesmo Lá3 sobe 2,57 sobre o vale e passa. É a troca assumida —
  // esperar custa repetir a nota, avançar errado estraga o resto do estudo.
  const audio = await renderPassage([
    { midis: [45], atMs: 300 },
    { midis: [57], atMs: 1000 },
    { midis: [57], atMs: 1900 },
  ], { tailMs: 2500 });
  const andou = tocar(audio, [[45], [57]], { ateMs: 3200 });

  assert.equal(andou, 2, "a segunda tentativa do Lá3 precisa avançar");
});
