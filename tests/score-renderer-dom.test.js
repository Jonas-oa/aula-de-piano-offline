import test from "node:test";
import assert from "node:assert/strict";

import { renderScore, scoreEventX } from "../src/ui/score-renderer.js";

// Origem da malha da pauta, usada para provar que a distância deixou de ser
// proporcional pura quando há semicolcheias entre os dois ataques.
const NOTE_START_X_FOR_TEST = 180;

function dataKey(name) {
  return name
    .slice(5)
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.parentNode = null;
    this.textContent = "";
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name.startsWith("data-")) this.dataset[dataKey(name)] = normalized;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...children) {
    children.forEach((child) => {
      child.parentNode = this;
      this.children.push(child);
    });
  }

  prepend(child) {
    child.parentNode = this;
    this.children.unshift(child);
  }

  replaceChildren(...children) {
    this.children.forEach((child) => {
      child.parentNode = null;
    });
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  matches(selector) {
    const tag = selector.match(/^[a-z]+/i)?.[0] || "";
    const className = selector.match(/\.([a-z0-9_-]+)/i)?.[1] || "";
    const attribute = selector.match(/\[([a-z0-9_-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/i);
    if (tag && this.tagName !== tag) return false;
    if (className) {
      const classes = (this.getAttribute("class") || "").split(/\s+/);
      if (!classes.includes(className)) return false;
    }
    if (attribute) {
      const actual = this.getAttribute(attribute[1]);
      if (actual === null) return false;
      if (attribute[2] !== undefined && actual !== attribute[2]) return false;
    }
    return Boolean(tag || className || attribute);
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function explicitBeamScore() {
  const pitch = (name, duration, beams) => ({
    pitch: name,
    duration,
    staff: 1,
    clef: "treble",
    partIndex: 0,
    voice: "0:1",
    type: duration === 0.5 ? "eighth" : "16th",
    dotCount: 0,
    stem: "up",
    beams,
  });
  return {
    id: "beam-dom-simulation",
    title: "Simulação de beams explícitos",
    bpm: 80,
    timeSignature: "4/4",
    beatsPerBar: 4,
    keyFifths: 0,
    clef: "grand",
    rests: [],
    measures: [{ index: 0, number: "1", beat: 0, duration: 4, timeSignature: "4/4" }],
    notes: [
      { beat: 0, duration: 0.5, measureIndex: 0, pitches: [
        pitch("C5", 0.5, [{ number: 1, value: "begin" }]),
      ] },
      { beat: 0.5, duration: 0.5, measureIndex: 0, pitches: [
        pitch("D5", 0.5, [{ number: 1, value: "end" }]),
      ] },
      { beat: 1, duration: 0.25, measureIndex: 0, pitches: [
        pitch("E5", 0.25, [
          { number: 1, value: "begin" },
          { number: 2, value: "begin" },
        ]),
      ] },
      { beat: 1.25, duration: 0.25, measureIndex: 0, pitches: [
        pitch("F5", 0.25, [
          { number: 1, value: "end" },
          { number: 2, value: "end" },
        ]),
      ] },
    ],
  };
}

function automaticCompoundScore() {
  const names = ["C5", "D5", "E5", "F5", "G5", "A5"];
  return {
    id: "beam-auto-compound-simulation",
    title: "Simulação automática 6/8",
    bpm: 80,
    timeSignature: "6/8",
    beatsPerBar: 3,
    keyFifths: 0,
    clef: "grand",
    rests: [],
    measures: [{ index: 0, number: "1", beat: 0, duration: 3, timeSignature: "6/8" }],
    notes: names.map((name, index) => ({
      beat: index * 0.5,
      duration: 0.5,
      measureIndex: 0,
      pitches: [{
        pitch: name,
        duration: 0.5,
        staff: 1,
        clef: "treble",
        partIndex: 0,
        voice: "0:1",
        type: "eighth",
        dotCount: 0,
        stem: "up",
        beams: [],
      }],
    })),
  };
}

function twoVoiceScore() {
  const voicePitch = (name, voice) => ({
    pitch: name,
    duration: 0.5,
    staff: 1,
    clef: "treble",
    partIndex: 0,
    voice,
    type: "eighth",
    dotCount: 0,
    stem: "",
    beams: [],
  });
  return {
    id: "beam-two-voice-simulation",
    title: "Simulação de duas vozes",
    bpm: 80,
    timeSignature: "4/4",
    beatsPerBar: 4,
    keyFifths: 0,
    clef: "grand",
    rests: [],
    measures: [{ index: 0, number: "1", beat: 0, duration: 4, timeSignature: "4/4" }],
    notes: [
      {
        beat: 0,
        duration: 0.5,
        measureIndex: 0,
        pitches: [voicePitch("C5", "0:1"), voicePitch("E4", "0:2")],
      },
      {
        beat: 0.5,
        duration: 0.5,
        measureIndex: 0,
        pitches: [voicePitch("D5", "0:1"), voicePitch("F4", "0:2")],
      },
    ],
  };
}

test("simulação SVG desenha beams explícitos sem bandeirolas individuais", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
  };
  try {
    const container = new FakeElement("div");
    renderScore(container, explicitBeamScore(), 0, null, { immediate: true });

    assert.equal(container.querySelectorAll(".score-beam").length, 3);
    assert.equal(
      container.querySelectorAll(".score-beam")
        .filter((beam) => beam.getAttribute("data-beam-level") === "2").length,
      1,
    );
    assert.equal(container.querySelectorAll(".score-stem").length, 4);
    assert.equal(container.querySelectorAll("path").length, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("simulação SVG agrupa automaticamente 6/8 em dois pulsos de três colcheias", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
  };
  try {
    const container = new FakeElement("div");
    renderScore(container, automaticCompoundScore(), 0, null, { immediate: true });

    const beams = container.querySelectorAll(".score-beam");
    assert.equal(beams.length, 4, "dois grupos de três notas produzem quatro segmentos");
    assert.equal(container.querySelectorAll(".score-flag").length, 0);
    assert.deepEqual(
      beams.map((beam) => [
        Number(beam.getAttribute("x1")),
        Number(beam.getAttribute("x2")),
      ]),
      [
        [188, 250],
        [250, 312],
        [374, 436],
        [436, 498],
      ],
    );
  } finally {
    globalThis.document = previousDocument;
  }
});

test("simulação SVG mantém duas vozes independentes com hastes opostas", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
  };
  try {
    const container = new FakeElement("div");
    renderScore(container, twoVoiceScore(), 0, null, { immediate: true });

    const firstEvent = container.querySelectorAll(".score-event")[0];
    const stems = firstEvent.querySelectorAll(".score-stem");
    assert.equal(container.querySelectorAll(".score-beam").length, 2);
    assert.equal(stems.length, 2);
    assert.deepEqual(
      stems.map((stem) => Number(stem.getAttribute("x1"))).sort((a, b) => a - b),
      [172, 188],
      "voz 1 sobe pela direita e voz 2 desce pela esquerda",
    );
    assert.equal(container.querySelectorAll(".score-flag").length, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

// Uma semínima ligada a outra soa dois tempos, mas continua sendo semínima. A
// cabeça era preenchida pela duração que soa, e a pauta mostrava uma mínima —
// um erro de ritmo que o aluno leria como escrito.
function tiedQuarterScore() {
  const pitch = (name, duration, extra = {}) => ({
    pitch: name,
    duration,
    staff: 1,
    clef: "treble",
    partIndex: 0,
    voice: "0:1",
    type: "quarter",
    dotCount: 0,
    stem: "up",
    beams: [],
    ...extra,
  });
  return {
    id: "tied-quarter-simulation",
    title: "Simulação de ligadura de valor",
    bpm: 80,
    timeSignature: "4/4",
    beatsPerBar: 4,
    keyFifths: 0,
    clef: "grand",
    rests: [],
    measures: [{ index: 0, number: "1", beat: 0, duration: 4, timeSignature: "4/4" }],
    notes: [
      // Semínima ligada à seguinte: duração 2 que soa, figura de semínima.
      { beat: 0, duration: 2, measureIndex: 0, pitches: [pitch("C5", 2, { tieStart: true })] },
      // Semicolcheias na mão esquerda esticam a malha entre os dois ataques:
      // 0,25 tempo renderiza com MIN_EVENT_SPACING, não com 0,25 × BEAT_SPACING.
      ...[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].map((beat) => ({
        beat,
        duration: 0.25,
        measureIndex: 0,
        pitches: [pitch("C3", 0.25, { type: "16th", clef: "bass", staff: 2, voice: "0:2" })],
      })),
      { beat: 2, duration: 2, measureIndex: 0, pitches: [pitch("E5", 2, { type: "half" })] },
    ],
  };
}

test("simulação SVG preenche a cabeça pela figura escrita, não pela duração ligada", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
  };
  try {
    const song = tiedQuarterScore();
    const container = new FakeElement("div");
    renderScore(container, song, 0, null, { immediate: true });

    const events = container.querySelectorAll(".score-event");
    const headOf = (event) => event.querySelectorAll("ellipse")[0];
    assert.equal(
      headOf(events[0]).getAttribute("fill"),
      "currentColor",
      "a semínima ligada continua com a cabeça cheia",
    );
    assert.equal(
      headOf(events.at(-1)).getAttribute("fill"),
      "#fbfcfd",
      "a mínima escrita continua vazada",
    );

    // A ligadura termina onde a próxima nota é desenhada, e não a uma distância
    // fixa em BEAT_SPACING que passaria por cima dos ataques seguintes.
    const tie = container.querySelectorAll(".score-tie")[0];
    assert.ok(tie, "a ligadura de valor é desenhada");
    const end = Number(/([\d.]+)\s[\d.]+$/.exec(tie.getAttribute("d"))?.[1]);
    const tiedX = scoreEventX(song, song.notes.length - 1);
    assert.ok(
      Math.abs(end - (tiedX - 7)) < 1,
      `a curva deve alcançar a nota ligada em ${tiedX} (terminou em ${end})`,
    );
    assert.ok(
      tiedX > NOTE_START_X_FOR_TEST + 2 * 88,
      "a malha adaptativa afastou a nota ligada além da distância proporcional",
    );
  } finally {
    globalThis.document = previousDocument;
  }
});
