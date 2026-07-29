import { midiToFrequency, sameMidis, uniqueMidis } from "./music.js";

const DEFAULTS = {
  // O microfone abre com `autoGainControl: false`, então o nível entregue
  // depende do aparelho, do modelo do microfone e da distância até o piano.
  // Um portão absoluto calibrado para sinal forte deixava o motor surdo em
  // qualquer captação mais discreta: 100% dos quadros eram classificados como
  // silêncio e nenhum ataque era reconhecido, sem nada explicando o porquê.
  // Só a fronteira do silêncio real continua absoluta, e bem mais baixa; o
  // resto passa a ser proporcional ao próprio sinal, que é a única forma de
  // valer igual em todo aparelho.
  minRms: 0.0006,
  minAmplitudeFloor: 0.0004,
  minAmplitudeRatio: 0.08,
  // Baixar os portões absolutos sozinho faria o ronco da sala e o zumbido da
  // rede virarem nota — e eles moram justamente na região grave, onde estão as
  // notas mais difíceis de captar. O que separa nota de ruído não é o nível e
  // sim a forma: ruído é largo e deixa todas as alturas vizinhas parecidas,
  // enquanto uma corda produz um pico bem acima da vizinhança. A altura só é
  // aceita se superar a mediana da faixa examinada por esta proporção.
  tonalProminence: 3.2,
  expectedRelativeThreshold: 0.075,
  extraRelativeThreshold: 0.36,
  scanPaddingSemitones: 12,
  // Um vizinho precisa ser bem mais forte para o pico ser tratado como vazamento.
  sidebandRatio: 2,
  // Bins mínimos entre semitons para o quadro conseguir distingui-los.
  resolutionBins: 1.5,
  stableFrames: 2,
  // Nenhum quadro isolado condena um ataque. O primeiro quadro depois da
  // percussão ainda carrega silêncio dentro da janela de análise, e o espectro
  // borrado dessa transição acusa as teclas vizinhas como notas extras.
  wrongFrames: 2,
  // A nota leva um tempo para preencher a janela de análise de 170 ms. Julgar
  // erro antes disso acusava a própria subida da nota certa — três erros
  // fantasma numa escala tocada sem falha nenhuma.
  wrongGraceMs: 150,
  analysisIntervalMs: 36,
  attemptWindowMs: 460,
  // Uma corda de piano continua vibrando por segundos depois de solta a tecla.
  // Enquanto a nota anterior soa, ela aparece no espectro da nota seguinte — e
  // acusá-la como nota extra trava o cursor no meio de qualquer melodia ligada.
  resonanceWindowMs: 2600,
  missingFundamentalMaxMidi: 54,
  missingFundamentalSecondRatio: 1.5,
  missingFundamentalThirdRatio: 1.1,
  missingFundamentalThirdToSecond: 0.12,
  detuneScanMinMidi: 55,
  detuneOffsetsCents: [-40, -20, 20, 40],
  topPianoMidi: 108,
  topNoteDetuneOffsetsCents: [60, 80, 90, 100],
};

function rmsOf(samples) {
  if (!samples?.length) return 0;
  let total = 0;
  let squares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    total += sample;
    squares += sample * sample;
  }
  const mean = total / samples.length;
  return Math.sqrt(Math.max(0, squares / samples.length - mean * mean));
}

// A janela de Hann e o buffer de trabalho dependem só do tamanho do quadro, que
// na prática nunca muda. Antes o cosseno da janela era recalculado para cada
// altura pesquisada — dezenas de vezes por quadro, em torno de sete milhões de
// chamadas por segundo num acorde de duas mãos.
const WINDOW_CACHE = new Map();

function windowFor(length) {
  let cached = WINDOW_CACHE.get(length);
  if (cached) return cached;
  const shape = new Float32Array(length);
  const denominator = Math.max(1, length - 1);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    shape[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / denominator);
    sum += shape[index];
  }
  cached = { shape, sum: Math.max(1, sum), windowed: new Float32Array(length) };
  if (WINDOW_CACHE.size > 4) WINDOW_CACHE.clear();
  WINDOW_CACHE.set(length, cached);
  return cached;
}

function applyWindow(samples) {
  const cached = windowFor(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    cached.windowed[index] = samples[index] * cached.shape[index];
  }
  return cached;
}

function goertzelAmplitude(windowed, sampleRate, frequency, windowSum) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previousPrevious = 0;

  for (let index = 0; index < windowed.length; index += 1) {
    const current = windowed[index] + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = current;
  }

  const power = previousPrevious * previousPrevious
    + previous * previous
    - coefficient * previous * previousPrevious;
  return (2 * Math.sqrt(Math.max(0, power))) / windowSum;
}

function isHarmonicAlias(
  midi,
  amplitude,
  amplitudes,
  expectedSet,
  minAmplitude,
  harmonicallySupported = expectedSet,
) {
  if (expectedSet.has(midi)) return false;
  const frequency = midiToFrequency(midi);
  for (const [lowerMidi, lowerAmplitude] of amplitudes) {
    if (lowerMidi >= midi) continue;
    const ratio = frequency / midiToFrequency(lowerMidi);
    const harmonic = Math.round(ratio);
    if (harmonic < 2 || harmonic > 5) continue;
    const cents = 1200 * Math.log2(ratio / harmonic);
    if (Math.abs(cents) > 28) continue;

    // Em notas graves de piano, o segundo harmônico pode superar a
    // fundamental no microfone do celular. Quando a fundamental esperada está
    // realmente presente, não trate esse harmônico natural como uma nota extra.
    if (harmonicallySupported.has(lowerMidi)) {
      const reference = Math.max(lowerAmplitude, minAmplitude);
      if (amplitude <= Math.max(reference * 6, minAmplitude * 16)) return true;
    }

    if (lowerAmplitude > amplitude && amplitude < lowerAmplitude * 0.72) return true;
  }
  return false;
}

function inferMissingFundamental(
  windowed,
  sampleRate,
  midi,
  windowSum,
  rms,
  config,
  tonalFloor = 0,
) {
  if (midi > config.missingFundamentalMaxMidi) return null;
  const fundamental = midiToFrequency(midi);
  const second = goertzelAmplitude(windowed, sampleRate, fundamental * 2, windowSum);
  const third = goertzelAmplitude(windowed, sampleRate, fundamental * 3, windowSum);
  // Inferir a fundamental pelos harmônicos é o caminho mais frágil do motor, e
  // o mais exposto ao ronco grave da sala. Os dois harmônicos precisam se
  // destacar do fundo, e não apenas existir.
  const secondThreshold = Math.max(
    config.minAmplitude * config.missingFundamentalSecondRatio,
    rms * 0.025,
    tonalFloor,
  );
  const thirdThreshold = Math.max(
    config.minAmplitude * config.missingFundamentalThirdRatio,
    second * config.missingFundamentalThirdToSecond,
    tonalFloor * 0.6,
  );

  if (second < secondThreshold || third < thirdThreshold) return null;
  return {
    midi,
    second,
    third,
    // Os harmônicos que serviram de prova da fundamental não podem, logo em
    // seguida, ser cobrados como notas extras da mesma altura.
    harmonicMidis: [fundamental * 2, fundamental * 3]
      .map((frequency) => Math.round(69 + 12 * Math.log2(frequency / 440))),
    confidence: Math.min(1,
      (second / Math.max(secondThreshold, 0.0001)
        + third / Math.max(thirdThreshold, 0.0001)) / 6,
    ),
  };
}

/**
 * Reconhece as alturas de um ataque acústico orientado pelo evento esperado.
 *
 * O MusicXML limita a busca a uma região musical útil. Isso torna a detecção
 * polifônica mais estável que tentar transcrever qualquer som do ambiente e
 * ainda permite informar notas ausentes e notas extras.
 */
export function analyzeExpectedChord(samples, sampleRate, expectedMidis, options = {}) {
  const merged = { ...DEFAULTS, ...options };
  const expected = uniqueMidis(expectedMidis);
  const rms = rmsOf(samples);
  // A amplitude mínima acompanha o próprio quadro. Assim o mesmo piano decide
  // igual num aparelho que entrega o dobro do nível de outro, e a única medida
  // absoluta que sobra é a do silêncio de verdade.
  const config = {
    ...merged,
    minAmplitude: merged.minAmplitude ?? Math.max(
      merged.minAmplitudeFloor,
      rms * merged.minAmplitudeRatio,
    ),
  };
  const empty = {
    status: "silence",
    expected,
    detected: [],
    missing: expected,
    extra: [],
    completeness: 0,
    confidence: 0,
    rms,
  };
  if (!expected.length || !samples?.length || !sampleRate || rms < config.minRms) return empty;

  const low = Math.max(21, expected[0] - config.scanPaddingSemitones);
  const high = Math.min(108, expected.at(-1) + config.scanPaddingSemitones);
  const { windowed, sum: windowSum } = applyWindow(samples);
  const amplitudes = new Map();
  for (let midi = low; midi <= high; midi += 1) {
    amplitudes.set(
      midi,
      goertzelAmplitude(windowed, sampleRate, midiToFrequency(midi), windowSum),
    );
  }
  // Pianos acústicos usam afinação esticada e os parciais agudos são
  // inarmônicos. Conferir pequenos desvios apenas na nota esperada recupera
  // esse comportamento sem abrir a aceitação até a tecla vizinha.
  for (const midi of expected) {
    if (midi < config.detuneScanMinMidi) continue;
    const frequency = midiToFrequency(midi);
    let best = amplitudes.get(midi) || 0;
    const offsets = midi === config.topPianoMidi
      ? [...config.detuneOffsetsCents, ...config.topNoteDetuneOffsetsCents]
      : config.detuneOffsetsCents;
    for (const cents of offsets) {
      best = Math.max(
        best,
        goertzelAmplitude(
          windowed,
          sampleRate,
          frequency * 2 ** (cents / 1200),
          windowSum,
        ),
      );
    }
    amplitudes.set(midi, best);
  }

  const strongest = Math.max(0, ...amplitudes.values());
  const expectedStrongest = Math.max(0, ...expected.map((midi) => amplitudes.get(midi) || 0));
  // Mediana da faixa examinada: com ruído todas as alturas ficam parecidas e a
  // mediana sobe junto: com notas de verdade ela permanece no vale entre os
  // picos. Serve de medida do fundo sem precisar conhecer o ganho do aparelho.
  const sortedAmplitudes = [...amplitudes.values()].sort((a, b) => a - b);
  const medianAmplitude = sortedAmplitudes[Math.floor(sortedAmplitudes.length / 2)] || 0;
  const tonalFloor = medianAmplitude * config.tonalProminence;
  const expectedThreshold = Math.max(
    config.minAmplitude,
    tonalFloor,
    Math.min(
      strongest * config.expectedRelativeThreshold,
      expectedStrongest * 0.55,
    ),
  );
  const expectedSet = new Set(expected);
  const directlyPresent = expected.filter((midi) =>
    (amplitudes.get(midi) || 0) >= expectedThreshold,
  );
  // Microfones de celular e a própria caixa do piano podem atenuar a
  // fundamental grave e preservar seus harmônicos. Para nota avulsa grave,
  // a combinação do segundo e do terceiro harmônicos diferencia uma
  // fundamental ausente de uma simples nota tocada uma oitava acima.
  const inferredDetails = [];
  if (expected.length === 1 && !directlyPresent.length) {
    const inferred = inferMissingFundamental(
      windowed,
      sampleRate,
      expected[0],
      windowSum,
      rms,
      config,
      tonalFloor,
    );
    if (inferred) inferredDetails.push(inferred);
  }
  const inferred = inferredDetails.map(({ midi }) => midi);
  const presentExpected = [...directlyPresent, ...inferred].sort((a, b) => a - b);
  const harmonicallySupported = new Set(presentExpected);

  const extraThreshold = Math.max(
    config.minAmplitude * 1.6,
    expectedStrongest * config.extraRelativeThreshold,
  );
  // Limite físico do quadro: com N amostras a R Hz, dois semitons vizinhos só se
  // separam acima de certa frequência. No grave do piano a distância entre
  // semitons é menor que um bin — Dó2 e Dó♯2 caem no mesmo lugar. Apontar "nota
  // extra" nessa região seria inventar erro, então o motor se cala ali. A nota
  // esperada continua sendo conferida por presença, que não exige separá-la da
  // vizinha.
  const binHz = sampleRate / samples.length;
  const semitoneRatio = 2 ** (1 / 12) - 1;
  const canResolveNeighbours = (midi) =>
    midiToFrequency(midi) * semitoneRatio >= binHz * config.resolutionBins;

  // Alturas que o motor já contabilizou há pouco e que continuam soando. Elas
  // não podem virar "nota extra": nota extra só bloqueia o avanço, nunca o
  // provoca, então ignorá-las não cria acerto falso — apenas deixa de exigir
  // que o aluno abafe cada nota antes de tocar a próxima.
  const ringing = new Set(
    (config.ignoreMidis || []).filter(Number.isFinite).map((midi) => Math.round(midi)),
  );
  for (const midi of ringing) harmonicallySupported.add(midi);
  for (const detail of inferredDetails) {
    for (const midi of detail.harmonicMidis || []) ringing.add(midi);
  }

  const extras = [];
  for (const [midi, amplitude] of amplitudes) {
    if (expectedSet.has(midi) || amplitude < extraThreshold) continue;
    if (ringing.has(midi)) continue;
    if (!canResolveNeighbours(midi)) continue;
    if (isHarmonicAlias(
      midi,
      amplitude,
      amplitudes,
      expectedSet,
      config.minAmplitude,
      harmonicallySupported,
    )) continue;
    extras.push(midi);
  }

  // Picos vizinhos aparecem por vazamento espectral, e o vizinho mais forte
  // costuma ser a própria nota esperada — comparar apenas extras entre si fazia
  // a banda lateral de uma nota certa virar "nota extra".
  //
  // A proporção separa os dois casos com folga: medido em quadro de 4096
  // amostras, o vazamento fica perto de 2,5% do pico vizinho, enquanto um erro
  // real de semitom (tocar Fá♯ junto do Sol escrito) chega a 100%. Sem esse
  // limiar, o engano mais comum do aluno passaria despercebido.
  const compactExtras = extras.filter((midi) => {
    const amplitude = amplitudes.get(midi) || 0;
    for (const neighbour of [midi - 1, midi + 1]) {
      const neighbourAmplitude = amplitudes.get(neighbour) || 0;
      if (neighbourAmplitude > amplitude * config.sidebandRatio) return false;
    }
    return true;
  });
  const missing = expected.filter((midi) => !presentExpected.includes(midi));
  const detected = [...presentExpected, ...compactExtras].sort((a, b) => a - b);
  const completeness = expected.length
    ? presentExpected.length / expected.length
    : 0;
  const strength = expected.length
    ? expected.reduce((sum, midi) => {
      const amplitude = amplitudes.get(midi) || 0;
      return sum + Math.min(1, amplitude / Math.max(expectedThreshold * 2.5, 0.0001));
    }, 0) / expected.length
    : 0;
  const confidence = Math.max(0, Math.min(1,
    completeness * 0.7 + strength * 0.3 - compactExtras.length * 0.12,
  ));

  let status = "match";
  if (missing.length) status = presentExpected.length ? "incomplete" : "wrong";
  else if (compactExtras.length) status = "extra";

  return {
    status,
    expected,
    detected,
    missing,
    extra: compactExtras,
    inferred,
    inferredDetails,
    completeness,
    confidence,
    rms,
    amplitudes,
  };
}

/**
 * Agrupa quadros do analisador em uma tentativa iniciada por um ataque.
 * Dois quadros coerentes confirmam a nota/acorde; silêncio, notas ausentes ou
 * extras encerram como erro somente no fim da janela, evitando feedback nervoso.
 */
export class PianoRecognitionEngine {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.attempt = null;
    this.lastMatchedExpected = [];
    // Altura → instante em que ela foi aceita. Enquanto a corda ainda soa, a
    // altura não pode ser cobrada como nota extra da nota seguinte.
    this.ringing = new Map();
  }

  // Alturas ainda soando de eventos já aceitos, sem as que a nota atual espera.
  ringingMidis(expected = [], timestamp = performance.now()) {
    const expectedSet = new Set(expected);
    const ignored = [];
    for (const [midi, matchedAt] of this.ringing) {
      if (timestamp - matchedAt > this.options.resonanceWindowMs) {
        this.ringing.delete(midi);
        continue;
      }
      if (!expectedSet.has(midi)) ignored.push(midi);
    }
    return ignored;
  }

  startAttempt(
    expectedMidis,
    timestamp = performance.now(),
    { continuous = false, waitForRelease = false } = {},
  ) {
    const expected = uniqueMidis(expectedMidis);
    this.attempt = expected.length ? {
      expected,
      continuous,
      waitForRelease,
      startedAt: timestamp,
      deadline: timestamp + this.options.attemptWindowMs,
      lastAnalysisAt: -Infinity,
      stableMatches: 0,
      stableWrongFrames: 0,
      hasAttack: !continuous,
      attackAt: continuous ? Number.POSITIVE_INFINITY : timestamp,
      wrongReported: false,
      best: null,
    } : null;
    return this.attempt;
  }

  armExpected(expectedMidis, timestamp = performance.now()) {
    const expected = uniqueMidis(expectedMidis);
    return this.startAttempt(expected, timestamp, {
      continuous: true,
      waitForRelease: sameMidis(expected, this.lastMatchedExpected),
    });
  }

  isArmedFor(expectedMidis) {
    const expected = uniqueMidis(expectedMidis);
    const active = this.attempt?.expected || [];
    return sameMidis(expected, active);
  }

  // Arma o evento e registra o ataque na ordem correta. `startAttempt` zera
  // `hasAttack`, então um ataque marcado antes de armar seria descartado pela
  // tentativa nova e o motor esperaria a batida seguinte para reconhecer a nota
  // que o aluno acabou de tocar. Manter as duas etapas juntas aqui evita que
  // cada chamador precise lembrar da ordem.
  armForAttack(expectedMidis, timestamp = performance.now()) {
    if (!this.isArmedFor(expectedMidis)) this.armExpected(expectedMidis, timestamp);
    this.noteAttack(timestamp);
    return this.attempt;
  }

  // Um único golpe no teclado chega aqui várias vezes: o RMS leva dezenas de
  // milissegundos para atingir o pico e depois ondula durante todo o
  // decaimento, porque os parciais batem entre si. Enquanto a tentativa já tem
  // um ataque válido, os disparos seguintes são o mesmo golpe e não podem zerar
  // o progresso — zerando, um acorde nunca acumulava os dois quadros estáveis
  // de que precisa, e um erro isolado era contabilizado dezenas de vezes.
  noteAttack(timestamp = performance.now()) {
    if (!this.attempt || this.attempt.hasAttack) return;
    this.attempt.hasAttack = true;
    this.attempt.attackAt = timestamp;
    this.attempt.waitForRelease = false;
    this.attempt.stableMatches = 0;
    this.attempt.stableWrongFrames = 0;
    this.attempt.wrongReported = false;
  }

  reset() {
    this.attempt = null;
    this.lastMatchedExpected = [];
    this.ringing.clear();
  }

  process(samples, sampleRate, timestamp = performance.now()) {
    const attempt = this.attempt;
    if (!attempt) return null;
    if (timestamp - attempt.lastAnalysisAt < this.options.analysisIntervalMs) return null;
    attempt.lastAnalysisAt = timestamp;

    const analysis = analyzeExpectedChord(
      samples,
      sampleRate,
      attempt.expected,
      {
        ...this.options,
        ignoreMidis: this.ringingMidis(attempt.expected, timestamp),
      },
    );
    if (attempt.waitForRelease) {
      if (analysis.status !== "match") {
        attempt.waitForRelease = false;
        attempt.stableMatches = 0;
      }
      return {
        outcome: "pending",
        waitingForRelease: true,
        ...analysis,
      };
    }
    // No modo contínuo, cada evento da partitura precisa de um novo ataque.
    // Isso impede que a ressonância do acorde anterior avance automaticamente
    // quando a próxima nota também pertence à harmonia que ainda está soando.
    if (attempt.continuous && !attempt.hasAttack) {
      return {
        outcome: "pending",
        waitingForAttack: true,
        waitingForAttackMs: Math.max(0, timestamp - attempt.startedAt),
        ...analysis,
      };
    }
    const score = analysis.completeness
      + analysis.confidence * 0.25
      - analysis.extra.length * 0.15;
    const bestScore = attempt.best
      ? attempt.best.completeness + attempt.best.confidence * 0.25 - attempt.best.extra.length * 0.15
      : -Infinity;
    if (score > bestScore) attempt.best = analysis;

    attempt.stableMatches = analysis.status === "match"
      ? attempt.stableMatches + 1
      : 0;
    attempt.stableWrongFrames = (
      analysis.status === "wrong" || analysis.status === "extra"
    ) && analysis.detected.length
      ? attempt.stableWrongFrames + 1
      : 0;
    const requiredStableFrames = attempt.expected.length === 1
      ? 1
      : this.options.stableFrames;
    if (attempt.stableMatches >= requiredStableFrames) {
      this.attempt = null;
      this.lastMatchedExpected = [...attempt.expected];
      for (const midi of attempt.expected) this.ringing.set(midi, timestamp);
      return { outcome: "match", ...analysis };
    }
    if (
      attempt.continuous
      && !attempt.wrongReported
      && attempt.stableWrongFrames >= this.options.wrongFrames
      && timestamp - attempt.attackAt >= this.options.wrongGraceMs
    ) {
      // O erro entra uma única vez na estatística, mas o ataque continua valendo:
      // limpar `hasAttack` aqui deixava a tentativa esperando um ataque que já
      // tinha acontecido, e a nota certa — reconhecida em todos os quadros
      // seguintes — nunca era aceita.
      attempt.wrongReported = true;
      return { outcome: "wrong", ...analysis };
    }
    if (!attempt.continuous && timestamp >= attempt.deadline) {
      const best = attempt.best || analysis;
      this.attempt = null;
      return { outcome: "wrong", ...best };
    }
    return { outcome: "pending", ...analysis };
  }
}
