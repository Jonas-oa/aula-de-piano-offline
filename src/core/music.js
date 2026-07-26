// Fonte única de verdade para alturas musicais. Todo o resto do aplicativo
// (parser MusicXML, exercícios, pauta, teclado e reprodução) converte notas
// por aqui — antes havia três implementações divergentes.

const NOTE_INDEX = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
  F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8,
  A: 9, 'A#': 10, Bb: 10, B: 11,
};
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PORTUGUESE = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
const NATURAL_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// Aceita dobrados (## / bb / x) porque o MusicXML usa <alter> ±2.
const PITCH_PATTERN = /^([A-G])(##|bb|x|#|b)?(-?\d{1,2})$/;
const ALTERATION = { '': 0, '#': 1, b: -1, '##': 2, x: 2, bb: -2 };

// Decompõe uma altura escrita em letra, alteração e oitava.
// Devolve null em vez de lançar — quem precisa de erro usa noteToMidi.
export function parsePitch(pitch) {
  const match = PITCH_PATTERN.exec(String(pitch ?? '').trim());
  if (!match) return null;
  const [, letter, accidental = '', octave] = match;
  return { letter, accidental, alter: ALTERATION[accidental], octave: Number(octave) };
}

export function noteToMidi(note) {
  const parsed = parsePitch(note);
  if (!parsed) throw new Error(`Nota inválida: ${note}`);
  return (parsed.octave + 1) * 12 + NOTE_INDEX[parsed.letter] + parsed.alter;
}

// Grau diatônico absoluto (independente de alteração): define a linha ou o
// espaço em que a nota é escrita na pauta.
export function diatonicStep(pitch) {
  const parsed = parsePitch(pitch);
  if (!parsed) throw new Error(`Nota inválida: ${pitch}`);
  return parsed.octave * 7 + NATURAL_STEP[parsed.letter];
}

export function midiToNote(midi) {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${SHARP_NAMES[((rounded % 12) + 12) % 12]}${octave}`;
}

export function midiToPortuguese(midi, withOctave = true) {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const name = PORTUGUESE[((rounded % 12) + 12) % 12];
  return withOctave ? `${name} ${octave}` : name;
}

export function midiToFrequency(midi, concertPitch = 440) {
  return concertPitch * 2 ** ((midi - 69) / 12);
}

export function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

// Lista ordenada, sem repetições, apenas com MIDIs válidos.
export function uniqueMidis(midis) {
  return [...new Set((midis || [])
    .filter((midi) => Number.isFinite(midi))
    .map((midi) => Math.round(midi)))]
    .sort((a, b) => a - b);
}

// Tempos por compasso, sempre medidos em semínimas — a unidade usada pelo
// parser, pela pauta, pela grade rítmica e pela contagem de entrada.
// 4/4 → 4, 3/4 → 3, 6/8 → 3, 12/8 → 6, 2/2 → 4.
export function beatsPerBarFromSignature(timeSignature) {
  const [numerator, denominator] = String(timeSignature ?? '').split('/').map(Number);
  if (!(numerator > 0) || !(denominator > 0)) return 4;
  return numerator * (4 / denominator);
}

export function sameMidis(left = [], right = []) {
  return left.length === right.length
    && left.every((midi, index) => midi === right[index]);
}
