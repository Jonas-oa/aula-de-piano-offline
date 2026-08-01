import { beatsPerBarFromSignature, noteToMidi } from "../core/music.js";

const EPSILON = 1e-7;

export const READING_LEVELS = [
  { id: 0, name: "Primeiro contato" },
  { id: 1, name: "Notas de referência" },
  { id: 2, name: "Cinco dedos" },
  { id: 3, name: "Leitura básica" },
  { id: 4, name: "Duas mãos" },
  { id: 5, name: "Expansão" },
  { id: 6, name: "Intermediário" },
  { id: 7, name: "Avançado" },
  { id: 8, name: "Desafio" },
];

export const READING_SKILLS = [
  "Notas e teclado",
  "Intervalos e padrões",
  "Ritmo e fluência",
  "Duas mãos e acordes",
  "Compassos e tonalidades",
];

export function readingLevelName(level) {
  return READING_LEVELS.find(({ id }) => id === Number(level))?.name || `Nível ${level}`;
}

// Pequena linguagem de dados para que cada exercício continue auditável:
// C4/1 é uma nota de um tempo, C3+E4+G4/2 é um acorde de dois tempos e R/1
// é uma pausa. Os tempos são sempre medidos em semínimas, como no MusicXML.
export function parseReadingPattern(pattern, {
  repeats = 1,
  beatsPerBar = 4,
} = {}) {
  const events = [];
  const rests = [];
  let beat = 0;

  for (let repetition = 0; repetition < repeats; repetition += 1) {
    for (const token of pattern.trim().split(/\s+/)) {
      const [pitchSpec, durationSpec = "1"] = token.split("/");
      const duration = Number(durationSpec);
      if (!(duration > 0)) throw new Error(`Duração inválida em ${token}`);

      const measureIndex = Math.floor((beat + EPSILON) / beatsPerBar);
      if (pitchSpec === "R") {
        rests.push({ beat, duration, staff: 1, measureIndex, measureNumber: measureIndex + 1 });
        beat += duration;
        continue;
      }

      const pitches = pitchSpec.split("+");
      const notes = pitches.map((pitch) => {
        const midi = noteToMidi(pitch);
        return {
          pitch,
          midi,
          staff: midi < 60 ? 2 : 1,
          clef: midi < 60 ? "bass" : "treble",
          finger: null,
          duration,
        };
      });
      events.push({
        beat,
        duration,
        pitches,
        midis: notes.map(({ midi }) => midi),
        notes,
        measureIndex,
        measureNumber: measureIndex + 1,
      });
      beat += duration;
    }
  }

  return { events, rests, totalBeats: beat };
}

function buildMeasures(totalBeats, beatsPerBar, timeSignature) {
  const exactCount = totalBeats / beatsPerBar;
  const count = Math.round(exactCount);
  if (Math.abs(exactCount - count) > EPSILON) {
    throw new Error(`Exercício não fecha o compasso ${timeSignature}: ${totalBeats} tempos`);
  }
  return Array.from({ length: count }, (_, index) => ({
    index,
    number: String(index + 1),
    beat: index * beatsPerBar,
    duration: beatsPerBar,
    timeSignature,
  }));
}

const definitions = [
  // Nível 0 — orientação pelas três notas de referência e pelo movimento visual.
  [0, "do-central", "Encontre o Dó central", "Notas e teclado", 52, "4/4", "Dó maior", 0,
    "Reconheça o Dó central e as duas notas vizinhas.", "C4/1 D4/1 C4/1 E4/1", 2],
  [0, "sol-referencia", "A clave de Sol", "Notas e teclado", 52, "4/4", "Dó maior", 0,
    "Use o Sol como ponto de referência na pauta superior.", "G4/1 A4/1 G4/1 F4/1", 2],
  [0, "fa-referencia", "A clave de Fá", "Notas e teclado", 52, "4/4", "Dó maior", 0,
    "Use o Fá como ponto de referência na pauta inferior.", "F3/1 G3/1 F3/1 E3/1", 2],
  [0, "direcao", "Subiu, desceu ou repetiu?", "Intervalos e padrões", 54, "4/4", "Dó maior", 0,
    "Leia a direção do desenho antes de procurar cada tecla.", "C4/1 E4/1 E4/1 D4/1", 2],

  // Nível 1 — posições fixas, passos, saltos e alternância entre pautas.
  [1, "cinco-notas-direita", "Cinco notas — mão direita", "Notas e teclado", 56, "4/4", "Dó maior", 0,
    "Leia Dó–Sol sem retirar a mão da posição.", "C4/1 D4/1 E4/1 F4/1 G4/2 E4/1 C4/1", 2],
  [1, "cinco-notas-esquerda", "Cinco notas — mão esquerda", "Notas e teclado", 56, "4/4", "Dó maior", 0,
    "Leia Dó–Sol na clave de Fá com posição estável.", "C3/1 D3/1 E3/1 F3/1 G3/2 E3/1 C3/1", 2],
  [1, "passos-e-saltos", "Passos e saltos", "Intervalos e padrões", 58, "4/4", "Dó maior", 0,
    "Diferencie notas vizinhas de saltos de terça.", "C4/1 D4/1 F4/1 E4/1 G4/1 E4/1 D4/1 C4/1", 2],
  [1, "pautas-alternadas", "Alterne as duas pautas", "Ritmo e fluência", 56, "4/4", "Dó maior", 0,
    "Mude o olhar entre clave de Fá e clave de Sol sem interromper o pulso.", "C3/1 C4/1 D3/1 D4/1 E3/1 E4/1 F3/1 F4/1", 2],

  // Nível 2 — cinco dedos, pausas e durações diferentes.
  [2, "movimento-paralelo", "Cinco dedos em movimento paralelo", "Duas mãos e acordes", 60, "4/4", "Dó maior", 0,
    "Toque as duas mãos juntas mantendo a mesma direção.", "C3+C4/1 D3+D4/1 E3+E4/1 F3+F4/1 G3+G4/1 F3+F4/1 E3+E4/1 D3+D4/1", 2],
  [2, "re-menor", "Primeiros passos em Ré menor", "Compassos e tonalidades", 60, "4/4", "Ré menor", -1,
    "Leia a posição de Ré menor e reconheça o Si bemol.", "D3+D4/1 E3+E4/1 F3+F4/1 G3+G4/1 A3+A4/1 Bb3+Bb4/1 A3+A4/1 G3+G4/1", 2],
  [2, "pausas", "Leia também o silêncio", "Ritmo e fluência", 58, "4/4", "Dó maior", 0,
    "Mantenha a contagem durante as pausas de semínima.", "C4/1 D4/1 R/1 E4/1 F4/1 R/1 G4/1 E4/1", 2],
  [2, "notas-longas", "Notas curtas e longas", "Ritmo e fluência", 58, "4/4", "Dó maior", 0,
    "Diferencie mínimas, semínimas e colcheias sem perder o pulso.", "C4/2 D4/1 E4/1 F4/.5 G4/.5 A4/1 G4/2", 2],

  // Nível 3 — novas tonalidades, 3/4 e figuras pontuadas.
  [3, "sol-maior", "Sol maior e o Fá sustenido", "Compassos e tonalidades", 64, "4/4", "Sol maior", 1,
    "Reconheça a armadura de Sol maior durante a leitura.", "G3+G4/1 A3+A4/1 B3+B4/1 C4+C5/1 D4+D5/1 C4+C5/1 B3+B4/1 A3+A4/1", 2],
  [3, "fa-maior", "Fá maior e o Si bemol", "Compassos e tonalidades", 62, "3/4", "Fá maior", -1,
    "Leia o Si bemol sem tratá-lo como acidente isolado.", "F3+F4/1 G3+G4/1 A3+A4/1 Bb3+Bb4/1 A3+A4/1 G3+G4/1", 2],
  [3, "valsa-leitura", "Valsa de leitura", "Duas mãos e acordes", 66, "3/4", "Dó maior", 0,
    "Sinta o primeiro tempo forte em cada compasso.", "C3+C4+E4/1 G3+E4+G4/1 G3+E4+G4/1 F3+C4+F4/1 C3+C4+E4/1 G3+B3+D4/1", 2],
  [3, "pontuadas", "Figuras pontuadas", "Ritmo e fluência", 60, "3/4", "Dó maior", 0,
    "Combine mínima pontuada, semínima pontuada e colcheia.", "C4/1.5 D4/.5 E4/1 F4/1.5 E4/.5 D4/1", 2],

  // Nível 4 — independência, acordes e mudança de posição.
  [4, "re-maior", "Ré maior em duas mãos", "Compassos e tonalidades", 68, "4/4", "Ré maior", 2,
    "Leia Fá e Dó sustenidos dentro de uma textura a duas mãos.", "D3+D4/1 A3+F#4/1 D3+A4/1 A3+F#4/1 G3+G4/1 D4+B4/1 A3+C#5/1 D3+D5/1", 2],
  [4, "contrario", "Movimento contrário", "Intervalos e padrões", 64, "4/4", "Dó maior", 0,
    "Acompanhe duas linhas que se afastam e voltam ao centro.", "C3+C5/1 D3+B4/1 E3+A4/1 F3+G4/1 G3+F4/1 F3+G4/1 E3+A4/1 D3+B4/1", 2],
  [4, "tercas", "Terças em blocos", "Duas mãos e acordes", 66, "4/4", "Dó maior", 0,
    "Leia cada terça como um único desenho, não como duas notas soltas.", "C3+E3+C4+E4/1 D3+F3+D4+F4/1 E3+G3+E4+G4/1 F3+A3+F4+A4/1 G3+B3+G4+B4/2 E3+G3+E4+G4/1 C3+E3+C4+E4/1", 2],
  [4, "sustentacao", "Sustente uma mão, mova a outra", "Duas mãos e acordes", 62, "4/4", "Dó maior", 0,
    "Mantenha baixos longos enquanto a mão direita muda de nota.", "C3+C4/2 D4/1 E4/1 F3+F4/2 G4/1 A4/1 G3+B4/2 A4/1 G4/1 C3+E4/2 D4/1 C4/1", 2],

  // Nível 5 — compassos compostos, cromatismo e extensão do teclado.
  [5, "seis-por-oito", "Fluxo em 6/8", "Ritmo e fluência", 72, "6/8", "Sol maior", 1,
    "Agrupe as seis colcheias em dois pulsos grandes.", "G3+G4/.5 B3+B4/.5 D4+D5/.5 B3+B4/.5 A3+C5/.5 G3+B4/.5", 4],
  [5, "cromatica", "Escada cromática", "Intervalos e padrões", 68, "4/4", "Dó maior", 0,
    "Leia sustenidos e bemóis como movimento de semitom.", "C4/.5 C#4/.5 D4/.5 Eb4/.5 E4/.5 F4/.5 F#4/.5 G4/.5", 4],
  [5, "arpejos-amplos", "Arpejos além dos cinco dedos", "Intervalos e padrões", 70, "4/4", "Dó maior", 0,
    "Antecipe saltos de terça e de quarta em toda a pauta dupla.", "C3/.5 G3/.5 C4/.5 E4/.5 G4/.5 C5/.5 G4/.5 E4/.5", 4],
  [5, "mudancas-posicao", "Mudanças de posição", "Notas e teclado", 66, "4/4", "Dó maior", 0,
    "Desloque as mãos sem olhar continuamente para o teclado.", "C3+C4/1 E3+E4/1 G3+G4/1 C4+C5/1 D3+D4/1 F3+F4/1 A3+A4/1 D4+D5/1", 2],

  // Nível 6 — tonalidades mais densas, síncope e acordes completos.
  [6, "mi-maior", "Mi maior em movimento", "Compassos e tonalidades", 76, "4/4", "Mi maior", 4,
    "Leia uma armadura de quatro sustenidos sem interromper o fluxo.", "E3+E4/1 F#3+F#4/1 G#3+G#4/1 A3+A4/1 B3+B4/1 C#4+C#5/1 D#4+D#5/1 E4+E5/1", 2],
  [6, "la-bemol", "Cores de Lá bemol maior", "Compassos e tonalidades", 72, "4/4", "Lá bemol maior", -4,
    "Reconheça os quatro bemóis como parte da tonalidade.", "Ab3+Ab4/1 Bb3+Bb4/1 C4+C5/1 Db4+Db5/1 Eb4+Eb5/1 Db4+Db5/1 C4+C5/1 Bb3+Bb4/1", 2],
  [6, "sincopes", "Síncopes entre as mãos", "Ritmo e fluência", 76, "4/4", "Dó menor", -3,
    "Mantenha a pulsação quando os acordes aparecem no contratempo.", "C3/.5 Eb4+G4+Bb4/.5 G3/.5 Eb4+Ab4+C5/.5 Ab2/.5 C4+Eb4+G4/.5 G2/.5 B3+F4+Ab4/.5", 4],
  [6, "nove-por-oito", "Arpejos em 9/8", "Duas mãos e acordes", 72, "9/8", "Mi menor", 1,
    "Organize nove colcheias em três grupos de três.", "E3/.5 B3/.5 E4/.5 G4/.5 B4/.5 G4/.5 F#4/.5 E4/.5 B3/.5", 4],

  // Nível 7 — métricas irregulares, acordes densos e cromatismo amplo.
  [7, "cinco-por-oito", "Compasso 5/8 — 3+2", "Ritmo e fluência", 82, "5/8", "Ré menor", -1,
    "Sinta cinco colcheias como um grupo de três seguido por dois.", "D3+D4/.5 A3+F4/.5 D4+A4/.5 C4+G4/.5 A3+E4/.5", 8],
  [7, "sete-por-oito", "Compasso 7/8 — 2+2+3", "Ritmo e fluência", 80, "7/8", "Mi menor", 1,
    "Mantenha a sequência 2+2+3 sem acrescentar um oitavo pulso.", "E3+E4/.5 B3+G4/.5 C4+A4/.5 B3+F#4/.5 E3+G4/.5 F#3+A4/.5 B3+B4/.5", 8],
  [7, "acordes-densos", "Acordes de seis notas", "Duas mãos e acordes", 68, "4/4", "Dó maior", 0,
    "Leia a forma harmônica inteira antes de posicionar os dedos.", "C3+E3+G3+C4+E4+G4/1 A2+C3+E3+A3+C4+E4/1 F2+A2+C3+F3+A3+C4/1 G2+B2+D3+G3+B3+D4/1", 4],
  [7, "cromatismo-amplo", "Cromatismo entre registros", "Intervalos e padrões", 78, "4/4", "Dó menor", -3,
    "Acompanhe linhas cromáticas opostas sem perder a referência tonal.", "C3+C5/.5 C#3+B4/.5 D3+Bb4/.5 Eb3+A4/.5 E3+Ab4/.5 F3+G4/.5 F#3+Gb4/.5 G3+F4/.5", 4],

  // Nível 8 — leituras longas e densas, sempre inéditas para o usuário do app.
  [8, "estudo-semicolcheias", "Estudo de semicolcheias", "Ritmo e fluência", 88, "4/4", "Lá menor", 0,
    "Leia grupos de quatro semicolcheias com movimento contínuo.", "A3/.25 B3/.25 C4/.25 E4/.25 D4/.25 C4/.25 B3/.25 A3/.25 E4/.25 F4/.25 G4/.25 B4/.25 A4/.25 G4/.25 F4/.25 E4/.25", 8],
  [8, "doze-por-oito", "Desafio em 12/8", "Compassos e tonalidades", 84, "12/8", "Mi bemol maior", -3,
    "Sustente quatro pulsações ternárias em uma textura ampla.", "Eb3/.5 Bb3/.5 Eb4/.5 G4/.5 Bb4/.5 G4/.5 F3/.5 C4/.5 F4/.5 Ab4/.5 C5/.5 Ab4/.5", 6],
  [8, "harmonia-em-movimento", "Harmonia em movimento", "Duas mãos e acordes", 76, "4/4", "Ré maior", 2,
    "Combine acordes densos, inversões e linha superior móvel.", "D3+F#3+A3+D4+F#4/1 B2+D3+F#3+B3+D4/1 G2+B2+D3+G3+B3/1 A2+C#3+E3+A3+C#4/1 D3+A3+D4+F#4+A4/1 C#3+A3+C#4+E4+A4/1 B2+F#3+B3+D4+F#4/1 A2+E3+A3+C#4+E4/1", 4],
  [8, "leitura-final", "Leitura final — fluxo completo", "Intervalos e padrões", 86, "7/8", "Sol menor", -2,
    "Una saltos, acordes, cromatismo e métrica irregular sem parar.", "G2+G4/.5 D3+Bb4/.5 G3+D5/.5 A3+C5/.5 Bb3+D5/.5 F#3+A4/.5 G3+Bb4/.5", 16],
];

export const readingExercises = definitions.map((definition, order) => {
  const [
    level,
    slug,
    title,
    skill,
    bpm,
    timeSignature,
    key,
    keyFifths,
    focus,
    pattern,
    repeats,
  ] = definition;
  const beatsPerBar = beatsPerBarFromSignature(timeSignature);
  const parsed = parseReadingPattern(pattern, { repeats, beatsPerBar });
  return {
    id: `reading-${slug}`,
    type: "reading",
    title,
    composer: "Exercício original do aplicativo",
    level,
    levelName: readingLevelName(level),
    skill,
    style: "Leitura musical",
    bpm,
    timeSignature,
    beatsPerBar,
    key,
    keyFifths,
    focus,
    events: parsed.events,
    rests: parsed.rests,
    measures: buildMeasures(parsed.totalBeats, beatsPerBar, timeSignature),
    order,
  };
});
