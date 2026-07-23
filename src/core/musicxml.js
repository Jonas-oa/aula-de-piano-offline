import { pitchToMidi } from "../data/rhythm-exercises.js";

function directText(element, selector, fallback = "") {
  return element.querySelector(selector)?.textContent?.trim() || fallback;
}

function notePitch(note) {
  if (note.querySelector("rest")) return null;
  const step = directText(note, "pitch > step");
  const octave = directText(note, "pitch > octave");
  const alter = Number(directText(note, "pitch > alter", "0"));
  const accidental = alter === 1 ? "#" : alter === -1 ? "b" : "";
  return step && octave ? `${step}${accidental}${octave}` : null;
}

export function parseMusicXml(xmlText) {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("O arquivo MusicXML não pôde ser lido.");
  }

  const title = directText(document, "work-title")
    || directText(document, "movement-title")
    || "Peça importada";
  const composer = document.querySelector('creator[type="composer"]')?.textContent?.trim() || "";
  const firstPart = document.querySelector("part");
  if (!firstPart) throw new Error("O MusicXML não contém uma parte musical.");

  let divisions = 1;
  let measureStart = 0;
  const attacks = [];

  for (const measure of firstPart.querySelectorAll(":scope > measure")) {
    const configuredDivisions = Number(directText(measure, "attributes > divisions", String(divisions)));
    if (configuredDivisions > 0) divisions = configuredDivisions;
    let cursor = 0;
    let furthest = 0;
    let previousAttack = 0;

    for (const child of measure.children) {
      if (child.localName === "backup") {
        cursor -= Number(directText(child, "duration", "0")) / divisions;
        continue;
      }
      if (child.localName === "forward") {
        cursor += Number(directText(child, "duration", "0")) / divisions;
        furthest = Math.max(furthest, cursor);
        continue;
      }
      if (child.localName !== "note") continue;

      const duration = Number(directText(child, "duration", "0")) / divisions;
      const isChord = Boolean(child.querySelector(":scope > chord"));
      const attackBeat = isChord ? previousAttack : cursor;
      const pitch = notePitch(child);

      if (pitch && !child.querySelector(":scope > grace")) {
        const absoluteBeat = measureStart + attackBeat;
        let attack = attacks.find((candidate) => Math.abs(candidate.beat - absoluteBeat) < 0.0001);
        if (!attack) {
          attack = { beat: absoluteBeat, duration, pitches: [], midis: [] };
          attacks.push(attack);
        }
        attack.pitches.push(pitch);
        attack.midis.push(pitchToMidi(pitch));
        attack.duration = Math.max(attack.duration, duration);
      }

      if (!isChord) {
        previousAttack = cursor;
        cursor += duration;
        furthest = Math.max(furthest, cursor);
      }
    }
    measureStart += furthest;
  }

  attacks.sort((a, b) => a.beat - b.beat);
  return { title, composer, events: attacks, totalBeats: measureStart };
}
