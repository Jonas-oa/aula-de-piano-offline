import { noteToMidi } from "./music.js";

// Leitura de MusicXML em duas camadas:
//
//  1. `readMusicXmlDocument` extrai o documento para uma estrutura simples
//     (só precisa do DOM do navegador);
//  2. `buildScoreEvents` faz toda a aritmética musical — junção de partes,
//     ligaduras de valor, compassos e ataques — sem depender do DOM, o que
//     deixa a parte propensa a erro coberta por testes.

const ACCIDENTAL_BY_ALTER = { "-2": "bb", "-1": "b", 0: "", 1: "#", 2: "##" };
const CLEF_BY_SIGN = { G: "treble", F: "bass" };
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

function readAttributes(attributes) {
  const fifthsText = text(attributes, "key > fifths", "");
  return {
    kind: "attributes",
    divisions: Number(text(attributes, "divisions", "0")) || 0,
    beats: Number(text(attributes, "time > beats", "0")) || 0,
    beatType: Number(text(attributes, "time > beat-type", "0")) || 0,
    staves: Number(text(attributes, "staves", "0")) || 0,
    keyFifths: fifthsText === "" ? null : Number(fifthsText),
    keyMode: text(attributes, "key > mode", ""),
    clefs: [...attributes.children]
      .filter((child) => child.localName === "clef")
      .map((clef) => ({
        number: Number(clef.getAttribute("number")) || 1,
        sign: text(clef, "sign"),
        line: Number(text(clef, "line", "0")) || 0,
        type: CLEF_BY_SIGN[text(clef, "sign")] || null,
      })),
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
        implicit: measure.getAttribute("implicit") === "yes",
        divisions: Number(text(measure, "attributes > divisions", "0")) || 0,
        beats: Number(text(measure, "attributes > time > beats", "0")) || 0,
        beatType: Number(text(measure, "attributes > time > beat-type", "0")) || 0,
        keyFifths: (() => {
          const value = text(measure, "attributes > key > fifths", "");
          return value === "" ? null : Number(value);
        })(),
        keyMode: text(measure, "attributes > key > mode", ""),
        items: [...measure.children].flatMap((child) => {
          if (child.localName === "attributes") return [readAttributes(child)];
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
function walkPart(part, partIndex, partCount) {
  let divisions = 1;
  let beatsPerBar = 0;
  let timeSignature = "";
  let declaredStaves = 0;
  let keyFifths = null;
  let keyMode = "";
  const clefs = new Map();
  const measures = [];

  for (const [measureIndex, measure] of (part.measures || []).entries()) {
    if (measure.divisions > 0) divisions = measure.divisions;
    if (measure.beats > 0 && measure.beatType > 0) {
      beatsPerBar = measure.beats * (4 / measure.beatType);
      timeSignature = `${measure.beats}/${measure.beatType}`;
    }
    let cursor = 0;
    let furthest = 0;
    let previousAttack = 0;
    const notes = [];
    const rests = [];

    for (const item of measure.items || []) {
      if (item.kind === "attributes") {
        if (item.divisions > 0) divisions = item.divisions;
        if (item.beats > 0 && item.beatType > 0) {
          beatsPerBar = item.beats * (4 / item.beatType);
          timeSignature = `${item.beats}/${item.beatType}`;
        }
        if (item.staves > 0) declaredStaves = item.staves;
        if (Number.isFinite(item.keyFifths)) keyFifths = item.keyFifths;
        if (item.keyMode) keyMode = item.keyMode;
        for (const clef of item.clefs || []) {
          if (clef.type) clefs.set(clef.number || 1, clef.type);
        }
        continue;
      }
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
      const sourceStaff = item.staff || 1;
      const fallbackStaff = partCount > 1 ? partIndex + 1 : sourceStaff;
      const clef = clefs.get(sourceStaff)
        || (partCount > 1
          ? (partIndex === 0 ? "treble" : partIndex === 1 ? "bass" : null)
          : null);
      if (item.pitch && !item.isRest && !item.isGrace) {
        notes.push({
          beat: attackBeat,
          duration: beats,
          pitch: item.pitch,
          // `staff` é local à parte no MusicXML. A clave explícita é a fonte
          // principal; o índice da parte só serve como reserva para arquivos de
          // piano exportados como uma parte por mão.
          staff: item.staff || fallbackStaff,
          clef,
          partIndex,
          declaredStaves,
          voice: `${partIndex}:${item.voice}`,
          finger: item.finger,
          tieStop: item.tieStop,
          tieStart: item.tieStart,
        });
      } else if (item.isRest && !item.isGrace && beats > 0) {
        rests.push({
          beat: attackBeat,
          duration: beats,
          staff: item.staff || fallbackStaff,
          clef,
          partIndex,
        });
      }

      // Notas de ornamento não consomem tempo do compasso.
      if (!item.isChord && !item.isGrace) {
        previousAttack = cursor;
        cursor += beats;
        furthest = Math.max(furthest, cursor);
      }
    }

    const isPickup = Boolean(measure.implicit)
      || (measureIndex === 0 && String(measure.number) === "0");
    const length = !isPickup && beatsPerBar > 0
      ? Math.max(furthest, beatsPerBar)
      : furthest;
    measures[measureIndex] = {
      number: measure.number,
      implicit: isPickup,
      length,
      contentLength: furthest,
      notes,
      rests,
      keyFifths,
      keyMode,
      timeSignature,
      beatsPerBar,
    };
  }

  return measures;
}

// Nem todo exportador marca a anacruse com `implicit="yes"` ou com o compasso
// numerado como 0. Sem marcação, porém, um primeiro compasso curto é ambíguo no
// arquivo: pode ser anacruse ou um compasso completo cuja pausa final não foi
// escrita — os dois casos produzem exatamente os mesmos elementos.
//
// O desempate vem da gravação musical: quando a peça abre em anacruse, o último
// compasso é encurtado no mesmo tanto, de modo que os dois juntos fecham uma
// barra inteira. A decisão é tomada depois de alinhar todas as partes. Assim,
// uma mão vazia no primeiro compasso não estica a anacruse detectada na outra.
function inferPickupAcrossParts(walks) {
  const firstMeasures = walks.map((measures) => measures[0]).filter(Boolean);
  if (!firstMeasures.length) return;
  const lastIndex = Math.max(0, ...walks.map((measures) => measures.length - 1));
  const lastMeasures = walks.map((measures) => measures[lastIndex]).filter(Boolean);
  if (!lastMeasures.length || lastIndex === 0) return;

  const beatsPerBar = firstMeasures
    .map((measure) => Number(measure.beatsPerBar))
    .find((value) => value > 0);
  if (!(beatsPerBar > 0)) return;

  const explicit = firstMeasures.filter((measure) => measure.implicit);
  const firstContent = Math.max(0, ...firstMeasures.map((measure) => measure.contentLength || 0));
  const explicitLength = Math.max(0, ...explicit.map((measure) => measure.contentLength || 0));
  let pickupLength = explicit.length ? explicitLength : 0;

  if (!pickupLength) {
    const lastContent = Math.max(0, ...lastMeasures.map((measure) => measure.contentLength || 0));
    const sameMeter = lastMeasures.every((measure) =>
      !(measure.beatsPerBar > 0)
      || Math.abs(measure.beatsPerBar - beatsPerBar) <= BEAT_EPSILON);
    const incompleteEnds = firstContent > 0
      && lastContent > 0
      && firstContent < beatsPerBar - BEAT_EPSILON
      && lastContent < beatsPerBar - BEAT_EPSILON;
    const closes = Math.abs(firstContent + lastContent - beatsPerBar) <= BEAT_EPSILON;
    if (!sameMeter || !incompleteEnds || !closes) return;
    pickupLength = firstContent;
  }

  if (!(pickupLength > 0) || pickupLength >= beatsPerBar - BEAT_EPSILON) return;
  for (const measure of firstMeasures) {
    measure.implicit = true;
    measure.length = pickupLength;
  }
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

function readKeySignature(parts) {
  for (const part of parts || []) {
    for (const measure of part.measures || []) {
      if (Number.isFinite(measure.keyFifths)) {
        return {
          keyFifths: measure.keyFifths,
          keyMode: measure.keyMode || "",
        };
      }
      for (const item of measure.items || []) {
        if (item.kind === "attributes" && Number.isFinite(item.keyFifths)) {
          return {
            keyFifths: item.keyFifths,
            keyMode: item.keyMode || "",
          };
        }
      }
    }
  }
  return { keyFifths: 0, keyMode: "" };
}

export function buildScoreEvents(score) {
  const parts = score?.parts || [];
  const walks = parts.map((part, index) => walkPart(part, index, parts.length));
  inferPickupAcrossParts(walks);
  const measureCount = Math.max(0, ...walks.map((measures) => measures.length));

  // Um compasso vale o maior conteúdo entre as partes: assim mão direita e mão
  // esquerda permanecem alinhadas mesmo quando uma delas tem pausa implícita.
  const measureStarts = [];
  const measureLengths = [];
  let totalBeats = 0;
  for (let index = 0; index < measureCount; index += 1) {
    measureStarts[index] = totalBeats;
    measureLengths[index] = Math.max(
      0,
      ...walks.map((measures) => measures[index]?.length || 0),
    );
    totalBeats += measureLengths[index];
  }

  const attacks = [];
  const rests = [];
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
      for (const rest of measure?.rests || []) {
        rests.push({
          ...rest,
          beat: measureStarts[measureIndex] + rest.beat,
          measureIndex,
          measureNumber: measure.number || String(measureIndex + 1),
        });
      }
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
          clef: note.clef,
          partIndex: note.partIndex,
          finger: note.finger,
          duration: note.duration,
          tieStart: note.tieStart,
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
  const { keyFifths, keyMode } = readKeySignature(parts);
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
    rests: rests.sort((a, b) => a.beat - b.beat || a.staff - b.staff),
    measures: measureStarts.map((beat, index) => ({
      index,
      number: walks.map((measures) => measures[index]?.number).find(Boolean)
        || String(index + 1),
      beat,
      duration: measureLengths[index],
      timeSignature: walks.map((measures) => measures[index]?.timeSignature).find(Boolean) || "",
      beatsPerBar: walks.map((measures) => measures[index]?.beatsPerBar)
        .find((value) => Number(value) > 0) || 0,
      keyFifths: walks.map((measures) => measures[index]?.keyFifths)
        .find((value) => Number.isFinite(value)) ?? keyFifths,
    })),
    totalBeats,
    timeSignature,
    beatsPerBar,
    keyFifths,
    keyMode,
    pickupBeats,
    measureCount,
    partCount: parts.length,
  };
}

export function parseMusicXml(xmlText) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  return buildScoreEvents(readMusicXmlDocument(document));
}
