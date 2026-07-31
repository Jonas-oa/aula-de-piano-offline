// Mede o Basic Pitch contra piano real, e não contra saídas de modelo escritas
// à mão. Os demais testes do módulo neural verificam o portão de decisão
// alimentado por números fabricados; nenhum deles toca o modelo. Este aqui
// sintetiza trechos com as amostras do Salamander que o aplicativo instala,
// passa o sinal pela mesma reamostragem de produção e pergunta ao modelo
// vendorizado o que ele ouviu, usando o mesmo portão que move o cursor.
//
// Fica fora do `npm test` de propósito: cada inferência custa alguns segundos
// na CPU. Rode com `npm run check:neural:audio`.

import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisStartFrame,
  evaluateNeuralFollowResult,
  NEURAL_FOLLOW_THRESHOLDS,
  StreamingLinearResampler,
  summarizeBasicPitchOutputs,
} from "../src/core/neural-piano-shadow-engine.js";
import { createCpuBasicPitchRuntime, MODEL_SAMPLES } from "./helpers/basic-pitch-cpu.js";
import { renderPassage, SOURCE_SAMPLE_RATE, windowEndingAt } from "./helpers/piano-audio.js";

const MODEL_SAMPLE_RATE = 22_050;
// O motor dispara uma inferência a cada 400 ms. Duas tentativas cobrem a
// janela útil de uma nota tocada em andamento moderado sem multiplicar o custo.
const ATTEMPT_DELAYS_MS = [400, 800];
// Mesma folga que o motor acústico usa para não cobrar como nota extra a corda
// que ainda vibra.
const RESONANCE_MS = 2_600;

const runtime = await createCpuBasicPitchRuntime();

function toModelRate(samples) {
  return new StreamingLinearResampler(MODEL_SAMPLE_RATE)
    .process(samples, SOURCE_SAMPLE_RATE);
}

function ringingBefore(accepted, atMs) {
  return accepted
    .filter((entry) => atMs - entry.atMs <= RESONANCE_MS)
    .flatMap((entry) => entry.midis);
}

/**
 * Percorre o trecho como o cursor percorreria: cada nota é perguntada ao modelo
 * na cadência real, aceita na primeira inferência que passar pelo portão, e as
 * notas já aceitas deixam de disputar dominância enquanto ainda soam.
 */
async function followPassage(events) {
  const audio = toModelRate(await renderPassage(events));
  const accepted = [];
  const report = [];

  for (const event of events) {
    const ignoreMidis = ringingBefore(accepted, event.atMs);
    let outcome = null;

    for (const delay of ATTEMPT_DELAYS_MS) {
      const snapshotAt = event.atMs + delay;
      const window = windowEndingAt(audio, snapshotAt, MODEL_SAMPLE_RATE, MODEL_SAMPLES);
      const raw = await runtime.infer(window);
      const summary = summarizeBasicPitchOutputs(raw, event.midis, {
        startFrame: analysisStartFrame(event.atMs, snapshotAt),
      });
      const decision = evaluateNeuralFollowResult(summary, event.midis, { ignoreMidis });
      outcome = { delay, decision, summary };
      if (decision.accepted) break;
    }

    if (outcome.decision.accepted) accepted.push({ midis: event.midis, atMs: event.atMs });
    report.push({ event, ...outcome });
  }

  return { report, acceptedCount: accepted.length };
}

function describe({ event, delay, decision, summary }) {
  const weakest = summary.expected
    .map((note) => `${note.midi}=${note.frameProbability.toFixed(2)}/${note.onsetProbability.toFixed(2)}`)
    .join(" ");
  const intruder = summary.detected
    .filter(({ midi }) => !event.midis.includes(Math.round(midi)))
    .slice(0, 2)
    .map(({ midi, probability }) => `${midi}:${probability.toFixed(2)}`)
    .join(" ") || "—";
  return [
    `  ${event.midis.join("+").padEnd(11)}`,
    decision.accepted ? "OK " : "NAO",
    `${String(delay).padStart(4)}ms`,
    `esperada ${weakest.padEnd(26)}`,
    `intrusos ${intruder.padEnd(18)}`,
    decision.accepted ? "" : `motivo ${decision.reason}`,
  ].join(" ");
}

async function measure(label, events) {
  const { report, acceptedCount } = await followPassage(events);
  console.log(`\n[${label}] ${acceptedCount}/${events.length} reconhecidas`);
  for (const entry of report) console.log(describe(entry));
  return { report, acceptedCount };
}

function scale(rootMidi, degrees, { startMs = 500, spacingMs = 900 } = {}) {
  return degrees.map((degree, index) => ({
    midis: [rootMidi + degree],
    atMs: startMs + index * spacingMs,
  }));
}

const MAJOR_STEPS = [0, 2, 4, 5, 7];

test("escala grave — a região que o motor acústico não consegue separar", async () => {
  // Abaixo de mais ou menos Ré3 o quadro de 170 ms do motor acústico não
  // distingue semitons vizinhos, e o README trata isso como limite físico.
  // Se o modelo neural acerta aqui, ele cobre justamente o que falta.
  const { acceptedCount } = await measure("grave C2", scale(36, MAJOR_STEPS));
  assert.ok(acceptedCount >= 4, `esperava ao menos 4 de 5 no grave, obtive ${acceptedCount}`);
});

test("escala aguda — região onde o acústico já funciona", async () => {
  const { acceptedCount } = await measure("agudo C5", scale(72, MAJOR_STEPS));
  assert.ok(acceptedCount >= 4, `esperava ao menos 4 de 5 no agudo, obtive ${acceptedCount}`);
});

test("acordes de duas mãos — o modelo ouve as quatro, o portão recusa", async () => {
  // Achado registrado: em acorde cheio de quatro vozes o modelo entrega ataque
  // forte para todas, mas a probabilidade de *presença* de uma voz interna cai
  // para a faixa de 0,2 a 0,5 — abaixo do limiar de 0,55 que o portão exige de
  // toda nota esperada. Basta uma voz interna fraca para o acorde inteiro ser
  // recusado, e é por isso que o neural não avança em trecho de acorde.
  //
  // O teste fixa as duas metades do achado separadamente: que o modelo de fato
  // ouve as quatro alturas, e que o portão ainda assim recusa. Se qualquer uma
  // das duas mudar — modelo melhor ou limiar revisto —, ele quebra e obriga a
  // revisitar esta anotação.
  const chords = [
    { midis: [36, 48, 55, 64], atMs: 500 },
    { midis: [41, 53, 57, 69], atMs: 1_700 },
    { midis: [43, 55, 59, 67], atMs: 2_900 },
  ];
  const { report, acceptedCount } = await measure("acordes", chords);

  for (const { event, summary } of report) {
    for (const note of summary.expected) {
      assert.ok(
        note.onsetProbability >= NEURAL_FOLLOW_THRESHOLDS.onset,
        `o ataque de ${note.midi} em ${event.midis.join("+")} deveria ser audível `
        + `para o modelo, veio ${note.onsetProbability.toFixed(3)}`,
      );
    }
    const weak = summary.expected.filter((note) =>
      note.frameProbability < NEURAL_FOLLOW_THRESHOLDS.frame);
    assert.ok(
      weak.length > 0,
      `acorde ${event.midis.join("+")}: nenhuma voz ficou abaixo do limiar de `
      + "presença; se o modelo melhorou, o portão pode voltar a aceitar acordes",
    );
    console.log(
      `  ${event.midis.join("+")}: voz(es) abaixo do limiar de presença → `
      + weak.map((note) => `${note.midi}=${note.frameProbability.toFixed(2)}`).join(" "),
    );
  }

  assert.equal(
    acceptedCount,
    0,
    `o portão passou a aceitar ${acceptedCount} acorde(s); atualize este achado`,
  );
});

test("melodia ligada — a nota anterior ainda soa quando a próxima chega", async () => {
  const { acceptedCount } = await measure(
    "ligado",
    scale(60, MAJOR_STEPS, { spacingMs: 450 }),
  );
  assert.ok(acceptedCount >= 3, `esperava ao menos 3 de 5 no ligado, obtive ${acceptedCount}`);
});

test("oitava dobrada — o ponto cego declarado do motor acústico", async () => {
  // O README diz que, com Sol4 e Sol5 juntos, o harmônico do Sol4 ocupa a
  // região do Sol5 e a falta do agudo não é detectável pelo acústico. Este é o
  // caso em que o modelo neural teria mais a acrescentar.
  const { report, acceptedCount } = await measure("oitava", [{ midis: [67, 79], atMs: 500 }]);
  const octave = report[0].summary.expected.find((note) => note.midi === 79);
  console.log(
    `  Sol5 sobre o harmônico do Sol4: frame=${octave.frameProbability.toFixed(3)} `
    + `onset=${octave.onsetProbability.toFixed(3)}`,
  );
  assert.ok(
    octave.frameProbability >= NEURAL_FOLLOW_THRESHOLDS.frame
    && octave.onsetProbability >= NEURAL_FOLLOW_THRESHOLDS.onset,
    "o modelo deveria distinguir a oitava dobrada que o motor acústico não vê",
  );
  assert.equal(acceptedCount, 1, "a oitava dobrada deveria avançar o cursor");
});

test.after(() => runtime.dispose());
