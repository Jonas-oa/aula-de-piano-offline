const VALID_HANDS = new Set(["both", "right", "left"]);

export function normalizePracticeHand(hand) {
  return VALID_HANDS.has(hand) ? hand : "both";
}

export function hasSelectedPracticeRange(loop = null) {
  return Number.isInteger(loop?.a) && Number.isInteger(loop?.b);
}

// Selecionar A–B significa preparar um estudo repetido. O aluno ainda pode
// desligar a repetição de propósito pelo botão, mas não precisa descobrir um
// segundo controle depois de já ter delimitado o trecho.
export function activateSelectedPracticeRange(loop = null) {
  if (hasSelectedPracticeRange(loop)) loop.active = true;
  return loop;
}

export function shouldRepeatPracticeRange(loop = null) {
  return hasSelectedPracticeRange(loop) && loop.active === true;
}

// A clave é mais confiável que o número do staff quando o MusicXML usa duas
// partes separadas (ambas podem chamar sua pauta local de staff 1).
export function practiceHandForNote(note = {}) {
  if (note.clef === "treble") return "right";
  if (note.clef === "bass") return "left";

  const staff = Number(note.staff);
  if (Number.isFinite(staff) && staff > 0) return staff >= 2 ? "left" : "right";

  const partIndex = Number(note.partIndex);
  if (Number.isInteger(partIndex) && partIndex >= 0) {
    return partIndex === 0 ? "right" : "left";
  }

  const midi = Number(note.midi);
  if (Number.isFinite(midi)) return midi < 60 ? "left" : "right";
  return null;
}

export function notesForPracticeHand(notes = [], hand = "both") {
  const normalized = normalizePracticeHand(hand);
  const list = Array.isArray(notes) ? notes : [];
  if (normalized === "both") return [...list];
  return list.filter((note) => practiceHandForNote(note) === normalized);
}

function filteredLegacyMidis(event, hand) {
  const midis = Array.isArray(event?.midis) ? event.midis : [];
  if (hand === "both") return [...midis];
  return midis.filter((midi) => practiceHandForNote({ midi }) === hand);
}

export function derivePracticeEvents(events = [], hand = "both") {
  const normalized = normalizePracticeHand(hand);
  const source = Array.isArray(events) ? events : [];

  return source.flatMap((event, index) => {
    const hasStructuredNotes = Array.isArray(event?.notes);
    const notes = hasStructuredNotes
      ? notesForPracticeHand(event.notes, normalized)
      : [];
    const midis = hasStructuredNotes
      ? notes.map((note) => note.midi).filter(Number.isFinite)
      : filteredLegacyMidis(event, normalized);

    if (normalized !== "both" && !notes.length && !midis.length) return [];

    const pitches = hasStructuredNotes
      ? notes.map((note) => note.pitch).filter(Boolean)
      : Array.isArray(event?.pitches)
        ? event.pitches.filter((_, pitchIndex) => midis.includes(event.midis?.[pitchIndex]))
        : [];
    const noteDuration = notes.reduce(
      (longest, note) => Math.max(longest, Number(note.duration) || 0),
      0,
    );

    return [{
      ...event,
      originalIndex: Number.isInteger(event?.originalIndex) ? event.originalIndex : index,
      notes,
      midis,
      pitches,
      duration: noteDuration || Number(event?.duration) || 0,
    }];
  });
}

export function availablePracticeHands(events = []) {
  const source = Array.isArray(events) ? events : [];
  const available = { right: false, left: false };

  for (const event of source) {
    const notes = Array.isArray(event?.notes)
      ? event.notes
      : (event?.midis || []).map((midi) => ({ midi }));
    for (const note of notes) {
      const hand = practiceHandForNote(note);
      if (hand) available[hand] = true;
    }
    if (available.right && available.left) break;
  }
  return available;
}

function safeEventIndex(events, index) {
  const last = Math.max(0, (events?.length || 1) - 1);
  return Math.max(0, Math.min(last, Number(index) || 0));
}

export function normalizeMeasureRange(events = [], anchor = 0, focus = anchor) {
  if (!events.length) return { a: 0, b: -1, startMeasure: null, endMeasure: null };

  const rawA = Math.min(safeEventIndex(events, anchor), safeEventIndex(events, focus));
  const rawB = Math.max(safeEventIndex(events, anchor), safeEventIndex(events, focus));
  const startMeasure = Number.isInteger(events[rawA]?.measureIndex)
    ? events[rawA].measureIndex
    : null;
  const endMeasure = Number.isInteger(events[rawB]?.measureIndex)
    ? events[rawB].measureIndex
    : null;

  if (startMeasure === null || endMeasure === null) {
    return { a: rawA, b: rawB, startMeasure, endMeasure };
  }

  let a = rawA;
  let b = rawB;
  while (a > 0 && events[a - 1]?.measureIndex === startMeasure) a -= 1;
  while (b < events.length - 1 && events[b + 1]?.measureIndex === endMeasure) b += 1;
  return { a, b, startMeasure, endMeasure };
}

export function selectedPracticeEvents(events = [], hand = "both", loop = null) {
  const filtered = derivePracticeEvents(events, hand);
  if (loop?.a == null || loop?.b == null) return filtered;
  const start = Math.min(loop.a, loop.b);
  const end = Math.max(loop.a, loop.b);
  return filtered.filter(({ originalIndex }) => originalIndex >= start && originalIndex <= end);
}
