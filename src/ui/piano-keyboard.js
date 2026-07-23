const BLACK_NOTES = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ["Dó", "Dó♯", "Ré", "Mi♭", "Mi", "Fá", "Fá♯", "Sol", "Lá♭", "Lá", "Si♭", "Si"];

export function isBlackMidi(midi) {
  return BLACK_NOTES.has(Number(midi) % 12);
}

export function midiLabel(midi) {
  const value = Number(midi);
  return `${NOTE_NAMES[value % 12]} ${Math.floor(value / 12) - 1}`;
}

export function renderStudyKeyboard(container, {
  fromMidi = 36,
  toMidi = 84,
  onPress = () => {},
} = {}) {
  const whiteMidis = [];
  for (let midi = fromMidi; midi <= toMidi; midi += 1) {
    if (!isBlackMidi(midi)) whiteMidis.push(midi);
  }

  container.replaceChildren();
  container.style.setProperty("--white-key-count", String(whiteMidis.length));

  whiteMidis.forEach((midi) => {
    const key = createKey(midi, false, onPress);
    container.append(key);
  });

  let whitesSeen = 0;
  for (let midi = fromMidi; midi <= toMidi; midi += 1) {
    if (!isBlackMidi(midi)) {
      whitesSeen += 1;
      continue;
    }
    const key = createKey(midi, true, onPress);
    key.style.left = `${(whitesSeen / whiteMidis.length) * 100}%`;
    container.append(key);
  }
}

function createKey(midi, black, onPress) {
  const key = document.createElement("button");
  key.type = "button";
  key.className = `study-key ${black ? "black" : "white"}`;
  key.dataset.midi = String(midi);
  key.setAttribute("aria-label", midiLabel(midi));
  if (!black && midi % 12 === 0) key.innerHTML = `<span>Dó ${Math.floor(midi / 12) - 1}</span>`;
  key.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    onPress(midi);
    flashStudyKey(key);
  });
  return key;
}

export function setKeyboardTargets(container, midis = []) {
  const target = new Set(midis.map(Number));
  container.querySelectorAll(".study-key").forEach((key) => {
    key.classList.toggle("target", target.has(Number(key.dataset.midi)));
  });
}

export function flashKeyboardMidi(container, midi, durationMs = 180) {
  const key = container.querySelector(`.study-key[data-midi="${Number(midi)}"]`);
  if (key) flashStudyKey(key, durationMs);
}

export function pulseStudyKeyboard(container) {
  container.classList.remove("heard");
  void container.offsetWidth;
  container.classList.add("heard");
}

function flashStudyKey(key, durationMs = 180) {
  key.classList.add("active");
  window.setTimeout(() => key.classList.remove("active"), durationMs);
}
