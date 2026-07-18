// Sintaxe de um evento: NOTA[:duração][@dedo], com acordes unindo notas por "+".
// Ex.: "F#4:1.5@2"  ·  "C3:4+E4:1@3" (baixo sustentado + melodia)  ·  "C4+E4+G4:2" (tríade)
const e = /^([A-G])(#|b)?(-?\d)(?::([0-9.]+))?(?:@([1-5]))?$/
const NATURAL_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
const NOTE_INDEX = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 }

function parsePitchSpec(token) {
  const a = token.match(e)
  if (!a) throw new Error(`Nota inválida no catálogo: ${token}`)
  const pitch = `${a[1]}${a[2] || ""}${a[3]}`
  return {
    pitch,
    midi: (Number(a[3]) + 1) * 12 + NOTE_INDEX[`${a[1]}${a[2] || ""}`],
    duration: a[4] ? Number(a[4]) : null,
    finger: a[5] ? Number(a[5]) : null,
  }
}

export function parseSequence(i, o = 1) {
  const events = i
    .trim()
    .split(/\s+/)
    .map((token) => {
      const pitches = token.split("+").map((part) => parsePitchSpec(part))
      // Num acorde, notas sem duração explícita herdam a maior duração
      // declarada no próprio acorde; sem nenhuma, valem o padrão da música.
      const declared = pitches.filter((p) => p.duration !== null).map((p) => p.duration)
      const inherited = declared.length ? Math.max(...declared) : o
      pitches.forEach((p) => {
        if (p.duration === null) p.duration = inherited
      })
      pitches.sort((a, b) => a.midi - b.midi)
      const top = pitches[pitches.length - 1]
      return {
        // Compatibilidade: `pitch`, `duration` e `finger` continuam existindo e
        // representam a voz superior (melodia). `pitches` traz o evento completo.
        pitch: top.pitch,
        duration: Math.min(...pitches.map((p) => p.duration)),
        finger: pitches.length === 1 ? top.finger : null,
        pitches: pitches.map(({ pitch, duration, finger }) => ({ pitch, duration, finger })),
      }
    })
  return autoFingerFivePosition(events)
}

// Dedilhado automático somente quando a peça cabe numa posição fixa de
// cinco dedos (mão direita): dedo = posição diatônica dentro do âmbito.
// Fora disso, sem dedilhado explícito, nada é sugerido — melhor omitir
// do que ensinar dedilhado errado.
function autoFingerFivePosition(events) {
  if (events.some((event) => event.pitches.length > 1 || event.finger)) return events
  const steps = events.map((event) => {
    const match = /^([A-G])(?:#|b)?(-?\d)$/.exec(event.pitch)
    return Number(match[2]) * 7 + NATURAL_STEP[match[1]]
  })
  const low = Math.min(...steps)
  if (Math.max(...steps) - low > 4) return events
  return events.map((event, index) => {
    const finger = steps[index] - low + 1
    return { ...event, finger, pitches: [{ ...event.pitches[0], finger }] }
  })
}
const i = {
  playable: !0,
  arrangement:
    "Trecho didático simplificado, transcrito especialmente para este aplicativo e sem letra.",
  license: "Arranjo didático do projeto: CC0-1.0",
}
export const catalog = [
  {
    ...i,
    id: "ode-to-joy",
    title: "Ode à Alegria",
    originalTitle: "Ode to Joy",
    composer: "Ludwig van Beethoven",
    category: "classical",
    difficulty: 1,
    bpm: 82,
    key: "C",
    clef: "treble",
    notes: parseSequence(
      "E4@3 E4@3 F4@4 G4@5 G4@5 F4@4 E4@3 D4@2 C4@1 C4@1 D4@2 E4@3 E4:1.5@3 D4:0.5@2 D4:2@2 E4@3 E4@3 F4@4 G4@5 G4@5 F4@4 E4@3 D4@2 C4@1 C4@1 D4@2 E4@3 D4:1.5@2 C4:0.5@1 C4:2@1 D4@2 D4@2 E4@3 C4@1 D4@2 E4:0.5@3 F4:0.5@4 E4@3 C4@1 D4@2 E4:0.5@3 F4:0.5@4 E4@3 D4@2 C4@1 D4@2 G3:2 E4@3 E4@3 F4@4 G4@5 G4@5 F4@4 E4@3 D4@2 C4@1 C4@1 D4@2 E4@3 D4:1.5@2 C4:0.5@1 C4:2@1",
    ),
  },
  {
    ...i,
    id: "fur-elise",
    beatsPerBar: 0,
    title: "Para Elisa",
    originalTitle: "Für Elise",
    composer: "Ludwig van Beethoven",
    category: "classical",
    difficulty: 3,
    bpm: 72,
    key: "Am",
    clef: "treble",
    notes: parseSequence(
      "E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1 C4:0.5 E4:0.5 A4:0.5 B4:1 E4:0.5 G#4:0.5 B4:0.5 C5:1 E4:0.5 E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1 C4:0.5 E4:0.5 A4:0.5 B4:1 E4:0.5 C5:0.5 B4:0.5 A4:1 B4:0.5 C5:0.5 D5:0.5 E5:1 G4:0.5 F5:0.5 E5:0.5 D5:1 F4:0.5 E5:0.5 D5:0.5 C5:1 E4:0.5 D5:0.5 C5:0.5 B4:1 E4:0.5 E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1 C4:0.5 E4:0.5 A4:0.5 B4:1 E4:0.5 G#4:0.5 B4:0.5 C5:1 E4:0.5 E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1 C4:0.5 E4:0.5 A4:0.5 B4:1 E4:0.5 C5:0.5 B4:0.5 A4:2",
    ),
  },
  {
    ...i,
    id: "prelude-c-major",
    title: "Prelúdio em Dó Maior",
    originalTitle: "Prelude in C Major, BWV 846",
    composer: "Johann Sebastian Bach",
    category: "classical",
    difficulty: 3,
    bpm: 66,
    key: "C",
    clef: "treble",
    notes: parseSequence(
      "C4:0.5 E4:0.5 G4:0.5 C5:0.5 E5:0.5 G4:0.5 C5:0.5 E5:0.5 C4:0.5 E4:0.5 G4:0.5 C5:0.5 E5:0.5 G4:0.5 C5:0.5 E5:0.5 C4:0.5 D4:0.5 A4:0.5 D5:0.5 F5:0.5 A4:0.5 D5:0.5 F5:0.5 C4:0.5 D4:0.5 A4:0.5 D5:0.5 F5:0.5 A4:0.5 D5:0.5 F5:0.5",
    ),
  },
  {
    ...i,
    id: "minuet-g",
    beatsPerBar: 3,
    title: "Minueto em Sol",
    originalTitle: "Minuet in G, BWV Anh. 114",
    composer: "Christian Petzold",
    category: "classical",
    difficulty: 2,
    bpm: 92,
    key: "G",
    clef: "treble",
    notes: parseSequence(
      "D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 D5:1 G4:1 G4:1 E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5:1 G4:1 G4:1 C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4:1 G4:0.5 A4:0.5 B4:1 G4:1",
    ),
  },
  {
    ...i,
    id: "canon-d",
    title: "Cânone em Ré",
    originalTitle: "Canon in D",
    composer: "Johann Pachelbel",
    category: "classical",
    difficulty: 2,
    bpm: 64,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "F#4 A4 D5 A4 E4 A4 C#5 A4 D4 F#4 B4 F#4 C#4 E4 A4 E4 D4 F#4 B4 F#4 D4 G4 B4 G4 E4 A4 C#5 A4 E4 G4 B4 C#5",
    ),
  },
  {
    ...i,
    id: "eine-kleine",
    title: "Pequena Serenata Noturna",
    originalTitle: "Eine kleine Nachtmusik",
    composer: "Wolfgang Amadeus Mozart",
    category: "classical",
    difficulty: 3,
    bpm: 116,
    key: "G",
    clef: "treble",
    notes: parseSequence(
      "G4:0.5 D5:0.5 G5:1 D5:1 G5:0.5 D5:0.5 G5:1 B4:0.5 D5:0.5 C5:0.5 A4:0.5 A4:1 C5:0.5 A4:0.5 F#4:0.5 A4:0.5 D5:1 D5:0.5 B4:0.5 G4:1",
    ),
  },
  {
    ...i,
    id: "swan-lake",
    title: "O Lago dos Cisnes",
    originalTitle: "Swan Lake Theme",
    composer: "Pyotr Ilyich Tchaikovsky",
    category: "classical",
    difficulty: 4,
    bpm: 66,
    key: "Bm",
    clef: "treble",
    notes: parseSequence(
      "F#4:1 B4:1 C#5:1 D5:1 E5:1 D5:1 C#5:1 B4:1 F#5:1 E5:1 D5:1 C#5:1 B4:2 A#4:1 B4:1 C#5:1 D5:1 E5:1 F#5:1 E5:1 D5:1 C#5:1 B4:2",
    ),
  },
  {
    ...i,
    id: "morning-mood",
    title: "Amanhecer",
    originalTitle: "Morning Mood",
    composer: "Edvard Grieg",
    category: "classical",
    difficulty: 2,
    bpm: 76,
    key: "E",
    clef: "treble",
    notes: parseSequence(
      "G#4:1 E4:1 F#4:1 G#4:1 B4:1 G#4:1 F#4:1 E4:1 G#4:1 B4:1 C#5:1 B4:1 G#4:2 F#4:1 E4:1 F#4:1 G#4:1 B4:1 C#5:1 B4:1 G#4:1 F#4:1 E4:2",
    ),
  },
  {
    ...i,
    id: "blue-danube",
    beatsPerBar: 3,
    title: "Danúbio Azul",
    originalTitle: "The Blue Danube",
    composer: "Johann Strauss II",
    category: "classical",
    difficulty: 3,
    bpm: 88,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "A4:1 C#5:1 E5:1 E5:2 D5:1 D5:2 A4:1 C#5:1 E5:1 E5:2 D5:1 D5:2 B4:1 D5:1 F#5:1 F#5:2 E5:1 E5:2 A4:1 C#5:1 E5:1 A5:2 G5:1 F#5:1 E5:2",
    ),
  },
  {
    ...i,
    id: "new-world-largo",
    title: "Largo do Novo Mundo",
    originalTitle: "New World Symphony — Largo",
    composer: "Antonín Dvořák",
    category: "classical",
    difficulty: 2,
    bpm: 58,
    key: "Db",
    clef: "treble",
    notes: parseSequence(
      "D4:2 F4:1 F4:1 D4:2 C4:1 Bb3:1 C4:2 D4:1 F4:1 D4:2 C4:2 D4:2 F4:1 Ab4:1 G4:2 F4:1 D4:1 C4:2 Bb3:2",
    ),
  },
  {
    ...i,
    id: "air-g-string",
    title: "Ária na Corda Sol",
    originalTitle: "Air on the G String",
    composer: "Johann Sebastian Bach",
    category: "classical",
    difficulty: 4,
    bpm: 52,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "F#4:2 A4:1 G4:1 F#4:2 E4:1 D4:1 C#4:2 D4:1 E4:1 F#4:2 E4:1 D4:1 B4:2 A4:1 G4:1 F#4:2 E4:2 D4:4",
    ),
  },
  {
    ...i,
    id: "gymnopedie-1",
    beatsPerBar: 3,
    title: "Gymnopédie nº 1",
    originalTitle: "Gymnopédie No. 1",
    composer: "Erik Satie",
    category: "classical",
    difficulty: 3,
    bpm: 54,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "F#4:2 A4:2 G4:2 F#4:2 C#5:2 B4:2 A4:4 F#4:2 A4:2 G4:2 F#4:2 E4:2 D4:2 C#4:2 D4:2 F#4:2",
    ),
  },
  {
    ...i,
    id: "amazing-grace",
    beatsPerBar: 3,
    pickupBeats: 1,
    title: "Graça Maravilhosa",
    originalTitle: "Amazing Grace",
    composer: "Melodia tradicional “New Britain”",
    category: "hymn",
    difficulty: 1,
    bpm: 68,
    key: "G",
    clef: "treble",
    notes: parseSequence(
      "D4 G4:2 B4:0.5 G4:0.5 B4:2 A4 G4:2 E4 D4:2 D4 G4:2 B4:0.5 G4:0.5 B4:2 A4 D5:3 D5:2 B4 D5:2 B4:0.5 G4:0.5 B4:2 A4 G4:2 E4 D4:2 D4 G4:2 B4:0.5 G4:0.5 B4:2 A4 G4:3",
    ),
  },
  {
    ...i,
    id: "nearer-my-god",
    title: "Mais Perto Quero Estar",
    originalTitle: "Nearer, My God, to Thee — Bethany",
    composer: "Lowell Mason",
    category: "hymn",
    difficulty: 2,
    bpm: 70,
    key: "F",
    clef: "treble",
    notes: parseSequence(
      "C4:1 F4:2 A4:1 G4:2 F4:1 E4:1 D4:2 F4:1 A4:1 C5:2 Bb4:1 A4:1 G4:3 C4:1 F4:2 A4:1 G4:2 F4:1 E4:1 D4:2 F4:1 E4:1 D4:2 C4:3",
    ),
  },
  {
    ...i,
    id: "what-a-friend",
    title: "Que Amigo em Cristo Temos",
    originalTitle: "What a Friend We Have in Jesus",
    composer: "Charles C. Converse",
    category: "hymn",
    difficulty: 2,
    bpm: 76,
    key: "F",
    clef: "treble",
    notes: parseSequence(
      "C4:1 F4:1 A4:1 C5:2 A4:1 F4:1 A4:1 G4:2 F4:1 D4:1 C4:2 C4:1 F4:1 A4:1 C5:2 A4:1 F4:1 G4:1 A4:2 G4:1 F4:3",
    ),
  },
  {
    ...i,
    id: "holy-holy-holy",
    title: "Santo, Santo, Santo",
    originalTitle: "Holy, Holy, Holy — Nicaea",
    composer: "John Bacchus Dykes",
    category: "hymn",
    difficulty: 2,
    bpm: 84,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "D4:1 F#4:1 A4:1 D5:2 C#5:1 B4:1 A4:2 F#4:1 G4:1 A4:2 D4:1 E4:1 F#4:3 A4:1 B4:1 C#5:1 D5:2 A4:1 B4:1 C#5:2 B4:1 A4:1 G4:2 F#4:1 E4:1 D4:3",
    ),
  },
  {
    ...i,
    id: "blessed-assurance",
    title: "Que Segurança",
    originalTitle: "Blessed Assurance",
    composer: "Phoebe P. Knapp",
    category: "hymn",
    difficulty: 2,
    bpm: 92,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "A4:1 F#4:1 D4:1 F#4:1 A4:2 B4:1 A4:1 F#4:2 E4:1 D4:1 E4:2 F#4:1 A4:1 B4:2 A4:1 F#4:1 D5:2 C#5:1 B4:1 A4:2 F#4:1 E4:1 D4:3",
    ),
  },
  {
    ...i,
    id: "jesus-loves-me",
    title: "Sim, Jesus Me Ama",
    originalTitle: "Jesus Loves Me",
    composer: "William B. Bradbury",
    category: "hymn",
    difficulty: 1,
    bpm: 88,
    key: "C",
    clef: "treble",
    notes: parseSequence(
      "G4:1 E4:1 E4:1 D4:1 E4:1 G4:1 G4:2 A4:1 A4:1 C5:1 A4:1 A4:1 G4:3 G4:1 E4:1 E4:1 D4:1 E4:1 G4:1 G4:2 A4:1 G4:1 E4:1 C4:3",
    ),
  },
  {
    ...i,
    id: "rock-of-ages",
    title: "Rocha Eterna",
    originalTitle: "Rock of Ages — Toplady",
    composer: "Thomas Hastings",
    category: "hymn",
    difficulty: 2,
    bpm: 72,
    key: "Bb",
    clef: "treble",
    notes: parseSequence(
      "F4:1 Bb4:2 A4:1 G4:2 F4:1 Eb4:1 D4:2 F4:1 Bb4:1 C5:2 Bb4:1 A4:1 G4:3 F4:1 Bb4:2 A4:1 G4:2 F4:1 Eb4:1 D4:2 F4:1 Eb4:1 D4:2 Bb3:3",
    ),
  },
  {
    ...i,
    id: "abide-with-me",
    title: "Fica Comigo",
    originalTitle: "Abide with Me — Eventide",
    composer: "William Henry Monk",
    category: "hymn",
    difficulty: 3,
    bpm: 64,
    key: "Eb",
    clef: "treble",
    notes: parseSequence(
      "Eb4:2 G4:1 Bb4:1 Ab4:2 G4:2 F4:2 Eb4:2 Bb4:2 C5:1 Bb4:1 Ab4:2 G4:2 F4:4 Eb4:2 G4:1 Bb4:1 C5:2 Bb4:2 Ab4:2 G4:2 F4:2 Eb4:4",
    ),
  },
  {
    ...i,
    id: "all-hail-power",
    title: "Saudai o Nome de Jesus",
    originalTitle: "All Hail the Power of Jesus’ Name — Coronation",
    composer: "Oliver Holden",
    category: "hymn",
    difficulty: 3,
    bpm: 94,
    key: "G",
    clef: "treble",
    notes: parseSequence(
      "G4:1 B4:1 D5:2 D5:1 C5:1 B4:2 A4:1 G4:1 A4:1 B4:1 C5:2 B4:1 A4:1 G4:3 D5:1 D5:1 E5:1 D5:1 C5:1 B4:1 A4:2 G4:1 A4:1 B4:1 C5:1 B4:1 A4:1 G4:3",
    ),
  },
  {
    ...i,
    id: "crown-him",
    title: "Coroai-o Rei dos Reis",
    originalTitle: "Crown Him with Many Crowns — Diademata",
    composer: "George J. Elvey",
    category: "hymn",
    difficulty: 3,
    bpm: 96,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "D4:1 F#4:1 A4:1 D5:1 C#5:1 B4:1 A4:2 F#4:1 G4:1 A4:1 B4:1 A4:1 G4:1 F#4:2 A4:1 B4:1 C#5:1 D5:1 A4:1 B4:1 C#5:2 B4:1 A4:1 G4:1 F#4:1 E4:1 D4:3",
    ),
  },
  {
    ...i,
    id: "it-is-well",
    title: "Sou Feliz com Jesus",
    originalTitle: "It Is Well with My Soul — Ville du Havre",
    composer: "Philip P. Bliss",
    category: "hymn",
    difficulty: 3,
    bpm: 72,
    key: "C",
    clef: "treble",
    notes: parseSequence(
      "E4:1 G4:1 C5:2 B4:1 A4:1 G4:2 E4:1 F4:1 G4:2 C4:1 D4:1 E4:3 E4:1 G4:1 C5:2 D5:1 C5:1 B4:2 A4:1 G4:1 F4:2 E4:1 D4:1 C4:3",
    ),
  },
  {
    ...i,
    id: "come-thou-fount",
    title: "Fonte de Toda Bênção",
    originalTitle: "Come Thou Fount — Nettleton",
    composer: "Melodia americana tradicional",
    category: "hymn",
    difficulty: 2,
    bpm: 88,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "A4:1 F#4:1 D4:1 F#4:1 A4:1 B4:1 A4:2 F#4:1 E4:1 D4:1 E4:1 F#4:2 E4:2 A4:1 F#4:1 D4:1 F#4:1 A4:1 B4:1 D5:2 C#5:1 B4:1 A4:1 F#4:1 E4:1 D4:3",
    ),
  },
  {
    ...i,
    id: "old-hundredth",
    title: "Doxologia",
    originalTitle: "Old Hundredth",
    composer: "Louis Bourgeois",
    category: "hymn",
    difficulty: 1,
    bpm: 84,
    key: "G",
    clef: "treble",
    notes: parseSequence(
      "G4:1 G4:1 A4:1 B4:1 G4:2 B4:1 A4:1 D5:2 C5:1 B4:1 A4:2 G4:2 G4:1 A4:1 B4:1 C5:1 B4:2 A4:1 G4:1 F#4:2 G4:4",
    ),
  },
  {
    ...i,
    id: "mighty-fortress",
    title: "Castelo Forte",
    originalTitle: "A Mighty Fortress Is Our God",
    composer: "Martin Luther",
    category: "hymn",
    difficulty: 3,
    bpm: 98,
    key: "C",
    clef: "treble",
    notes: parseSequence(
      "C4:1 E4:1 G4:2 C5:1 B4:1 A4:2 G4:1 F4:1 E4:1 D4:1 C4:2 G4:2 C5:1 B4:1 A4:1 G4:1 F4:1 E4:1 D4:2 C4:4",
    ),
  },
  {
    ...i,
    id: "just-as-i-am",
    title: "Tal Qual Estou",
    originalTitle: "Just as I Am — Woodworth",
    composer: "William B. Bradbury",
    category: "hymn",
    difficulty: 2,
    bpm: 68,
    key: "D",
    clef: "treble",
    notes: parseSequence(
      "F#4:1 E4:1 D4:2 A4:1 F#4:1 E4:2 D4:1 E4:1 F#4:1 A4:1 B4:2 A4:2 F#4:1 E4:1 D4:2 A4:1 F#4:1 E4:2 D4:1 E4:1 F#4:1 E4:1 D4:4",
    ),
  },
  {
    ...i,
    id: "exercise-c-position",
    title: "Posição de Dó — mão direita",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 1,
    bpm: 64,
    key: "C",
    clef: "treble",
    notes: parseSequence("C4 D4 E4 F4 G4 F4 E4 D4 C4:2 D4 E4 F4 G4 A4 G4 F4 E4 D4 C4:2"),
  },
  {
    ...i,
    id: "exercise-c-scale",
    title: "Escala de Dó Maior",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 1,
    bpm: 72,
    key: "C",
    clef: "treble",
    notes: parseSequence("C4@1 D4@2 E4@3 F4@1 G4@2 A4@3 B4@4 C5@5 C5@5 B4@4 A4@3 G4@2 F4@1 E4@3 D4@2 C4:2@1"),
  },
  {
    ...i,
    id: "exercise-g-scale",
    title: "Escala de Sol Maior",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 2,
    bpm: 76,
    key: "G",
    clef: "treble",
    notes: parseSequence("G4@1 A4@2 B4@3 C5@1 D5@2 E5@3 F#5@4 G5@5 G5@5 F#5@4 E5@3 D5@2 C5@1 B4@3 A4@2 G4:2@1"),
  },
  {
    ...i,
    id: "exercise-arpeggio-c",
    title: "Arpejo de Dó Maior",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 2,
    bpm: 70,
    key: "C",
    clef: "treble",
    notes: parseSequence("C4 E4 G4 C5 E5 C5 G4 E4 C4:2 E4 G4 C5 E5 G5 E5 C5 G4 E4 C4:2"),
  },
  {
    ...i,
    id: "exercise-thirds",
    title: "Terças em Dó Maior",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 3,
    bpm: 68,
    key: "C",
    clef: "treble",
    notes: parseSequence(
      "C4 E4 D4 F4 E4 G4 F4 A4 G4 B4 A4 C5 B4 D5 C5 E5 C5 A4 B4 G4 A4 F4 G4 E4 F4 D4 E4 C4",
    ),
  },
  {
    ...i,
    id: "exercise-chromatic",
    title: "Cromatismo inicial",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 3,
    bpm: 60,
    key: "C",
    clef: "treble",
    notes: parseSequence(
      "C4 C#4 D4 D#4 E4 F4 F#4 G4 G#4 A4 A#4 B4 C5 B4 A#4 A4 G#4 G4 F#4 F4 E4 D#4 D4 C#4 C4:2",
    ),
  },
  {
    ...i,
    id: "exercise-leaps",
    title: "Saltos e orientação",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 3,
    bpm: 66,
    key: "C",
    clef: "treble",
    notes: parseSequence("C4 G4 D4 A4 E4 B4 F4 C5 G4 D5 A4 E5 G4 C5 F4 B4 E4 A4 D4 G4 C4:2"),
  },
  {
    ...i,
    id: "exercise-sight-reading",
    title: "Leitura à primeira vista",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 4,
    bpm: 72,
    key: "F",
    clef: "treble",
    notes: parseSequence("F4 A4 G4 C5 Bb4 A4 G4 F4 E4 G4 Bb4 A4 F4 D4 E4 G4 C5 A4 Bb4 G4 F4:2"),
  },

  {
    ...i,
    id: "ode-to-joy-duas-maos",
    title: "Ode à Alegria — duas mãos",
    originalTitle: "Ode to Joy",
    composer: "Ludwig van Beethoven",
    category: "classical",
    difficulty: 2,
    bpm: 76,
    key: "C",
    clef: "grand",
    beatsPerBar: 4,
    notes: parseSequence(
      "C3:4+E4:1@3 E4@3 F4@4 G4@5 G3:4+G4:1@5 F4@4 E4@3 D4@2 C3:4+C4:1@1 C4@1 D4@2 E4@3 G3:4+E4:1.5@3 D4:0.5@2 D4:2@2 C3:4+E4:1@3 E4@3 F4@4 G4@5 G3:4+G4:1@5 F4@4 E4@3 D4@2 C3:4+C4:1@1 C4@1 D4@2 E4@3 G3:2+D4:1.5@2 C4:0.5@1 C3:2+C4:2@1 G3:4+D4:1@2 D4@2 E4@3 C4@1 C3:4+D4:1@2 E4:0.5@3 F4:0.5@4 E4@3 C4@1 G3:4+D4:1@2 E4:0.5@3 F4:0.5@4 E4@3 D4@2 C3:2+C4:1@1 D4@2 G3:2 C3:4+E4:1@3 E4@3 F4@4 G4@5 G3:4+G4:1@5 F4@4 E4@3 D4@2 C3:4+C4:1@1 C4@1 D4@2 E4@3 G3:2+D4:1.5@2 C4:0.5@1 C3:2+C4:2@1",
    ),
  },
  {
    ...i,
    id: "exercise-c-chords",
    title: "Acordes de Dó Maior — tríades",
    originalTitle: "Exercício técnico",
    composer: "Aula de Piano",
    category: "exercise",
    difficulty: 3,
    bpm: 60,
    key: "C",
    clef: "grand",
    beatsPerBar: 4,
    notes: parseSequence(
      "C4+E4+G4:2 C4+E4+G4:2 C4+F4+A4:2 C4+F4+A4:2 C4+E4+G4:2 C4+E4+G4:2 D4+G4+B4:2 D4+G4+B4:2 C4+E4+G4:2 C4+E4+G4:2 C4+F4+A4:2 C4+F4+A4:2 D4+G4+B4:1 D4+F4+G4:1 C4+E4+G4:2 C4+E4+G4:4",
    ),
  },
]
export const lessons = [
  {
    id: "lesson-1",
    title: "Encontrando o Dó central",
    description: "Reconheça Dó, Ré, Mi, Fá e Sol na pauta e no teclado.",
    songId: "exercise-c-position",
    minAccuracy: 65,
  },
  {
    id: "lesson-2",
    title: "Subindo e descendo",
    description: "Toque a escala de Dó mantendo os dedos próximos às teclas.",
    songId: "exercise-c-scale",
    minAccuracy: 70,
  },
  {
    id: "lesson-3",
    title: "Primeira melodia clássica",
    description: "Aplique a leitura em Ode à Alegria.",
    songId: "ode-to-joy",
    minAccuracy: 72,
  },
  {
    id: "lesson-4",
    title: "Primeiro hino",
    description: "Treine frases longas em Graça Maravilhosa.",
    songId: "amazing-grace",
    minAccuracy: 75,
  },
  {
    id: "lesson-5",
    title: "Sustenidos",
    description: "Aprenda o Fá sustenido na escala de Sol.",
    songId: "exercise-g-scale",
    minAccuracy: 76,
  },
  {
    id: "lesson-6",
    title: "Arpejos",
    description: "Desloque a mão com suavidade pelos acordes quebrados.",
    songId: "exercise-arpeggio-c",
    minAccuracy: 78,
  },
  {
    id: "lesson-7",
    title: "Leitura intermediária",
    description: "Leia saltos maiores sem procurar cada tecla.",
    songId: "exercise-leaps",
    minAccuracy: 80,
  },
  {
    id: "lesson-8",
    title: "Tema expressivo",
    description: "Pratique dinâmica e controle no início de Para Elisa.",
    songId: "fur-elise",
    minAccuracy: 82,
  },
]
export function getSong(e) {
  return catalog.find((i) => i.id === e) || catalog[0]
}
