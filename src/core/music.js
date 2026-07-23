const NOTE_INDEX = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PORTUGUESE = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];

export function noteToMidi(note) {
  const match = /^([A-G])(#|b)?(-?\d)$/.exec(note);
  if (!match) throw new Error(`Nota inválida: ${note}`);
  const pitchClass = `${match[1]}${match[2] || ''}`;
  return (Number(match[3]) + 1) * 12 + NOTE_INDEX[pitchClass];
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

export function frequencyToMidi(frequency, concertPitch = 440) {
  return 69 + 12 * Math.log2(frequency / concertPitch);
}

export function midiToFrequency(midi, concertPitch = 440) {
  return concertPitch * 2 ** ((midi - 69) / 12);
}

export function centsFromMidi(midiFloat) {
  return (midiFloat - Math.round(midiFloat)) * 100;
}

export function isBlackKey(midi) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

export function categoryLabel(category) {
  return ({
    classical: 'Clássica',
    hymn: 'Hino/Gospel',
    exercise: 'Exercício',
    rhythm: 'Ritmo · duas mãos',
  })[category] || category;
}

export function formatDuration(duration) {
  if (duration >= 4) return 'semibreve';
  if (duration >= 2) return 'mínima';
  if (duration >= 1) return 'semínima';
  return 'colcheia';
}
