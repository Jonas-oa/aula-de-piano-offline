import assert from "node:assert/strict";
import test from "node:test";

import {
  createFollowState,
  currentEvent,
  progress,
  registerChord,
} from "../src/core/follow-evaluator.js";
import { midiToFrequency } from "../src/core/music.js";
import { AdaptiveOnsetDetector } from "../src/core/onset-engine.js";
import { PianoRecognitionEngine } from "../src/core/piano-recognition-engine.js";

const SAMPLE_RATE = 48_000;
const SAMPLE_COUNT = 8192;

function rmsOf(samples) {
  let squares = 0;
  for (const sample of samples) squares += sample * sample;
  return Math.sqrt(squares / samples.length);
}

function pianoAttack(midi, {
  fundamental = 0.002,
  second = 0.05,
  third = 0.012,
} = {}) {
  const result = new Float32Array(SAMPLE_COUNT);
  const frequency = midiToFrequency(midi);
  for (let index = 0; index < result.length; index += 1) {
    const phase = (2 * Math.PI * frequency * index) / SAMPLE_RATE;
    result[index] = fundamental * Math.sin(phase)
      + second * Math.sin(phase * 2 + 0.2)
      + third * Math.sin(phase * 3 + 0.6);
  }
  return result;
}

test("fluxo acústico completo avança no Lá 2 mesmo com fundamental atenuada", () => {
  const follow = createFollowState([{ midis: [45] }, { midis: [57] }]);
  const onset = new AdaptiveOnsetDetector();
  const recognition = new PianoRecognitionEngine({ analysisIntervalMs: 0 });
  const a2 = pianoAttack(45);

  recognition.armExpected([45], 0);
  for (let index = 0; index < 20; index += 1) onset.process(0.0008, index * 12);
  const attack = onset.process(rmsOf(a2.subarray(SAMPLE_COUNT - 2048)), 300);
  assert.equal(attack.isAttack, true);

  recognition.armForAttack([45], 300);
  const analysis = recognition.process(a2, SAMPLE_RATE, 312);
  assert.equal(analysis.outcome, "match");
  assert.deepEqual(analysis.inferred, [45]);

  const progress = registerChord(follow, analysis.detected);
  assert.equal(progress.type, "advance");
  assert.equal(follow.index, 1);
  assert.deepEqual(follow.events[follow.index].midis, [57]);
});

test("dezesseis ataques continuam detectáveis sobre ressonância acumulada", () => {
  const detector = new AdaptiveOnsetDetector();
  const attacks = Array.from({ length: 16 }, (_, index) => 504 + index * 504);
  const detected = [];

  for (let timestamp = 0; timestamp <= attacks.at(-1) + 1000; timestamp += 12) {
    let level = 0.0008;
    for (const attackAt of attacks) {
      if (timestamp < attackAt) continue;
      level += 0.025 * Math.exp(-(timestamp - attackAt) / 650);
    }
    if (detector.process(level, timestamp).isAttack) detected.push(timestamp);
  }

  assert.equal(detected.length, attacks.length);
  detected.forEach((timestamp, index) => {
    assert.ok(
      Math.abs(timestamp - attacks[index]) <= 12,
      `ataque ${index + 1} desviou para ${timestamp} ms`,
    );
  });
});

// Piano acústico realista: série harmônica com inarmonicidade, ataque
// percussivo e cauda longa. As duas falhas abaixo só aparecem no encadeamento
// completo — cada peça isolada passava.
function renderSession(played, seconds, {
  peak = 0.3,
  decayMs = 1200,
  room = 0.0015,
  ambient = [],
} = {}) {
  const total = Math.round(SAMPLE_RATE * seconds);
  const buffer = new Float32Array(total);
  let seed = 11;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };

  for (const { midis, atMs } of played) {
    const start = Math.round((SAMPLE_RATE * atMs) / 1000);
    for (const midi of midis) {
      const fundamental = midiToFrequency(midi);
      for (let index = start; index < total; index += 1) {
        const t = (index - start) / SAMPLE_RATE;
        const envelope = Math.exp((-t * 1000) / decayMs) * (1 - Math.exp(-t * 1400));
        if (t > 0.02 && envelope < 1e-4) break;
        let value = 0;
        for (let partial = 1; partial <= 12; partial += 1) {
          const frequency = partial * fundamental * Math.sqrt(1 + 0.0004 * partial * partial);
          if (frequency > SAMPLE_RATE / 2) break;
          value += Math.sin(2 * Math.PI * frequency * t + partial * 0.7) / partial ** 1.1;
        }
        buffer[index] += (peak * envelope * value) / (2.2 * Math.sqrt(midis.length));
      }
    }
  }
  for (let index = 0; index < total; index += 1) buffer[index] += room * noise();
  return mixAmbient(buffer, ambient);
}

// Sons que qualquer sala tem e que não são o piano. Todos entram como ataque no
// detector — é exatamente esse o ponto: o portão que separa nota de ruído não
// pode ser o do nível, e sim o da forma do espectro.
function mixAmbient(buffer, events) {
  for (const event of events) {
    const start = Math.round((SAMPLE_RATE * event.atMs) / 1000);
    let seed = event.seed;
    const local = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    let band = 0;
    for (let index = start; index < buffer.length; index += 1) {
      const t = (index - start) / SAMPLE_RATE;
      const envelope = Math.exp((-t * 1000) / event.decayMs);
      if (envelope < 1e-4) break;
      let value = 0;
      if (event.kind === "palma") {
        band = band * 0.55 + local() * 0.45;
        value = band * 2;
      } else if (event.kind === "batida") {
        band = band * 0.985 + local() * 0.015;
        value = band * 8 + Math.sin(2 * Math.PI * 140 * t) * 0.5;
      } else if (event.kind === "cadeira") {
        band = band * 0.8 + local() * 0.2;
        value = band * 3 * (1 + 0.6 * Math.sin(2 * Math.PI * 23 * t));
      } else {
        // Fala: fundamental que desliza e uma série harmônica com formantes.
        const f0 = event.f0 * (1 + 0.06 * Math.sin(2 * Math.PI * 4.5 * t));
        for (let partial = 1; partial <= 22; partial += 1) {
          const frequency = f0 * partial;
          if (frequency > SAMPLE_RATE / 2) break;
          const formant = Math.exp(-((frequency - 700) ** 2) / (2 * 420 ** 2))
            + 0.8 * Math.exp(-((frequency - 1220) ** 2) / (2 * 380 ** 2))
            + 0.5 * Math.exp(-((frequency - 2600) ** 2) / (2 * 700 ** 2));
          value += (Math.sin(2 * Math.PI * frequency * t + partial) * formant)
            / partial ** 0.4;
        }
        value *= 0.5;
      }
      buffer[index] += event.peak * envelope * value;
    }
  }
  return buffer;
}

function ambientEvents(loudness = 1) {
  const kinds = [
    { kind: "palma", peak: 0.22, decayMs: 90 },
    { kind: "batida", peak: 0.3, decayMs: 220 },
    { kind: "voz", peak: 0.05, decayMs: 700, f0: 140 },
    { kind: "cadeira", peak: 0.12, decayMs: 520 },
    { kind: "voz", peak: 0.06, decayMs: 900, f0: 196 },
    { kind: "palma", peak: 0.18, decayMs: 70 },
  ];
  return Array.from({ length: 14 }, (unused, index) => ({
    ...kinds[index % kinds.length],
    peak: kinds[index % kinds.length].peak * loudness,
    atMs: 900 + index * 950,
    seed: 13 + index * 7,
  }));
}

// Réplica do laço de `app.js`: a cada 12 ms analisa o quadro e, quando o
// detector acusa ataque, arma o evento esperado.
function studySession(score, played, seconds, options) {
  const buffer = renderSession(played, seconds, options);
  const follow = createFollowState(score.map((midis) => ({ midis })));
  const detector = new AdaptiveOnsetDetector();
  const recognition = new PianoRecognitionEngine();
  const frame = new Float32Array(SAMPLE_COUNT);

  const arm = (timestamp) => {
    const expected = currentEvent(follow)?.midis || [];
    if (expected.length) recognition.armExpected(expected, timestamp);
  };
  arm(0);

  for (let ms = 0; (ms * SAMPLE_RATE) / 1000 < buffer.length; ms += 12) {
    const end = Math.round((ms * SAMPLE_RATE) / 1000);
    const from = Math.max(0, end - SAMPLE_COUNT);
    frame.fill(0);
    frame.set(buffer.subarray(from, end), SAMPLE_COUNT - (end - from));

    const tailFrom = Math.max(0, end - 2048);
    let squares = 0;
    for (let index = tailFrom; index < end; index += 1) {
      squares += buffer[index] * buffer[index];
    }
    const level = Math.sqrt(squares / Math.max(1, end - tailFrom));
    const onset = detector.process(level, ms);

    // `app.js` analisa o quadro antes de registrar o ataque, todo tique.
    const analysis = recognition.process(frame, SAMPLE_RATE, ms);
    if (analysis && (analysis.outcome === "match" || analysis.outcome === "wrong")) {
      const result = registerChord(follow, analysis.detected);
      if (result.type === "advance" || result.type === "complete") arm(ms);
    }
    if (onset.isAttack) {
      const expected = currentEvent(follow)?.midis || [];
      if (expected.length) recognition.armForAttack(expected, ms);
    }
  }
  return progress(follow);
}

const SCALE = [[60], [62], [64], [65], [67], [69], [71], [72]];
const atEvery = (gapMs) => (midis, index) => ({ midis, atMs: 500 + index * gapMs });

test("melodia ligada avança até o fim com a nota anterior ainda soando", () => {
  // Duas falhas se somavam aqui. O quadro da transição borra o espectro e
  // acusava teclas vizinhas; isso reportava um erro que descartava o ataque, e
  // a tentativa passava a esperar para sempre um ataque que já tinha
  // acontecido. Vencida essa, a corda anterior — que num piano soa por
  // segundos — era cobrada como nota extra da nota seguinte.
  const result = studySession(SCALE, SCALE.map(atEvery(800)), 8);
  assert.equal(result.done, result.total, "o cursor precisa chegar ao fim da escala");
});

test("acordes de duas mãos avançam sobre a ressonância do acorde anterior", () => {
  const chords = [[48, 60, 64, 67], [50, 62, 65, 69], [52, 64, 67, 71], [53, 65, 69, 72]];
  const result = studySession(chords, chords.map(atEvery(700)), 6);
  assert.equal(result.done, result.total);
});

test("a tolerância à ressonância não aceita nota errada nem acorde incompleto", () => {
  // A permissividade vale só para alturas que o motor já aceitou. Um erro de
  // dedo continua bloqueando — nota extra nunca faz o cursor avançar, apenas
  // impede o avanço, então afrouxá-la não pode criar acerto falso.
  const semitone = studySession(SCALE, [[61], [62], [64], [65]].map(atEvery(800)), 6);
  assert.equal(semitone.done, 0, "um semitom acima não pode avançar");

  const octave = studySession(SCALE, [[72], [74], [76], [77]].map(atEvery(800)), 6);
  assert.equal(octave.done, 0, "a mesma melodia uma oitava acima não pode avançar");

  const chord = [[48, 52, 55, 60]];
  const partial = studySession(chord, [{ midis: [48, 52], atMs: 500 }], 3);
  assert.equal(partial.done, 0, "meio acorde não pode avançar");
  const whole = studySession(chord, [{ midis: [48, 52, 55, 60], atMs: 500 }], 3);
  assert.equal(whole.done, 1, "o acorde completo precisa avançar");

  const fatFinger = studySession([[60], [62]], [
    { midis: [60, 59], atMs: 500 },
    { midis: [62], atMs: 1300 },
  ], 4);
  assert.equal(fatFinger.done, 0, "uma tecla vizinha tocada junto continua sendo erro");
});

// Captação discreta: o mesmo piano, o mesmo aluno, um aparelho que entrega
// menos nível. É o caso que deixava a tela de estudo inteiramente parada.
function quietSession(peak) {
  const played = SCALE.map((midis, index) => ({ midis, atMs: 500 + index * 700 }));
  return studySession(SCALE, played, 7, { peak, room: peak * 0.02 });
}

test("captação discreta continua reconhecendo as notas", () => {
  // Com portões de amplitude absolutos, um sinal seis vezes mais fraco que o
  // "normal" era classificado como silêncio em praticamente todos os quadros:
  // nenhum ataque, nenhuma nota, nenhuma explicação na tela.
  const quiet = quietSession(0.006);
  assert.equal(quiet.done, quiet.total, "sinal fraco precisa avançar igual ao forte");

  const loud = quietSession(0.3);
  assert.equal(loud.done, loud.total, "sinal forte não pode ter regredido");
});

test("sala sem piano nenhum não faz o cursor andar", () => {
  // Baixar os portões sozinho faria o ronco da sala e o zumbido da rede virarem
  // nota — e eles moram na região grave, onde ficam as notas mais difíceis de
  // captar. O que separa nota de ruído é a forma do espectro, não o nível.
  const total = SAMPLE_RATE * 8;
  const room = new Float32Array(total);
  let seed = 99;
  let lowpass = 0;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let index = 0; index < total; index += 1) {
    lowpass = lowpass * 0.93 + noise() * 0.07;
    room[index] = 0.006 * (lowpass * 6 + noise() * 0.3)
      + 0.0024 * Math.sin((2 * Math.PI * 60 * index) / SAMPLE_RATE);
  }

  const follow = createFollowState(SCALE.map((midis) => ({ midis })));
  const detector = new AdaptiveOnsetDetector();
  const recognition = new PianoRecognitionEngine();
  const frame = new Float32Array(SAMPLE_COUNT);
  const arm = (timestamp) => {
    const expected = currentEvent(follow)?.midis || [];
    if (expected.length) recognition.armExpected(expected, timestamp);
  };
  arm(0);

  for (let ms = 0; (ms * SAMPLE_RATE) / 1000 < room.length; ms += 12) {
    const end = Math.round((ms * SAMPLE_RATE) / 1000);
    const from = Math.max(0, end - SAMPLE_COUNT);
    frame.fill(0);
    frame.set(room.subarray(from, end), SAMPLE_COUNT - (end - from));
    let squares = 0;
    const tailFrom = Math.max(0, end - 2048);
    for (let index = tailFrom; index < end; index += 1) {
      squares += room[index] * room[index];
    }
    const onset = detector.process(Math.sqrt(squares / Math.max(1, end - tailFrom)), ms);
    const analysis = recognition.process(frame, SAMPLE_RATE, ms);
    if (analysis?.outcome === "match") {
      const result = registerChord(follow, analysis.detected);
      if (result.type === "advance" || result.type === "complete") arm(ms);
    }
    if (onset.isAttack) {
      const expected = currentEvent(follow)?.midis || [];
      if (expected.length) recognition.armForAttack(expected, ms);
    }
  }

  assert.equal(progress(follow).done, 0, "ruído de sala não pode ser aceito como nota");
});

test("palma, batida e conversa não fazem o cursor andar", () => {
  // O ronco estacionário do teste acima nunca foi o problema real: ele não
  // dispara ataque. O que movia o cursor sozinho era o transiente — uma palma,
  // uma batida na mesa, alguém falando. Cada um deles é um ataque legítimo para
  // o detector, e o espectro largo que vem junto punha um pico no lugar da nota
  // esperada por puro acaso. Com o portão antigo, a altura esperada precisava
  // superar a mediana da faixa por 3,2 vezes; nesta sala ela chegava a 4,4 —
  // e o cursor andava dois eventos sem ninguém tocar no piano.
  const silent = studySession(SCALE, [], 9, {
    room: 0.004,
    ambient: ambientEvents(),
  });
  assert.equal(silent.done, 0, "sala barulhenta sem piano não pode avançar nada");
});

test("o aluno continua sendo reconhecido na mesma sala barulhenta", () => {
  // A contrapartida do teste acima: apertar o portão não pode custar o
  // reconhecimento de quem está tocando de verdade. Uma corda supera a mediana
  // da faixa por dezenas a milhares de vezes, mesmo captada de longe, então há
  // folga larga entre o ruído recusado e a nota aceita.
  const played = SCALE.map((midis, index) => ({ midis, atMs: 700 + index * 800 }));
  const noisy = studySession(SCALE, played, 9, {
    peak: 0.05,
    room: 0.004,
    ambient: ambientEvents(0.4),
  });
  assert.equal(noisy.done, noisy.total, "o piano precisa vencer o barulho da sala");
});
