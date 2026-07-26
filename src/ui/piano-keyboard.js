import { isBlackKey, midiToPortuguese } from "../core/music.js";

export const PIANO_KEY_COUNT = 49;
export const DEFAULT_PIANO_START = 36; // Dó 2 até Dó 6

export function pianoRangeForMidis(midis = [], fallbackStart = DEFAULT_PIANO_START) {
  const playable = midis.filter(Number.isFinite);
  if (!playable.length) return fallbackStart;

  const minimum = Math.min(...playable);
  const maximum = Math.max(...playable);
  let start = fallbackStart;

  while (minimum < start) start -= 12;
  while (maximum > start + PIANO_KEY_COUNT - 1) start += 12;

  // Se o trecho ultrapassar quatro oitavas, prioriza a nota atual (a primeira).
  if (minimum < start || maximum > start + PIANO_KEY_COUNT - 1) {
    start = Math.floor(playable[0] / 12) * 12 - 12;
  }
  return start;
}

export function pianoKeyLayout(startMidi = DEFAULT_PIANO_START) {
  const midis = Array.from({ length: PIANO_KEY_COUNT }, (_, index) => startMidi + index);
  const whiteCount = midis.filter((midi) => !isBlackKey(midi)).length;
  const whiteWidth = 100 / whiteCount;
  const blackWidth = whiteWidth * 0.62;
  let whitesSeen = 0;

  return midis.map((midi) => {
    const black = isBlackKey(midi);
    const key = {
      midi,
      black,
      left: black ? whitesSeen * whiteWidth - blackWidth / 2 : whitesSeen * whiteWidth,
      width: black ? blackWidth : whiteWidth,
    };
    if (!black) whitesSeen += 1;
    return key;
  });
}

function uniqueMidis(midis = []) {
  return [...new Set(midis.filter(Number.isFinite).map((midi) => Math.round(midi)))];
}

export class PianoKeyboard {
  constructor(container, hint) {
    this.container = container;
    this.hint = hint;
    this.startMidi = DEFAULT_PIANO_START;
    this.keys = new Map();
    this.build();
  }

  build() {
    this.container.replaceChildren();
    this.keys.clear();
    const fragment = document.createDocumentFragment();

    pianoKeyLayout(this.startMidi).forEach(({ midi, black, left, width }) => {
      const key = document.createElement("span");
      key.className = `piano-key ${black ? "black" : "white"}`;
      key.style.left = `${left}%`;
      key.style.width = `${width}%`;
      key.dataset.midi = String(midi);
      key.setAttribute("aria-label", midiToPortuguese(midi));
      key.setAttribute("aria-current", "false");

      const label = document.createElement("span");
      label.className = "piano-key-label";
      key.append(label);
      fragment.append(key);
      this.keys.set(midi, key);
    });

    this.container.append(fragment);
  }

  setUnavailable(message = "Importe um MusicXML para ver as notas no teclado") {
    this.clearHighlights();
    this.hint.textContent = message;
  }

  showNoteGroups(groups = []) {
    const normalized = groups
      .map((group) => uniqueMidis(group))
      .filter((group) => group.length)
      .slice(0, 4);
    const allMidis = normalized.flat();
    const nextStart = pianoRangeForMidis(allMidis, this.startMidi);
    if (nextStart !== this.startMidi) {
      this.startMidi = nextStart;
      this.build();
    }

    this.clearHighlights();
    normalized.forEach((group, groupIndex) => {
      group.forEach((midi) => {
        const key = this.keys.get(midi);
        if (!key) return;
        const className = groupIndex === 0 ? "current" : `upcoming-${groupIndex}`;
        // A nota atual sempre prevalece quando a mesma tecla reaparece em seguida.
        if (!key.classList.contains("current")) key.classList.add(className);
        if (groupIndex === 0) {
          key.setAttribute("aria-current", "true");
          key.querySelector(".piano-key-label").textContent = midiToPortuguese(midi);
        }
      });
    });

    if (!normalized.length) {
      this.hint.textContent = "Trecho concluído";
      return;
    }

    const current = normalized[0].map((midi) => midiToPortuguese(midi)).join(" + ");
    const next = normalized[1]?.map((midi) => midiToPortuguese(midi)).join(" + ");
    this.hint.textContent = next ? `Agora: ${current} · Depois: ${next}` : `Agora: ${current}`;
  }

  clearHighlights() {
    this.keys.forEach((key) => {
      key.classList.remove("current", "upcoming-1", "upcoming-2", "upcoming-3");
      key.setAttribute("aria-current", "false");
      key.querySelector(".piano-key-label").textContent = "";
    });
  }
}
