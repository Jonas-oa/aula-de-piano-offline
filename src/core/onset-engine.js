// Quadro de análise. O reconhecimento de altura quer uma janela longa (quanto
// maior, melhor separa semitons graves); o detector de ataque quer uma janela
// curta (quanto menor, mais cedo percebe a batida). Em vez de escolher um meio
// termo ruim para os dois, usamos o quadro inteiro para a altura e só a cauda
// mais recente para o ataque.
const FRAME_SIZE = 8192;      // ~170 ms a 48 kHz
const ONSET_TAIL = 2048;      // ~43 ms mais recentes
const POLL_INTERVAL_MS = 12;  // cadência própria, independente da tela
const LEVEL_INTERVAL_MS = 50; // o medidor não precisa de mais que isso
const INITIAL_NOISE_FLOOR = 0.0008;
const PCM_WORKLET_URL = new URL("../audio/pcm-capture-processor.js", import.meta.url);

function rmsOf(samples) {
  let squares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    squares += samples[index] * samples[index];
  }
  return Math.sqrt(squares / samples.length);
}

/**
 * Separa a calibração do microfone da captura Web Audio para que a decisão de
 * ataque possa ser simulada com sinais reais. O piso acompanha o ambiente
 * quando ele está silencioso, mas não "aprende" como ruído uma nota sustentada.
 */
export class AdaptiveOnsetDetector {
  constructor({
    initialFloor = INITIAL_NOISE_FLOOR,
    // Estes dois valores existem só para não perseguir o silêncio absoluto. O
    // que separa ataque de ruído é o piso adaptativo logo abaixo, que acompanha
    // a sala e o ganho do aparelho. Fixados alto, como estavam, um microfone
    // que entrega menos nível nunca cruzava o limiar e nenhum ataque era
    // detectado — o aplicativo ficava mudo sem dizer por quê.
    minAttackRms = 0.0012,
    minAttackRise = 0.00035,
    floorMultiplier = 2.4,
    minimumIntervalMs = 82,
    // Quanto o nível precisa superar o vale mais recente para valer como
    // batida nova. Comparar com o quadro imediatamente anterior — como se fazia
    // — não distingue nada: uma corda de piano não morre lisa, porque as três
    // cordas da mesma tecla estão levemente desafinadas e batem entre si, e
    // essa ondulação sozinha chegou a 1,71 numa sessão real enquanto o sinal
    // caía quinze vezes. Cada ondulação virava um ataque, e o cursor andava
    // quatro notas com uma tecla só.
    //
    // Contra o vale recente a diferença fica evidente: numa nota que decai, o
    // menor valor dos últimos 150 ms é o próprio instante atual, então a razão
    // fica em 1. As medidas que fixam o limiar:
    //
    //   ressonância pura, amostras reais do Salamander ....... até 1,14
    //   ondulação do decaimento, sessão real num celular ..... até 1,71
    //   toque fraco em sala barulhenta, no limite ............ 2,39
    //   escala ligada tocada de verdade, Salamander .......... a partir de 4,63
    //   toques reais da mesma sessão no celular .............. a partir de 4,42
    //
    // Fica acima de tudo que é ressonância e abaixo de tudo que é dedo. A folga
    // menor é a de cima, contra o toque fraco em sala ruim: ali o aluno pode
    // precisar repetir a nota. É a troca já assumida no projeto — esperar custa
    // uma repetição, avançar errado estraga o resto do estudo.
    minRiseOverRecentLow = 2,
    recentLowWindowMs = 150,
  } = {}) {
    this.initialFloor = initialFloor;
    this.minAttackRms = minAttackRms;
    this.minAttackRise = minAttackRise;
    this.floorMultiplier = floorMultiplier;
    this.minimumIntervalMs = minimumIntervalMs;
    this.minRiseOverRecentLow = minRiseOverRecentLow;
    this.recentLowWindowMs = recentLowWindowMs;
    this.reset();
  }

  reset() {
    this.floor = this.initialFloor;
    this.previousRms = 0;
    this.lastOnsetAt = -Infinity;
    this.recentLevels = [];
  }

  // O menor nível da janela recente, antes de contar o quadro atual. A janela é
  // medida em tempo, e não em número de quadros, para a decisão não mudar com a
  // cadência de quem chama.
  #recentLow(now) {
    const recent = this.recentLevels;
    while (recent.length && now - recent[0].at > this.recentLowWindowMs) recent.shift();
    if (!recent.length) return null;
    let low = Infinity;
    for (const entry of recent) low = Math.min(low, entry.value);
    return low;
  }

  process(rms, timestamp) {
    const level = Math.max(0, Number(rms) || 0);
    const now = Number(timestamp) || 0;
    const recentLow = this.#recentLow(now);
    const quietCeiling = Math.max(this.minAttackRms * 1.25, this.floor * 1.8);

    if (level <= quietCeiling) {
      // Desce depressa quando o ambiente silencia e sobe devagar quando o
      // ruído real aumenta. Assim uma sala diferente calibra sem demora.
      const rate = level < this.floor ? 0.08 : 0.015;
      this.floor = this.floor * (1 - rate) + level * rate;
    } else {
      // Um piano pode ressoar por segundos. Antes o piso perseguia essa
      // ressonância e tornava cada ataque seguinte mais difícil de detectar.
      this.floor = this.floor * 0.9998 + quietCeiling * 0.0002;
    }

    const rise = level - this.previousRms;
    const threshold = Math.max(this.minAttackRms, this.floor * this.floorMultiplier);
    const requiredRise = Math.max(this.minAttackRise, this.floor * 0.35);
    const relativeRise = level / Math.max(this.previousRms, this.floor, 0.0001);
    // Enquanto a janela não encheu não há vale com que comparar; nesse começo
    // vale a subida contra o piso, que é o caso de quem toca a primeira nota
    // no silêncio.
    // O vale é uma medida real do próprio sinal, então não precisa do piso como
    // referência — e usá-lo penalizava justamente a sala barulhenta, onde o
    // piso é alto e o toque fraco já tem pouca folga.
    const riseOverRecentLow = recentLow === null
      ? relativeRise
      : level / Math.max(recentLow, 0.0001);
    const isAttack = (
      level > threshold
      && rise > requiredRise
      && riseOverRecentLow > this.minRiseOverRecentLow
      && now - this.lastOnsetAt > this.minimumIntervalMs
    );
    const nearAttack = !isAttack
      && level >= threshold * 0.65
      && rise > Math.max(0.0005, this.floor * 0.18)
      && now - this.lastOnsetAt > this.minimumIntervalMs;
    // Folga sobre o limiar suficiente para o reconhecimento de altura, e não
    // apenas para perceber que houve som. Abaixo disso o aluno precisa saber
    // que o problema é a captação, não a execução dele.
    const workable = level >= threshold * 2.5;

    if (isAttack) this.lastOnsetAt = now;
    this.previousRms = level;
    this.recentLevels.push({ at: now, value: level });
    return {
      isAttack,
      rms: level,
      floor: this.floor,
      threshold,
      rise,
      relativeRise,
      riseOverRecentLow,
      nearAttack,
      workable,
    };
  }
}

export class OnsetEngine {
  constructor({
    onOnset,
    onLevel,
    onSamples,
    onPcmChunk,
    onPcmStatus,
    onError,
    onStatus,
  } = {}) {
    this.onOnset = onOnset || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onSamples = onSamples || (() => {});
    this.onPcmChunk = onPcmChunk || (() => {});
    this.onPcmStatus = onPcmStatus || (() => {});
    this.onError = onError || (() => {});
    this.onStatus = onStatus || (() => {});
    this.running = false;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.onsetTail = null;
    this.timerId = null;
    this.detector = new AdaptiveOnsetDetector();
    this.lastDiagnostic = null;
    this.lastWorkableAt = -Infinity;
    this.lastLevelAt = -Infinity;
    this.startPromise = null;
    this.startGeneration = 0;
    this.pcmCaptureEnabled = false;
    this.pcmCaptureNode = null;
    this.pcmSilentGain = null;
    this.pcmSetupPromise = null;
  }

  async start() {
    if (this.running) {
      this.onStatus("active");
      return;
    }
    if (this.startPromise) return this.startPromise;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não permite usar o microfone.");
    }

    const generation = ++this.startGeneration;
    const pending = this.#open(generation);
    this.startPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.startPromise === pending) this.startPromise = null;
    }
  }

  async #open(generation) {
    let stream = null;
    let context = null;
    let source = null;
    let analyser = null;
    try {
      this.onStatus("requesting");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      if (generation !== this.startGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
      });
      await context.resume();
      if (generation !== this.startGeneration) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = FRAME_SIZE;
      analyser.smoothingTimeConstant = 0;
      this.stream = stream;
      this.context = context;
      this.source = source;
      this.analyser = analyser;
      this.buffer = new Float32Array(analyser.fftSize);
      this.onsetTail = this.buffer.subarray(this.buffer.length - ONSET_TAIL);
      this.detector.reset();
      this.lastDiagnostic = null;
      this.lastWorkableAt = -Infinity;
      source.connect(analyser);
      this.running = true;
      this.onStatus("active");
      if (this.pcmCaptureEnabled) void this.#ensurePcmCapture(generation);
      this.#tick();
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      source?.disconnect();
      analyser?.disconnect();
      if (context && context.state !== "closed") await context.close();
      if (generation !== this.startGeneration) return;
      this.running = false;
      this.stream = null;
      this.context = null;
      this.source = null;
      this.analyser = null;
      this.buffer = null;
      this.onsetTail = null;
      this.#disconnectPcmCapture();
      this.onStatus("error");
      this.onError(error);
      throw error;
    }
  }

  async stop() {
    this.startGeneration += 1;
    this.startPromise = null;
    this.running = false;
    if (this.timerId !== null) clearTimeout(this.timerId);
    this.timerId = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.#disconnectPcmCapture();
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.context && this.context.state !== "closed") await this.context.close();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.onsetTail = null;
    this.detector.reset();
    this.lastDiagnostic = null;
    this.lastWorkableAt = -Infinity;
    this.onStatus("stopped");
  }

  /**
   * Liga a cópia contínua do sinal para consumidores experimentais. O
   * analisador abaixo entrega janelas sobrepostas; por isso ele não pode ser
   * usado como um fluxo PCM sem duplicar áudio. O AudioWorklet recebe cada
   * quadro uma única vez e envia blocos transferíveis sem alterar o motor
   * responsável pela aula.
   */
  async setPcmCaptureEnabled(enabled) {
    this.pcmCaptureEnabled = Boolean(enabled);
    if (!this.pcmCaptureEnabled) {
      if (this.pcmCaptureNode) {
        this.pcmCaptureNode.port.postMessage({ type: "enabled", enabled: false });
      }
      this.onPcmStatus("disabled");
      return true;
    }

    if (!this.running || !this.context || !this.source) {
      this.onPcmStatus("waiting");
      return true;
    }
    return this.#ensurePcmCapture(this.startGeneration);
  }

  async #ensurePcmCapture(generation) {
    if (this.pcmCaptureNode) {
      this.pcmCaptureNode.port.postMessage({ type: "enabled", enabled: true });
      this.onPcmStatus("active");
      return true;
    }
    if (this.pcmSetupPromise) return this.pcmSetupPromise;

    const setup = (async () => {
      const context = this.context;
      const source = this.source;
      const AudioWorkletNodeClass = window.AudioWorkletNode || globalThis.AudioWorkletNode;
      if (!context?.audioWorklet?.addModule || !AudioWorkletNodeClass) {
        this.onPcmStatus("unsupported");
        return false;
      }

      try {
        this.onPcmStatus("loading");
        await context.audioWorklet.addModule(PCM_WORKLET_URL);
        if (
          generation !== this.startGeneration
          || !this.running
          || context !== this.context
          || source !== this.source
        ) return false;

        const node = new AudioWorkletNodeClass(context, "pcm-capture-processor");
        const silentGain = context.createGain();
        silentGain.gain.value = 0;
        node.port.onmessage = ({ data }) => {
          if (
            !this.pcmCaptureEnabled
            || data?.type !== "pcm"
            || !(data.samples instanceof Float32Array)
          ) return;
          this.onPcmChunk(data.samples, context.sampleRate, data.frame);
        };
        source.connect(node);
        node.connect(silentGain);
        silentGain.connect(context.destination);
        this.pcmCaptureNode = node;
        this.pcmSilentGain = silentGain;
        node.port.postMessage({ type: "enabled", enabled: this.pcmCaptureEnabled });
        this.onPcmStatus(this.pcmCaptureEnabled ? "active" : "disabled");
        return true;
      } catch (error) {
        // O canal neural é opcional: uma falha aqui nunca derruba o microfone
        // nem muda o motor que controla o cursor.
        this.#disconnectPcmCapture();
        this.onPcmStatus("error", error);
        return false;
      }
    })();

    this.pcmSetupPromise = setup;
    try {
      return await setup;
    } finally {
      if (this.pcmSetupPromise === setup) this.pcmSetupPromise = null;
    }
  }

  #disconnectPcmCapture() {
    if (this.pcmCaptureNode) {
      this.pcmCaptureNode.port.onmessage = null;
      this.pcmCaptureNode.disconnect();
    }
    this.pcmSilentGain?.disconnect();
    this.pcmCaptureNode = null;
    this.pcmSilentGain = null;
    this.pcmSetupPromise = null;
  }

  // Houve sinal suficiente para reconhecer altura em algum momento recente?
  // Serve para distinguir "o aluno não tocou" de "o microfone não alcança o
  // piano" — sem isso, os dois casos apareciam como a mesma tela parada.
  hasRecentWorkableLevel(withinMs = 1500) {
    return performance.now() - this.lastWorkableAt <= withinMs;
  }

  // A cadência é própria, e não a da tela. Com requestAnimationFrame a escuta
  // parava junto com o desenho — justamente quando o aparelho fica apoiado no
  // piano, com a tela escurecendo — e variava entre telas de 60 e 120 Hz.
  #tick = () => {
    if (!this.running || !this.analyser || !this.buffer) return;

    this.analyser.getFloatTimeDomainData(this.buffer);
    const now = performance.now();
    const rms = rmsOf(this.onsetTail);
    const onset = this.detector.process(rms, now);
    this.lastDiagnostic = onset;
    if (onset.workable) this.lastWorkableAt = now;

    if (now - this.lastLevelAt >= LEVEL_INTERVAL_MS) {
      this.lastLevelAt = now;
      // O medidor acompanha o limiar adaptativo. Preso a um valor absoluto, um
      // aparelho que capta mais baixo mostrava uma barra mínima mesmo quando o
      // som já era suficiente — parecia defeito e não era.
      this.onLevel(Math.min(1, rms / Math.max(onset.threshold * 4, 0.005)));
    }
    this.onSamples(this.buffer, this.context.sampleRate, now);
    if (onset.isAttack) {
      this.onOnset(now);
    }

    this.timerId = setTimeout(this.#tick, POLL_INTERVAL_MS);
  };
}

export class MidiInput {
  constructor({ onNote, onStatus } = {}) {
    this.onNote = onNote || (() => {});
    this.onStatus = onStatus || (() => {});
    this.access = null;
    this.inputs = [];
  }

  async connect() {
    if (!navigator.requestMIDIAccess) {
      throw new Error("Web MIDI não está disponível neste navegador.");
    }
    this.access = await navigator.requestMIDIAccess();
    this.#bindInputs();
    this.access.onstatechange = () => this.#bindInputs();
    return this.inputs.length;
  }

  disconnect() {
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = [];
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.onStatus("disconnected", 0);
  }

  #bindInputs() {
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = [...this.access.inputs.values()];
    for (const input of this.inputs) {
      input.onmidimessage = (event) => {
        const [status, note, velocity] = event.data;
        if ((status & 0xf0) === 0x90 && velocity > 0) {
          this.onNote({ midi: note, velocity, timestamp: performance.now() });
        }
      };
    }
    this.onStatus(this.inputs.length ? "connected" : "empty", this.inputs.length);
  }
}
