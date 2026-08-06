import test from "node:test";
import assert from "node:assert/strict";

import { MidiInput } from "../src/core/onset-engine.js";

function fakeAccess(entradas = [{ name: "Yamaha Digital Keyboard" }]) {
  const inputs = new Map(entradas.map((entrada, indice) => [String(indice), entrada]));
  return { inputs, onstatechange: null };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function comNavegador(valor, corpo) {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: valor });
  try {
    return corpo();
  } finally {
    if (anterior) Object.defineProperty(globalThis, "navigator", anterior);
    else delete globalThis.navigator;
  }
}

test("navegador sem Web MIDI explica em vez de falhar em silêncio", async () => {
  await comNavegador({}, async () => {
    const entrada = new MidiInput();
    await assert.rejects(() => entrada.connect(), /Web MIDI/);
  });
});

test("página insegura é apontada como causa, e não o navegador", async () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
  Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: false });
  try {
    await comNavegador({}, async () => {
      await assert.rejects(() => new MidiInput().connect(), /https/);
    });
  } finally {
    if (anterior) Object.defineProperty(globalThis, "isSecureContext", anterior);
    else delete globalThis.isSecureContext;
  }
});

test("permissão negada fala de MIDI, nunca de microfone", async () => {
  // O erro do navegador é um `NotAllowedError` genérico, igual ao do microfone.
  // Repassá-lo cru fazia a tela pedir o microfone a quem tocou em MIDI.
  const negada = new Error("permission denied");
  negada.name = "NotAllowedError";
  await comNavegador({ requestMIDIAccess: async () => { throw negada; } }, async () => {
    const erro = await new MidiInput().connect().then(() => null, (motivo) => motivo);
    assert.match(erro.message, /MIDI/);
    assert.doesNotMatch(erro.message, /microfone nas configurações/);
    assert.equal(erro.cause, negada);
  });
});

test("falha inesperada do pedido MIDI chega identificada como MIDI", async () => {
  const falha = new Error("boom");
  await comNavegador({ requestMIDIAccess: async () => { throw falha; } }, async () => {
    const erro = await new MidiInput().connect().then(() => null, (motivo) => motivo);
    assert.match(erro.message, /entrada MIDI: boom/);
    assert.equal(erro.cause, falha);
  });
});

test("conectar liga as entradas e informa o nome do teclado", async () => {
  const acesso = fakeAccess([{ name: "Yamaha Digital Keyboard" }]);
  const estados = [];
  await comNavegador({ requestMIDIAccess: async () => acesso }, async () => {
    const entrada = new MidiInput({
      onStatus: (status, count, names) => estados.push({ status, count, names }),
    });
    const total = await entrada.connect();

    assert.equal(total, 1);
    assert.deepEqual(entrada.deviceNames, ["Yamaha Digital Keyboard"]);
    // O nome viaja junto com o estado: a tela principal mostra qual aparelho
    // respondeu, e não apenas que algo respondeu.
    assert.deepEqual(estados.at(-1), {
      status: "connected",
      count: 1,
      names: ["Yamaha Digital Keyboard"],
    });
  });
});

test("nenhum teclado ligado é um estado próprio, não um erro", async () => {
  const estados = [];
  await comNavegador({ requestMIDIAccess: async () => fakeAccess([]) }, async () => {
    const entrada = new MidiInput({ onStatus: (status) => estados.push(status) });
    assert.equal(await entrada.connect(), 0);
    assert.equal(estados.at(-1), "empty");
  });
});

test("tecla tocada vira nota; tecla solta, não", async () => {
  const porta = { name: "Yamaha Digital Keyboard" };
  const notas = [];
  await comNavegador({ requestMIDIAccess: async () => fakeAccess([porta]) }, async () => {
    const entrada = new MidiInput({ onNote: (nota) => notas.push(nota) });
    await entrada.connect();

    porta.onmidimessage({ data: [0x90, 60, 100] });
    // Muitos teclados encerram a nota com `note-on` de velocidade zero em vez de
    // `note-off`. Tratar isso como ataque faria cada tecla solta virar uma nota
    // nova, e o cursor andaria duas vezes por tecla.
    porta.onmidimessage({ data: [0x90, 60, 0] });
    porta.onmidimessage({ data: [0x80, 60, 64] });
    // Pedal de sustain e outros controles não são notas.
    porta.onmidimessage({ data: [0xb0, 64, 127] });
    porta.onmidimessage({ data: [0x90, 64, 88] });

    assert.deepEqual(notas.map(({ midi }) => midi), [60, 64]);
    assert.equal(notas[0].velocity, 100);
  });
});

test("acorde entrega uma nota por tecla, na ordem em que chegam", async () => {
  const porta = { name: "Yamaha" };
  const notas = [];
  await comNavegador({ requestMIDIAccess: async () => fakeAccess([porta]) }, async () => {
    const entrada = new MidiInput({ onNote: ({ midi }) => notas.push(midi) });
    await entrada.connect();
    for (const midi of [60, 64, 67]) porta.onmidimessage({ data: [0x90, midi, 90] });
  });
  assert.deepEqual(notas, [60, 64, 67]);
});

test("ligar o teclado depois de abrir o app reconecta sozinho", async () => {
  // O caso real: o aluno abre o aplicativo, escolhe MIDI e só então liga o
  // teclado. Sem religar as entradas, nenhuma nota chegaria.
  const acesso = fakeAccess([]);
  const notas = [];
  await comNavegador({ requestMIDIAccess: async () => acesso }, async () => {
    const entrada = new MidiInput({ onNote: ({ midi }) => notas.push(midi) });
    assert.equal(await entrada.connect(), 0);

    const porta = { name: "Yamaha Digital Keyboard" };
    acesso.inputs.set("0", porta);
    acesso.onstatechange();

    assert.deepEqual(entrada.deviceNames, ["Yamaha Digital Keyboard"]);
    porta.onmidimessage({ data: [0x90, 69, 100] });
    assert.deepEqual(notas, [69]);
  });
});

test("desconectar solta as portas e não deixa nota atrasada entrar", async () => {
  const porta = { name: "Yamaha" };
  const notas = [];
  await comNavegador({ requestMIDIAccess: async () => fakeAccess([porta]) }, async () => {
    const entrada = new MidiInput({ onNote: ({ midi }) => notas.push(midi) });
    await entrada.connect();
    entrada.disconnect();

    assert.equal(porta.onmidimessage, null, "a porta precisa ficar sem ouvinte");
    assert.deepEqual(entrada.deviceNames, []);
    assert.equal(entrada.access, null);
  });
  assert.deepEqual(notas, []);
});

test("desconectar durante a permissão impede uma conexão MIDI atrasada", async () => {
  const pedido = deferred();
  const porta = { name: "Yamaha" };
  const estados = [];
  await comNavegador({ requestMIDIAccess: () => pedido.promise }, async () => {
    const entrada = new MidiInput({ onStatus: (status) => estados.push(status) });
    const conectando = entrada.connect();
    entrada.disconnect();
    pedido.resolve(fakeAccess([porta]));

    assert.equal(await conectando, 0);
    assert.equal(entrada.access, null);
    assert.deepEqual(entrada.deviceNames, []);
    assert.equal(porta.onmidimessage, undefined);
    assert.deepEqual(estados, ["disconnected"]);
  });
});
