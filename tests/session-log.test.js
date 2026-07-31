import test from "node:test";
import assert from "node:assert/strict";

import {
  describeDevice,
  serializeSessionLog,
  SessionLog,
  sessionLogFilename,
} from "../src/core/session-log.js";

function fakeClock(start = 1_000_000) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; return now; };
  return clock;
}

test("as entradas guardam o instante relativo ao início da sessão", () => {
  const clock = fakeClock();
  const log = new SessionLog({ clock });
  log.start({ peca: "Für Elise" });

  clock.advance(1500);
  log.add("ataque", { rms: 0.031 });
  clock.advance(320);
  log.add("avanco", { indice: 1 });

  const { entradas, contexto } = log.toJSON();
  assert.equal(contexto.peca, "Für Elise");
  assert.deepEqual(entradas.map(({ at, type }) => [at, type]), [
    [1500, "ataque"],
    [1820, "avanco"],
  ]);
});

test("números longos são arredondados e vazios não entram", () => {
  const log = new SessionLog({ clock: fakeClock() });
  log.start();
  const entry = log.add("acustico", {
    rms: 0.031_415_926_535,
    prominence: 12.345_678_9,
    detected: [60.4, 64],
    status: "match",
    missing: undefined,
    extra: null,
  });

  assert.equal(entry.rms, 0.0314);
  assert.equal(entry.prominence, 12.3457);
  assert.deepEqual(entry.detected, [60.4, 64]);
  assert.equal(entry.status, "match");
  assert.equal("missing" in entry, false, "campo ausente não pode virar linha do log");
  assert.equal("extra" in entry, false);
});

test("nada é registrado antes de começar nem depois de terminar", () => {
  const log = new SessionLog({ clock: fakeClock() });
  assert.equal(log.add("ataque", {}), null, "sem sessão aberta não há o que registrar");

  log.start();
  log.add("ataque", {});
  log.finish({ notasCertas: 3 });
  assert.equal(log.add("ataque", {}), null, "a sessão terminada não recebe mais nada");
  assert.equal(log.toJSON().entradas.length, 1);
  assert.equal(log.toJSON().resumo.notasCertas, 3);
});

test("o teto descarta o começo e conta o que saiu", () => {
  // Quem para de estudar para relatar um problema acabou de vê-lo acontecer: o
  // fim da sessão é a parte que precisa sobreviver ao teto.
  const log = new SessionLog({ clock: fakeClock(), maxEntries: 3 });
  log.start();
  for (let index = 0; index < 10; index += 1) log.add("amostra", { indice: index });

  const { entradas, entradasDescartadas } = log.toJSON();
  assert.equal(entradas.length, 3);
  assert.deepEqual(entradas.map(({ indice }) => indice), [7, 8, 9]);
  assert.equal(entradasDescartadas, 7);
});

test("o registro contido deixa passar uma linha por intervalo", () => {
  const clock = fakeClock();
  const log = new SessionLog({ clock });
  log.start();

  assert.ok(log.addThrottled("espera", { prominence: 2 }, 500), "a primeira sempre passa");
  clock.advance(200);
  assert.equal(log.addThrottled("espera", { prominence: 3 }, 500), null);
  clock.advance(400);
  assert.ok(log.addThrottled("espera", { prominence: 4 }, 500), "passados 600 ms, passa de novo");
  // Um tipo diferente tem contagem própria: conter a espera não pode calar o ataque.
  assert.ok(log.addThrottled("ataque", {}, 500));

  assert.equal(log.toJSON().entradas.length, 3);
});

test("erros anteriores à sessão não se perdem", () => {
  const log = new SessionLog({ clock: fakeClock() });
  log.addError(new Error("microfone recusado"), { etapa: "abertura" });

  log.start();
  log.addError(new TypeError("falha ao ler o MusicXML"));
  const { errosAntesDaSessao, entradas } = log.toJSON();

  assert.equal(errosAntesDaSessao.length, 1);
  assert.equal(errosAntesDaSessao[0].message, "microfone recusado");
  assert.equal(errosAntesDaSessao[0].etapa, "abertura");
  assert.equal(entradas[0].type, "erro");
  assert.equal(entradas[0].name, "TypeError");
});

test("a pilha do erro entra recortada", () => {
  const log = new SessionLog({ clock: fakeClock() });
  log.start();
  const error = new Error("falhou");
  error.stack = Array.from({ length: 40 }, (unused, index) => `linha ${index}`).join("\n");
  const entry = log.addError(error);

  assert.equal(entry.stack.split("\n").length, 6, "seis linhas bastam para localizar a origem");
});

test("o arquivo sai com nome aceito como anexo e JSON legível dentro", () => {
  const log = new SessionLog({ clock: () => Date.parse("2026-07-31T13:45:07.123Z") });
  log.start({ peca: "Estudo" });
  log.finish();

  const filename = sessionLogFilename(log);
  // O GitHub recusa `.json` como anexo de issue e aceita `.log`.
  assert.match(filename, /^partitura-viva_2026-07-31_13-45-07\.log$/);

  const parsed = JSON.parse(serializeSessionLog(log));
  assert.equal(parsed.aplicativo, "Partitura Viva");
  assert.equal(parsed.formato, 1);
  assert.equal(parsed.contexto.peca, "Estudo");
});

test("o retrato do aparelho ignora o que o navegador não oferece", () => {
  const described = describeDevice({
    navigator: { userAgent: "Aparelho de teste", hardwareConcurrency: 8 },
    innerWidth: 915,
    innerHeight: 412,
    devicePixelRatio: 2.625,
  });

  assert.equal(described.userAgent, "Aparelho de teste");
  assert.equal(described.hardwareConcurrency, 8);
  assert.equal(described.viewport, "915x412");
  assert.equal(described.pixelRatio, 2.625);
  assert.equal("orientation" in described, false);
  assert.doesNotThrow(() => describeDevice({}), "um escopo vazio não pode derrubar o log");
  assert.doesNotThrow(() => describeDevice(undefined));
});

test("áudio não entra no diário nem por descuido", () => {
  // A promessa do aplicativo é que o som não sai do aparelho, e passar
  // `samples` adiante junto com o resto da análise é o descuido mais fácil de
  // cometer — o objeto do motor acústico traz as amostras ao lado das medidas.
  const log = new SessionLog({ clock: fakeClock() });
  log.start();
  const entry = log.add("acustico", {
    rms: 0.02,
    samples: new Float32Array([0.1, 0.2, 0.3]),
    buffer: new ArrayBuffer(64),
  });

  assert.deepEqual(Object.keys(entry), ["at", "type", "rms"]);
  assert.equal(serializeSessionLog(log).includes("samples"), false);
});
