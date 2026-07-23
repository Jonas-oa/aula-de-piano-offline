const NOTE_INDEX = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8,
  A: 9, "A#": 10, Bb: 10, B: 11,
};

export function pitchToMidi(pitch) {
  const match = /^([A-G](?:#|b)?)(-?\d)$/.exec(pitch);
  if (!match || NOTE_INDEX[match[1]] === undefined) {
    throw new Error(`Nota inválida: ${pitch}`);
  }
  return (Number(match[2]) + 1) * 12 + NOTE_INDEX[match[1]];
}

export function parseRhythmPattern(pattern, repeats = 1) {
  const events = [];
  let beat = 0;

  for (let repetition = 0; repetition < repeats; repetition += 1) {
    for (const token of pattern.trim().split(/\s+/)) {
      const [pitchSpec, durationSpec = "1"] = token.split("/");
      const duration = Number(durationSpec);
      const pitches = pitchSpec.split("+");
      events.push({
        beat,
        duration,
        pitches,
        midis: pitches.map(pitchToMidi),
      });
      beat += duration;
    }
  }

  return events;
}

const definitions = [
  ["pulso-44", "Pulso 4/4 — mãos juntas", "Fundamentos", "iniciante", 64, "4/4", 4,
    "Sincronizar as duas mãos em quatro pulsos iguais.",
    "C3+C4+E4+G4/1 G3+B3+D4+G4/1 A3+C4+E4+A4/1 G3+B3+D4+G4/1", 4],
  ["valsa", "Valsa — baixo e dois acordes", "Valsa", "iniciante", 68, "3/4", 3,
    "Sentir o primeiro tempo forte e manter os tempos dois e três leves.",
    "C3/1 C4+E4+G4/1 C4+E4+G4/1", 6],
  ["pop-44", "Pop 4/4 — baixo e pulsos", "Pop/Rock", "iniciante", 76, "4/4", 4,
    "Alternar baixo e acordes sem perder o pulso.",
    "C3/1 C4+E4+G4/1 G3/1 B3+D4+G4/1", 4],
  ["blues-basico", "Blues — pergunta e resposta", "Blues", "iniciante", 72, "4/4", 4,
    "Alternar baixo e acorde dominante com pulso estável.",
    "C3/1 C4+Eb4+G4/1 G3/1 Bb3+E4+G4/1", 4],
  ["blues-shuffle", "Blues shuffle — 12/8", "Blues", "intermediario", 88, "12/8", 6,
    "Distribuir seis pulsos ternários entre baixo e acordes.",
    "C3+G3/1 C4+Eb4+G4/1 G3+Bb3/1 C4+E4+G4/1 A3+C4/1 Bb3+E4+G4/1", 3],
  ["blues-walking", "Blues — baixo caminhante", "Blues", "avancado", 112, "4/4", 4,
    "Manter o baixo em movimento sob acordes de contratempo.",
    "C3/.5 C4+Eb4+G4/.5 E3/.5 G3+Bb3/.5 G3/.5 Bb3+E4+G4/.5 A3/.5 C4+F4+A4/.5", 2],
  ["jazz-shells", "Jazz — voicings essenciais", "Jazz", "iniciante", 72, "4/4", 4,
    "Coordenar fundamentais com terças e sétimas.",
    "C3+E4+B4/1 A2+C4+G4/1 D3+F4+C5/1 G2+F4+B4/1", 4],
  ["jazz-comping", "Jazz comping — deslocamentos", "Jazz", "intermediario", 96, "4/4", 4,
    "Deslocar acordes sem perder o pulso do baixo.",
    "C3/.5 E4+B4/.5 G3/.5 E4+Bb4/.5 A2/.5 C4+G4/.5 D3/.5 F4+C5/.5", 2],
  ["jazz-54", "Jazz 5/4 — agrupamento 3+2", "Jazz", "avancado", 108, "5/4", 5,
    "Agrupar cinco pulsos com independência entre as mãos.",
    "D3+F4+C5/1 A2+F4+C5/1 D3+A4+C5/1 G2+F4+B4/1 A2+G4+C#5/1", 4],
  ["forro-basico", "Forró — baixo e contratempo", "Forró/Baião", "iniciante", 84, "2/4", 2,
    "Alternar baixo e acorde em subdivisões iguais.",
    "D3/.5 A3+D4+F#4/.5 A2/.5 A3+C#4+E4/.5", 6],
  ["baiao", "Baião — baixo antecipado", "Forró/Baião", "intermediario", 96, "2/4", 2,
    "Firmar a célula grave enquanto a direita responde.",
    "D3/.25 A3+D4+F#4/.25 A2/.25 A3+C#4+E4/.25 D3/.25 F#3+A3+D4/.25 A2/.25 A3+C#4+E4/.25", 3],
  ["forro-avancado", "Forró — síncopes cruzadas", "Forró/Baião", "avancado", 118, "2/4", 2,
    "Cruzar acentos entre baixo, quinta e tríades.",
    "D3/.25 A3/.25 D4+F#4+A4/.25 A2/.25 C#3/.25 A3+C#4+E4/.25 E3/.25 A3+C#4+E4/.25", 3],
  ["samba-basico", "Samba — marcação em 2/4", "Samba", "iniciante", 88, "2/4", 2,
    "Marcar dois tempos com baixo e acordes leves.",
    "C3/.5 C4+E4+G4/.5 G3/.5 C4+E4+A4/.5", 6],
  ["samba-sincopado", "Samba — acordes sincopados", "Samba", "intermediario", 104, "2/4", 2,
    "Separar a marcação grave dos acordes curtos.",
    "C3/.25 E4+G4+B4/.25 G3/.25 C4+E4+A4/.25 A2/.25 C4+E4+G4/.25 G3/.25 B3+F4+A4/.25", 3],
  ["samba-camadas", "Samba — camadas independentes", "Samba", "avancado", 124, "2/4", 2,
    "Combinar linha grave, sétimas e acentos deslocados.",
    "C3/.25 G3/.25 E4+B4/.25 C4+G4/.25 A2/.25 E3/.25 C4+G4/.25 D4+F4+B4/.25", 3],
  ["gospel-basico", "Gospel — progressão I–IV–V", "Gospel", "iniciante", 70, "4/4", 4,
    "Trocar acordes completos mantendo as mãos juntas.",
    "C3+C4+E4+G4/1 F3+C4+F4+A4/1 G3+B3+D4+G4/1 C3+C4+E4+G4/1", 4],
  ["gospel-68", "Gospel 6/8 — adoração", "Gospel", "intermediario", 66, "6/8", 3,
    "Sustentar o baixo e distribuir a tríade.",
    "G2+G4/.5 B3+D4/.5 D4+G4/.5 C3+E4/.5 G3+C4/.5 C4+E4/.5", 6],
  ["gospel-turnaround", "Gospel — turnaround cromático", "Gospel", "avancado", 92, "4/4", 4,
    "Conduzir acordes com sétimas e aproximação cromática.",
    "C3+E4+G4+B4/.5 B2+D4+F4+A4/.5 Bb2+Db4+E4+G4/.5 A2+C4+E4+G4/.5 D3+F4+A4+C5/.5 G2+F4+B4/.5 Db3+F4+Ab4+B4/.5 C3+E4+G4+C5/.5", 2],
  ["bossa-basica", "Bossa nova — baixo e acorde", "Bossa nova", "iniciante", 76, "4/4", 4,
    "Alternar fundamental e quinta com acordes suaves.",
    "C3/1 E4+G4+B4/1 G3/1 E4+A4+C5/1", 4],
  ["bossa-antecipada", "Bossa nova — antecipações", "Bossa nova", "avancado", 92, "4/4", 4,
    "Antecipar acordes da direita sobre o baixo regular.",
    "C3/.5 E4+G4+B4/.5 G3/.5 E4+A4+C5/.5 A2/.5 C4+E4+G4/.5 E3/.5 D4+G4+B4/.5", 2],
  ["reggae", "Reggae — contratempo", "Reggae", "intermediario", 78, "4/4", 4,
    "Manter o baixo no pulso e destacar contratempos.",
    "C3/.5 C4+E4+G4/.5 G3/.5 C4+E4+G4/.5 A2/.5 C4+E4+A4/.5 G2/.5 B3+D4+G4/.5", 2],
  ["funk", "Funk/Soul — semicolcheias", "Funk/Soul", "avancado", 104, "4/4", 4,
    "Articular semicolcheias com acordes curtos e baixo firme.",
    "E2/.25 B2/.25 G3+B3+D4/.25 B2/.25 E3/.25 G3+A3+D4/.25 B2/.25 G3+B3+D4/.25 E2/.25 B2/.25 A3+C4+E4/.25 B2/.25 D3/.25 G3+B3+D4/.25 B2/.25 E3/.25", 2],
  ["montuno", "Latino — montuno inicial", "Latino", "intermediario", 100, "4/4", 4,
    "Repetir uma célula sincopada sobre baixos alternados.",
    "C3/.5 G3+C4+Eb4/.5 G2/.5 C4+Eb4+G4/.5 C3/.5 Bb3+Eb4+G4/.5 G2/.5 C4+Eb4+G4/.5", 2],
  ["rock", "Rock — oitavas e acordes", "Pop/Rock", "intermediario", 112, "4/4", 4,
    "Firmar oitavas na esquerda e ataques na direita.",
    "E2+E3+G#3+B3+E4/1 E2+E3/1 A2+A3+C#4+E4/1 B2+B3+D#4+F#4/1", 4],
];

export const rhythmExercises = definitions.map((definition, index) => {
  const [slug, title, style, level, bpm, timeSignature, beatsPerBar, focus, pattern, repeats] = definition;
  return {
    id: `rhythm-${slug}`,
    type: "rhythm",
    title,
    composer: "Exercício original do aplicativo",
    style,
    level,
    bpm,
    timeSignature,
    beatsPerBar,
    focus,
    events: parseRhythmPattern(pattern, repeats),
    order: index,
  };
});

export function getRhythmExercise(id) {
  return rhythmExercises.find((exercise) => exercise.id === id) || null;
}
