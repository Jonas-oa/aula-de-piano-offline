// Diário de uma sessão de estudo.
//
// Existe para responder, depois do fato, a pergunta que nenhuma tela responde:
// por que o cursor andou aqui e por que não andou ali. Sem isso, um problema de
// reconhecimento só pode ser investigado reproduzindo a sala inteira em teste —
// foi assim que o avanço por ruído precisou ser caçado, e o log encurta esse
// caminho para "abra o arquivo da sessão".
//
// Guarda números e rótulos: nível do sinal, limiares, alturas esperadas e
// ouvidas, decisão de cada motor. **Nunca guarda áudio.** O aplicativo promete
// que nada do que o microfone capta sai do aparelho, e o log não abre exceção:
// o que ele registra são as medidas já extraídas do som, não o som.

const MAX_ENTRIES = 4000;
const DEFAULT_THROTTLE_MS = 500;

// Dígitos significativos, e não casas decimais. O piso de ruído e o limiar de
// ataque vivem na casa de 1e-4: arredondados a quatro casas, 0,00091 e 0,00218
// viram 0,0009 e 0,0022 e a comparação entre eles — que é o motivo de estarem
// no arquivo — perde a resolução. Quatro dígitos servem igualmente a um nível
// de 0,04 e a uma proeminência de 187.
function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return 0;
  return Number(value.toPrecision(digits));
}

// Números viram medidas arredondadas, listas de alturas continuam listas, e o
// resto é copiado como veio. Percorre só um nível: as entradas são planas de
// propósito, para o arquivo continuar legível por quem abrir no celular.
function compact(data = {}) {
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    // A promessa do aplicativo é que o som não sai do aparelho. Um buffer de
    // amostras que chegasse aqui por descuido — passar `samples` adiante é um
    // erro fácil de cometer — seria áudio gravado em arquivo. Ele para aqui.
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
    if (typeof value === "number") {
      const rounded = round(value);
      if (rounded !== null) result[key] = rounded;
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        (typeof item === "number" ? round(item) : item));
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * O que o aparelho é e como ele está captando. A mesma peça falha num celular e
 * funciona em outro por causa destas linhas: taxa de amostragem diferente,
 * navegador diferente, aceleração por GPU ausente.
 */
export function describeDevice(scope = globalThis) {
  const navigatorRef = scope?.navigator;
  const screenRef = scope?.screen;
  return compact({
    userAgent: navigatorRef?.userAgent,
    language: navigatorRef?.language,
    platform: navigatorRef?.userAgentData?.platform,
    mobile: navigatorRef?.userAgentData?.mobile,
    hardwareConcurrency: navigatorRef?.hardwareConcurrency,
    deviceMemory: navigatorRef?.deviceMemory,
    orientation: screenRef?.orientation?.type,
    viewport: scope?.innerWidth && scope?.innerHeight
      ? `${scope.innerWidth}x${scope.innerHeight}`
      : undefined,
    pixelRatio: scope?.devicePixelRatio,
    standalone: scope?.matchMedia?.("(display-mode: standalone)")?.matches,
  });
}

export class SessionLog {
  constructor({
    clock = () => Date.now(),
    maxEntries = MAX_ENTRIES,
  } = {}) {
    this.clock = clock;
    this.maxEntries = maxEntries;
    this.reset();
  }

  reset() {
    this.startedAt = null;
    this.finishedAt = null;
    this.context = {};
    this.entries = [];
    this.dropped = 0;
    this.summary = null;
    this.lastThrottleAt = new Map();
  }

  get active() {
    return this.startedAt !== null && this.finishedAt === null;
  }

  start(context = {}) {
    this.reset();
    this.startedAt = this.clock();
    this.context = { ...context };
    return this;
  }

  add(type, data = {}) {
    if (!this.active) return null;
    const entry = { at: Math.round(this.clock() - this.startedAt), type, ...compact(data) };
    this.entries.push(entry);
    // Quando estoura o teto, o começo é descartado. Quem para de estudar para
    // relatar um problema acabou de vê-lo acontecer, então o fim da sessão é a
    // parte que precisa sobreviver.
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
      this.dropped += 1;
    }
    return entry;
  }

  // Para o que acontece dezenas de vezes por segundo. Sem isto, um minuto de
  // espera pela mesma nota encheria o arquivo com milhares de linhas iguais e
  // empurraria para fora justamente o trecho interessante.
  addThrottled(type, data = {}, everyMs = DEFAULT_THROTTLE_MS) {
    if (!this.active) return null;
    const now = this.clock();
    const previous = this.lastThrottleAt.get(type);
    if (previous !== undefined && now - previous < everyMs) return null;
    this.lastThrottleAt.set(type, now);
    return this.add(type, data);
  }

  // Um erro pode acontecer antes de a sessão começar ou depois de ela terminar —
  // importar uma peça, abrir o microfone. Registrar assim mesmo é o ponto.
  addError(error, extra = {}) {
    const data = compact({
      message: error?.message || String(error ?? "erro desconhecido"),
      name: error?.name,
      stack: typeof error?.stack === "string"
        ? error.stack.split("\n").slice(0, 6).join("\n")
        : undefined,
      ...extra,
    });
    if (!this.active) {
      this.pendingErrors = this.pendingErrors || [];
      this.pendingErrors.push(data);
      return null;
    }
    return this.add("erro", data);
  }

  finish(summary = {}) {
    if (!this.active) return this;
    this.finishedAt = this.clock();
    this.summary = compact(summary);
    return this;
  }

  toJSON() {
    return {
      aplicativo: "Partitura Viva",
      formato: 1,
      inicio: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      duracaoMs: this.startedAt && this.finishedAt
        ? Math.round(this.finishedAt - this.startedAt)
        : null,
      contexto: this.context,
      resumo: this.summary,
      entradasDescartadas: this.dropped,
      errosAntesDaSessao: this.pendingErrors || [],
      entradas: this.entries,
    };
  }
}

function stamp(isoDate) {
  return String(isoDate || new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

/**
 * A extensão é `.log` de propósito: o GitHub aceita `.log` e `.txt` como anexo
 * de issue e recusa `.json`, que era o formato óbvio para o conteúdo. O arquivo
 * carrega JSON dentro de um nome que o site aceita receber.
 */
export function sessionLogFilename(log) {
  const data = typeof log?.toJSON === "function" ? log.toJSON() : log;
  return `partitura-viva_${stamp(data?.inicio)}.log`;
}

export function serializeSessionLog(log) {
  const data = typeof log?.toJSON === "function" ? log.toJSON() : log;
  return JSON.stringify(data, null, 2);
}
