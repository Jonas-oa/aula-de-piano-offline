import test from "node:test";
import assert from "node:assert/strict";

import { renderScore } from "../src/ui/score-renderer.js";

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
