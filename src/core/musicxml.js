import { noteToMidi } from "./music.js";

// Leitura de MusicXML em duas camadas:
//
//  1. `readMusicXmlDocument` extrai o documento para uma estrutura simples
//     (só precisa do DOM do navegador);
//  2. `buildScoreEvents` faz toda a aritmética musical — junção de partes,
//     ligaduras de valor, compassos e ataques — sem depender do DOM, o que
//     deixa a parte propensa a erro coberta por testes.

const ACCIDENTAL_BY_ALTER = { "-2": "bb", "-1": "b", 0: "", 1: "#", 2: "##" };
const BEAT_EPSILON = 1e-4;

function text(element, selector, fallback = "") {
  return element?.querySelector(selector)?.textContent?.trim() || fallback;
}

function directChild(element, name) {
  return [...element.children].find((child) => child.localName === name) || null;
}

// Uma nota amarrada ao que veio antes não é um ataque novo: é a continuação da
// mesma nota. O MusicXML marca isso em <tie> (som) e em <tied> (grafia).
function hasTie(note, type) {
  return Boolean(
    note.querySelector(`tie[type="${type}"]`)
    || note.querySelector(`notations > tied[type="${type}"]`),
  );
}

function readNote(note) {
  const pitch = directChild(note, "pitch");
  const alter = Number(text(pitch, "alter", "0"));
  const step = text(pitch, "step");
  const octave = text(pitch, "octave");
  const accidental = ACCIDENTAL_BY_ALTER[String(alter)];

  return {
    kind: "note",
    duration: Number(text(note, "duration", "0")),
    isChord: Boolean(directChild(note, "chord")),
    isGrace: Boolean(directChild(note, "grace")),
    isRest: Boolean(directChild(note, "rest")),
    // Alterações fora de ±2 (microtonais) não têm grafia aqui; a nota é
    // descartada em vez de virar uma altura errada silenciosamente.
    pitch: step && octave && accidental !== undefined
      ? `${step}${accidental}${octave}`
      : null,
    staff: Number(text(note, "staff", "0")) || 0,
    voice: text(note, "voice", "1"),
    finger: text(note, "notations technical fingering", "") || null,
    tieStop: hasTie(note, "stop"),
    tieStart: hasTie(note, "start"),
  };
}

export function readMusicXmlDocument(document) {
  if (document.querySelector("parsererror")) {
    throw new Error("O arquivo MusicXML não pôde ser lido.");
  }
  const partElements = [...document.querySelectorAll("part")];
  if (!partElements.length) throw new Error("O MusicXML não contém uma parte musical.");

  return {
    title: text(document, "work-title")
      || text(document, "movement-title")
      || "Peça importada",
    composer: document.querySelector('creator[type="composer"]')?.textContent?.trim() || "",
    parts: partElements.map((part) => ({
      measures: [...part.querySelectorAll(":scope > measure")].map((measure) => ({
        number: measure.getAttribute("number") || "",
        divisions: Number(text(measure, "attributes > divisions", "0")) || 0,
        beats: Number(text(measure, "attributes > time > beats", "0")) || 0,
        beatType: Number(text(measure, "attributes > time > beat-type", "0")) || 0,
        items: [...measure.children].flatMap((child) => {
          if (child.localName === "backup" || child.localName === "forward") {
            return [{ kind: child.localName, duration: Number(text(child, "duration", "0")) }];
          }
          return child.localName === "note" ? [readNote(child)] : [];
        }),
      })),
    })),
  };
}

// Percorre uma parte medindo cada compasso em tempos de semínima e devolvendo
// as notas com o ataque relativo ao início do próprio compasso.
function walkPart(part, partIndex) {
  let divisions = 1;
  const measures = [];

  for (const [measureIndex, measure] of (part.measures || []).entries()) {
    if (measure.divisions > 0) divisions = measure.divisions;
    let cursor = 0;
    let furthest = 0;
    let previousAttack = 0;
    const notes = [];

    for (const item of measure.items || []) {
      const beats = Number(item.duration || 0) / divisions;
      if (item.kind === "backup") {
        cursor -= beats;
        continue;
      }
      if (item.kind === "forward") {
        cursor += beats;
        furthest = Math.max(furthest, cursor);
        continue;
      }

      const attackBeat = item.isChord ? previousAttack : cursor;
      if (item.pitch && !item.isRest && !item.isGrace) {
        notes.push({
          beat: attackBeat,
          duration: beats,
          pitch: item.pitch,
          // Sem <staff> explícito, cada parte vale por uma mão.
          staff: item.staff || partIndex + 1,
          voice: `${partIndex}:${item.voice}`,
          finger: item.finger,
          tieStop: item.tieStop,
          tieStart: item.tieStart,
        });
      }

      // Notas de ornamento não consomem tempo do compasso.
      if (!item.isChord && !item.isGrace) {
        previousAttack = cursor;
        cursor += beats;
        furthest = Math.max(furthest, cursor);
      }
    }

    measures[measureIndex] = { number: measure.number, length: furthest, notes };
  }

  return measures;
}

function readTimeSignature(parts) {
  for (const part of parts || []) {
    for (const measure of part.measures || []) {
      if (measure.beats > 0 && measure.beatType > 0) {
        return {
          timeSignature: `${measure.beats}/${measure.beatType}`,
          // Sempre em tempos de semínima, a unidade usada em todo o aplicativo.
          beatsPerBar: measure.beats * (4 / measure.beatType),
        };
      }
    }
  }
  return { timeSignature: "", beatsPerBar: 0 };
}

export function buildScoreEvents(score) {
  const parts = score?.parts || [];
  const walks = parts.map(walkPart);
  const measureCount = Math.max(0, ...walks.map((measures) => measures.length));

  // Um compasso vale o maior conteúdo entre as partes: assim mão direita e mão
  // esquerda permanecem alinhadas mesmo quando uma delas tem pausa implícita.
  const measureStarts = [];
  let totalBeats = 0;
  for (let index = 0; index < measureCount; index += 1) {
    measureStarts[index] = totalBeats;
    totalBeats += Math.max(0, ...walks.map((measures) => measures[index]?.length || 0));
  }

  const attacks = [];
  const byBeat = new Map();
  // Última nota soando por voz e altura, para amarrar as ligaduras de valor.
  const sounding = new Map();

  const attackAt = (beat, measureIndex, measureNumber) => {
    const key = Math.round(beat / BEAT_EPSILON);
    let attack = byBeat.get(key);
    if (!attack) {
      attack = {
        beat,
        duration: 0,
        measureIndex,
        measureNumber: measureNumber || String(measureIndex + 1),
        notes: [],
        midis: [],
        pitches: [],
      };
      byBeat.set(key, attack);
      attacks.push(attack);
    }
    return attack;
  };

  for (const measures of walks) {
    for (const [measureIndex, measure] of measures.entries()) {
      for (const note of measure?.notes || []) {
        let midi;
        try {
          midi = noteToMidi(note.pitch);
        } catch {
          continue; // altura ilegível não deve derrubar a peça inteira
        }

        const absoluteBeat = measureStarts[measureIndex] + note.beat;
        const soundingKey = `${note.voice}:${note.staff}:${midi}`;
        const held = sounding.get(soundingKey);

        if (note.tieStop && held) {
          // Continuação: estende a nota anterior em vez de pedir novo ataque.
          const end = absoluteBeat + note.duration;
          held.note.duration = Math.max(held.note.duration, end - held.attack.beat);
          held.attack.duration = Math.max(held.attack.duration, held.note.duration);
          if (!note.tieStart) sounding.delete(soundingKey);
          continue;
        }

        const attack = attackAt(absoluteBeat, measureIndex, measure.number);
        const entry = {
          pitch: note.pitch,
          midi,
          staff: note.staff,
          finger: note.finger,
          duration: note.duration,
        };
        attack.notes.push(entry);
        attack.duration = Math.max(attack.duration, note.duration);

        if (note.tieStart) sounding.set(soundingKey, { attack, note: entry });
        else sounding.delete(soundingKey);
      }
    }
  }

  attacks.sort((a, b) => a.beat - b.beat);
  for (const attack of attacks) {
    attack.notes.sort((a, b) => a.midi - b.midi);
    attack.midis = attack.notes.map((note) => note.midi);
    attack.pitches = attack.notes.map((note) => note.pitch);
  }

  const { timeSignature, beatsPerBar } = readTimeSignature(parts);
  const firstMeasureLength = Math.max(0, ...walks.map((measures) => measures[0]?.length || 0));
  const pickupBeats = beatsPerBar > 0
    && firstMeasureLength > 0
    && firstMeasureLength < beatsPerBar - BEAT_EPSILON
    ? firstMeasureLength
    : 0;

  return {
    title: score?.title || "Peça importada",
    composer: score?.composer || "",
    events: attacks,
    totalBeats,
    timeSignature,
    beatsPerBar,
    pickupBeats,
    measureCount,
    partCount: parts.length,
  };
}

export function parseMusicXml(xmlText) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  return buildScoreEvents(readMusicXmlDocument(document));
}
