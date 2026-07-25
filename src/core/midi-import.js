// Motor de conversão simples: lê um arquivo MIDI (.mid) e escreve o MusicXML
// equivalente, tudo dentro do aparelho — sem servidor, sem chave de API e sem
// internet. É a alternativa "sem configuração" ao OMR de PDF: quem já tem o
// MIDI da peça ganha a pauta viva (modo professor) na hora.
//
// Limite consciente: o MIDI guarda alturas e tempos, não a gravura da partitura.
// O resultado é uma transcrição rítmica quantizada — fiel para estudar, mas sem
// dedilhado, ligaduras de expressão ou separação editorial de vozes.

const DIVISIONS = 4; // unidades por semínima → resolução de semicolcheia
const PERCUSSION_CHANNEL = 9;
const MIDDLE_C = 60; // fronteira entre a pauta de sol e a de fá

// Valores de duração padrão, do maior para o menor, para quebrar durações
// quebradas em notas ligadas que o MusicXML sabe representar.
const NOTE_VALUES = [
  { units: 4 * DIVISIONS, type: "whole", dots: 0 },
  { units: 3 * DIVISIONS, type: "half", dots: 1 },
  { units: 2 * DIVISIONS, type: "half", dots: 0 },
  { units: 1.5 * DIVISIONS, type: "quarter", dots: 1 },
  { units: DIVISIONS, type: "quarter", dots: 0 },
  { units: 0.75 * DIVISIONS, type: "eighth", dots: 1 },
  { units: 0.5 * DIVISIONS, type: "eighth", dots: 0 },
  { units: 0.25 * DIVISIONS, type: "16th", dots: 0 },
];

const SHARP_NAMES = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
  ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
];
const FLAT_NAMES = [
  ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
  ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0],
];

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error("Não foi possível ler o arquivo MIDI.");
}

function readUint32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

// Inteiro de tamanho variável do MIDI: sete bits por byte, o oitavo indica
// continuação.
function readVarInt(bytes, at) {
  let value = 0;
  let cursor = at;
  for (let step = 0; step < 4; step += 1) {
    if (cursor >= bytes.length) throw new Error("Arquivo MIDI incompleto.");
    const byte = bytes[cursor];
    cursor += 1;
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return { value, next: cursor };
  }
  throw new Error("Arquivo MIDI com marcação de tempo inválida.");
}

// Lê a trilha e devolve as notas (em ticks) e os metadados de tempo/compasso.
function readTrack(bytes, start, end, collected) {
  let cursor = start;
  let tick = 0;
  let status = 0;
  const open = new Map(); // "canal:nota" → ticks de início ainda sem note-off

  while (cursor < end) {
    const delta = readVarInt(bytes, cursor);
    tick += delta.value;
    cursor = delta.next;
    if (cursor >= end) break;

    let byte = bytes[cursor];
    if (byte & 0x80) {
      status = byte;
      cursor += 1;
    } else if (!status) {
      throw new Error("Arquivo MIDI com evento fora de ordem.");
    }

    if (status === 0xff) {
      const type = bytes[cursor];
      cursor += 1;
      const length = readVarInt(bytes, cursor);
      const dataAt = length.next;
      cursor = dataAt + length.value;
      if (type === 0x51 && length.value === 3 && collected.tempoTick === null) {
        const micros = (bytes[dataAt] << 16) | (bytes[dataAt + 1] << 8) | bytes[dataAt + 2];
        if (micros > 0) {
          collected.bpm = Math.round(60000000 / micros);
          collected.tempoTick = tick;
        }
      } else if (type === 0x58 && length.value >= 2 && !collected.timeSignature) {
        collected.timeSignature = {
          numerator: bytes[dataAt] || 4,
          denominator: 2 ** bytes[dataAt + 1] || 4,
        };
      } else if (type === 0x59 && length.value >= 2 && collected.keyFifths === null) {
        const raw = bytes[dataAt];
        collected.keyFifths = raw > 127 ? raw - 256 : raw;
        collected.keyMode = bytes[dataAt + 1] ? "minor" : "major";
      } else if (type === 0x03 && length.value > 0 && !collected.trackName) {
        collected.trackName = new TextDecoder()
          .decode(bytes.subarray(dataAt, dataAt + length.value))
          .trim();
      }
      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      const length = readVarInt(bytes, cursor);
      cursor = length.next + length.value;
      continue;
    }

    const command = status & 0xf0;
    const channel = status & 0x0f;

    if (command === 0x90 || command === 0x80) {
      const note = bytes[cursor];
      const velocity = bytes[cursor + 1];
      cursor += 2;
      if (channel === PERCUSSION_CHANNEL) {
        collected.hadPercussion = true;
        continue;
      }
      const key = `${channel}:${note}`;
      if (command === 0x90 && velocity > 0) {
        const stack = open.get(key) || [];
        stack.push(tick);
        open.set(key, stack);
      } else {
        const stack = open.get(key);
        const startTick = stack?.pop();
        if (startTick !== undefined && tick > startTick) {
          collected.notes.push({ start: startTick, end: tick, midi: note });
        }
      }
      continue;
    }

    // Demais eventos de canal: dois bytes de dados, salvo programa e pressão.
    cursor += command === 0xc0 || command === 0xd0 ? 1 : 2;
  }
}

// Lê o arquivo MIDI inteiro e devolve as notas em ticks com os metadados.
export function parseMidiFile(input) {
  const bytes = toBytes(input);
  if (bytes.length < 14) throw new Error("Arquivo MIDI vazio ou incompleto.");
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "MThd") {
    throw new Error("Isso não parece um arquivo MIDI (.mid).");
  }

  const division = (bytes[12] << 8) | bytes[13];
  if (division & 0x8000) {
    throw new Error("Este MIDI usa marcação SMPTE; exporte-o em ticks por semínima.");
  }
  if (!division) throw new Error("Arquivo MIDI sem resolução de tempo.");

  const collected = {
    notes: [],
    bpm: 0,
    tempoTick: null,
    timeSignature: null,
    keyFifths: null,
    keyMode: "major",
    trackName: "",
    hadPercussion: false,
  };

  let cursor = 8 + readUint32(bytes, 4);
  while (cursor + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[cursor], bytes[cursor + 1], bytes[cursor + 2], bytes[cursor + 3]);
    const length = readUint32(bytes, cursor + 4);
    const start = cursor + 8;
    const end = Math.min(start + length, bytes.length);
    if (id === "MTrk") readTrack(bytes, start, end, collected);
    cursor = start + length;
  }

  if (!collected.notes.length) {
    throw new Error("Nenhuma nota tocável foi encontrada neste MIDI.");
  }

  collected.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return {
    division,
    bpm: collected.bpm || 0,
    timeSignature: collected.timeSignature || { numerator: 4, denominator: 4 },
    keyFifths: collected.keyFifths ?? 0,
    keyMode: collected.keyMode,
    trackName: collected.trackName,
    hadPercussion: collected.hadPercussion,
    notes: collected.notes,
  };
}

// Converte a altura MIDI em passo/alteração/oitava, seguindo a armadura.
export function midiToPitch(midi, preferFlats = false) {
  const table = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  const [step, alter] = table[((midi % 12) + 12) % 12];
  // Em bemóis, Db/Eb/Gb/Ab/Bb sobem de nome sem trocar de oitava; a oitava
  // continua sendo a do dó imediatamente abaixo.
  const octave = Math.floor(midi / 12) - 1;
  return { step, alter, octave };
}

// Quebra uma duração qualquer nos valores que a notação sabe escrever.
export function splitDuration(units) {
  const parts = [];
  let left = units;
  while (left > 0) {
    const value = NOTE_VALUES.find((candidate) => candidate.units <= left);
    if (!value) {
      if (parts.length) break;
      return [NOTE_VALUES[NOTE_VALUES.length - 1]];
    }
    parts.push(value);
    left -= value.units;
  }
  return parts;
}

function escapeXml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function quantize(ticks, division) {
  const units = (ticks / division) * DIVISIONS;
  return Math.round(units);
}

// Agrupa as notas quantizadas em ataques: o que soa junto vira um acorde só,
// e o modo professor recebe um evento por ataque.
function toAttacks(notes, division) {
  const groups = new Map();
  for (const note of notes) {
    const start = quantize(note.start, division);
    const end = Math.max(start + 1, quantize(note.end, division));
    const group = groups.get(start) || { start, duration: 0, midis: new Set() };
    group.duration = Math.max(group.duration, end - start);
    group.midis.add(note.midi);
    groups.set(start, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.start - b.start)
    .map((attack) => ({ ...attack, midis: [...attack.midis].sort((a, b) => a - b) }));
}

// Encurta cada ataque para caber até o próximo da mesma pauta. Feito por pauta,
// e não na peça inteira, uma nota longa da mão esquerda não é cortada por uma
// nota curta da direita.
function clipToNextAttack(attacks) {
  return attacks.map((attack, index) => {
    const next = attacks[index + 1];
    const room = next ? next.start - attack.start : attack.duration;
    return { ...attack, duration: Math.max(1, Math.min(attack.duration, room)) };
  });
}

function noteXml({ midi, preferFlats, isChord, chunk, tie, staff, voice }) {
  const lines = ["      <note>"];
  if (isChord) lines.push("        <chord/>");
  if (midi === null) {
    lines.push("        <rest/>");
  } else {
    const { step, alter, octave } = midiToPitch(midi, preferFlats);
    lines.push("        <pitch>");
    lines.push(`          <step>${step}</step>`);
    if (alter) lines.push(`          <alter>${alter}</alter>`);
    lines.push(`          <octave>${octave}</octave>`);
    lines.push("        </pitch>");
  }
  lines.push(`        <duration>${chunk.units}</duration>`);
  if (tie?.stop) lines.push('        <tie type="stop"/>');
  if (tie?.start) lines.push('        <tie type="start"/>');
  lines.push(`        <voice>${voice}</voice>`);
  lines.push(`        <type>${chunk.type}</type>`);
  for (let dot = 0; dot < chunk.dots; dot += 1) lines.push("        <dot/>");
  if (staff) lines.push(`        <staff>${staff}</staff>`);
  if (tie?.stop) lines.push('        <notations><tied type="stop"/></notations>');
  if (tie?.start) lines.push('        <notations><tied type="start"/></notations>');
  lines.push("      </note>");
  return lines;
}

// Escreve uma linha melódica compasso a compasso: preenche o silêncio com
// pausas, corta o que atravessa a barra e liga as partes cortadas.
function renderStream(rawAttacks, { measureUnits, totalUnits, preferFlats, staff, voice }) {
  const attacks = clipToNextAttack(rawAttacks);
  const measures = [];
  let current = [];
  let cursor = 0;

  const closeMeasure = () => {
    measures.push(current);
    current = [];
  };

  const emit = (units, render) => {
    let left = units;
    let continuing = false;
    while (left > 0) {
      const room = measureUnits - (cursor % measureUnits);
      for (const chunk of splitDuration(Math.min(left, room))) {
        const isLast = left - chunk.units <= 0;
        current.push(...render(chunk, { stop: continuing, start: !isLast }));
        continuing = true;
        cursor += chunk.units;
        left -= chunk.units;
        if (cursor % measureUnits === 0) closeMeasure();
      }
    }
  };

  for (const attack of attacks) {
    if (attack.start > cursor) {
      emit(attack.start - cursor, (chunk) => noteXml({ midi: null, chunk, staff, voice }));
    }
    emit(attack.duration, (chunk, tie) =>
      attack.midis.flatMap((midi, index) =>
        noteXml({ midi, preferFlats, isChord: index > 0, chunk, tie, staff, voice }),
      ),
    );
  }

  if (totalUnits > cursor) {
    emit(totalUnits - cursor, (chunk) => noteXml({ midi: null, chunk, staff, voice }));
  }
  return measures;
}

// Escreve o MusicXML completo. Quando a peça usa os dois registros, monta a
// pauta dupla do piano (sol e fá); com um registro só, uma pauta basta.
function buildMusicXml({ attacks, title, composer, timeSignature, keyFifths, keyMode, bpm }) {
  const measureUnits = Math.max(
    1,
    Math.round(timeSignature.numerator * (4 / timeSignature.denominator) * DIVISIONS),
  );
  const preferFlats = keyFifths < 0;
  const end = attacks.reduce((last, attack) => Math.max(last, attack.start + attack.duration), 0);
  const totalUnits = Math.max(measureUnits, Math.ceil(end / measureUnits) * measureUnits);

  const split = (keep) =>
    attacks
      .map((attack) => ({ ...attack, midis: attack.midis.filter(keep) }))
      .filter((attack) => attack.midis.length);
  const upper = split((midi) => midi >= MIDDLE_C);
  const lower = split((midi) => midi < MIDDLE_C);
  const grandStaff = Boolean(upper.length && lower.length);

  let streams;
  let clefs;
  if (grandStaff) {
    streams = [
      renderStream(upper, { measureUnits, totalUnits, preferFlats, staff: 1, voice: 1 }),
      renderStream(lower, { measureUnits, totalUnits, preferFlats, staff: 2, voice: 2 }),
    ];
    clefs = [
      '        <clef number="1"><sign>G</sign><line>2</line></clef>',
      '        <clef number="2"><sign>F</sign><line>4</line></clef>',
    ];
  } else {
    streams = [renderStream(attacks, { measureUnits, totalUnits, preferFlats, staff: 0, voice: 1 })];
    clefs = [
      upper.length
        ? "        <clef><sign>G</sign><line>2</line></clef>"
        : "        <clef><sign>F</sign><line>4</line></clef>",
    ];
  }

  const body = streams[0]
    .map((lines, index) => {
      const header = [`    <measure number="${index + 1}">`];
      if (index === 0) {
        header.push("      <attributes>");
        header.push(`        <divisions>${DIVISIONS}</divisions>`);
        header.push(`        <key><fifths>${keyFifths}</fifths><mode>${keyMode}</mode></key>`);
        header.push(
          `        <time><beats>${timeSignature.numerator}</beats><beat-type>${timeSignature.denominator}</beat-type></time>`,
        );
        if (grandStaff) header.push("        <staves>2</staves>");
        header.push(...clefs);
        header.push("      </attributes>");
        if (bpm) {
          header.push(`      <direction placement="above"><sound tempo="${bpm}"/></direction>`);
        }
      }
      const second = grandStaff
        ? [`      <backup><duration>${measureUnits}</duration></backup>`, ...streams[1][index]]
        : [];
      return [...header, ...lines, ...second, "    </measure>"].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    "  <work>",
    `    <work-title>${escapeXml(title)}</work-title>`,
    "  </work>",
    "  <identification>",
    `    <creator type="composer">${escapeXml(composer)}</creator>`,
    "    <encoding><software>Partitura Viva — importação de MIDI</software></encoding>",
    "  </identification>",
    "  <part-list>",
    '    <score-part id="P1"><part-name>Piano</part-name></score-part>',
    "  </part-list>",
    '  <part id="P1">',
    body,
    "  </part>",
    "</score-partwise>",
    "",
  ].join("\n");
}

// Ponto de entrada: recebe os bytes do .mid e devolve o MusicXML pronto para
// salvar, junto com o que descobriu (andamento, compasso, nº de notas).
export function midiToMusicXml(input, { title = "", composer = "" } = {}) {
  const midi = parseMidiFile(input);
  const attacks = toAttacks(midi.notes, midi.division);
  if (!attacks.length) throw new Error("Nenhuma nota tocável foi encontrada neste MIDI.");

  const warnings = [];
  if (midi.hadPercussion) warnings.push("A trilha de percussão (canal 10) foi ignorada.");
  if (midi.notes.length > attacks.length * 3) {
    warnings.push("Vozes sobrepostas foram reunidas em acordes.");
  }

  const bpm = midi.bpm || 0;
  const timeSignature = midi.timeSignature;
  const xml = buildMusicXml({
    attacks,
    title: title.trim() || midi.trackName || "Peça importada",
    composer: composer.trim(),
    timeSignature,
    keyFifths: midi.keyFifths,
    keyMode: midi.keyMode,
    bpm,
  });

  return {
    xml,
    bpm,
    timeSignature: `${timeSignature.numerator}/${timeSignature.denominator}`,
    noteCount: attacks.length,
    // Só o que o arquivo realmente declarou — para não preencher o formulário
    // com o título genérico de reserva.
    detectedTitle: midi.trackName,
    warnings,
  };
}
