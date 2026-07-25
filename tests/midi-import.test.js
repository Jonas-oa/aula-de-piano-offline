import test from "node:test";
import assert from "node:assert/strict";
import { midiToMusicXml, midiToPitch, parseMidiFile, splitDuration } from "../src/core/midi-import.js";

// --- Montagem de arquivos MIDI mínimos para os testes -----------------------

function varInt(value) {
  const bytes = [value & 0x7f];
  let left = value >> 7;
  while (left > 0) {
    bytes.unshift((left & 0x7f) | 0x80);
    left >>= 7;
  }
  return bytes;
}

function chunk(id, data) {
  const length = data.length;
  return [
    ...[...id].map((character) => character.charCodeAt(0)),
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
    ...data,
  ];
}

// events: [{ delta, bytes }]
function buildMidi(events, { division = 480, extraTracks = [] } = {}) {
  const header = chunk("MThd", [0, 1, 0, 1 + extraTracks.length, (division >> 8) & 0xff, division & 0xff]);
  const track = chunk("MTrk", [
    ...events.flatMap((event) => [...varInt(event.delta), ...event.bytes]),
    ...varInt(0),
    0xff,
    0x2f,
    0x00,
  ]);
  return Uint8Array.from([...header, ...track, ...extraTracks.flat()]);
}

function note(midi, { start, length, division = 480 }) {
  return [
    { delta: start, bytes: [0x90, midi, 0x64] },
    { delta: length, bytes: [0x80, midi, 0x40] },
  ].map((event) => ({ ...event, division }));
}

// Quatro semínimas: C4 D4 E4 F4.
function scaleMidi(division = 480) {
  const events = [];
  let previousEnd = 0;
  for (const [index, pitch] of [60, 62, 64, 65].entries()) {
    const start = index * division;
    events.push({ delta: start - previousEnd, bytes: [0x90, pitch, 0x64] });
    events.push({ delta: division, bytes: [0x80, pitch, 0x40] });
    previousEnd = start + division;
  }
  return buildMidi(events, { division });
}

// --- Leitura do arquivo ----------------------------------------------------

test("lê as notas, o andamento e o compasso do arquivo MIDI", () => {
  const division = 480;
  const events = [
    { delta: 0, bytes: [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20] }, // 500000 µs → 120 bpm
    { delta: 0, bytes: [0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08] }, // 3/4
    ...note(60, { start: 0, length: division }),
  ];
  const parsed = parseMidiFile(buildMidi(events, { division }));

  assert.equal(parsed.bpm, 120);
  assert.deepEqual(parsed.timeSignature, { numerator: 3, denominator: 4 });
  assert.equal(parsed.notes.length, 1);
  assert.deepEqual(parsed.notes[0], { start: 0, end: division, midi: 60 });
});

test("entende note-on com velocidade zero como note-off", () => {
  const division = 480;
  const parsed = parseMidiFile(
    buildMidi(
      [
        { delta: 0, bytes: [0x90, 67, 0x64] },
        { delta: division, bytes: [0x90, 67, 0x00] },
      ],
      { division },
    ),
  );
  assert.equal(parsed.notes.length, 1);
  assert.equal(parsed.notes[0].end, division);
});

test("respeita o status contínuo (running status)", () => {
  const division = 480;
  const parsed = parseMidiFile(
    buildMidi(
      [
        { delta: 0, bytes: [0x90, 60, 0x64] },
        { delta: 0, bytes: [64, 0x64] }, // sem repetir o 0x90
        { delta: division, bytes: [60, 0x00] },
        { delta: 0, bytes: [64, 0x00] },
      ],
      { division },
    ),
  );
  assert.equal(parsed.notes.length, 2);
  assert.deepEqual(parsed.notes.map((item) => item.midi).sort(), [60, 64]);
});

test("ignora o canal de percussão", () => {
  const division = 480;
  const parsed = parseMidiFile(
    buildMidi(
      [
        ...note(60, { start: 0, length: division }),
        { delta: 0, bytes: [0x99, 38, 0x64] },
        { delta: division, bytes: [0x89, 38, 0x40] },
      ],
      { division },
    ),
  );
  assert.equal(parsed.notes.length, 1);
  assert.equal(parsed.hadPercussion, true);
});

test("recusa arquivos que não são MIDI", () => {
  assert.throws(() => parseMidiFile(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])), /não parece/);
});

test("recusa MIDI sem nota tocável", () => {
  assert.throws(() => parseMidiFile(buildMidi([{ delta: 0, bytes: [0xb0, 7, 100] }])), /Nenhuma nota/);
});

// --- Conversão em MusicXML -------------------------------------------------

test("converte uma escala simples em MusicXML legível pelo app", () => {
  const result = midiToMusicXml(scaleMidi(), { title: "Escala", composer: "Estudo" });

  assert.match(result.xml, /^<\?xml version="1\.0"/);
  assert.match(result.xml, /<score-partwise/);
  assert.match(result.xml, /<work-title>Escala<\/work-title>/);
  assert.match(result.xml, /<creator type="composer">Estudo<\/creator>/);
  assert.equal(result.noteCount, 4);
  assert.equal(result.timeSignature, "4/4");

  // Quatro semínimas em 4/4 ocupam exatamente um compasso.
  assert.equal(result.xml.match(/<measure number=/g).length, 1);
  assert.equal(result.xml.match(/<type>quarter<\/type>/g).length, 4);
  assert.match(result.xml, /<step>C<\/step>/);
  assert.match(result.xml, /<step>F<\/step>/);
});

test("junta notas simultâneas em um acorde", () => {
  const division = 480;
  const events = [
    { delta: 0, bytes: [0x90, 60, 0x64] },
    { delta: 0, bytes: [0x90, 64, 0x64] },
    { delta: 0, bytes: [0x90, 67, 0x64] },
    { delta: division, bytes: [0x80, 60, 0x40] },
    { delta: 0, bytes: [0x80, 64, 0x40] },
    { delta: 0, bytes: [0x80, 67, 0x40] },
  ];
  const result = midiToMusicXml(buildMidi(events, { division }));

  assert.equal(result.noteCount, 1, "um ataque só");
  assert.equal(result.xml.match(/<chord\/>/g).length, 2, "duas notas marcadas como acorde");
});

test("preenche com pausas o silêncio antes da primeira nota", () => {
  const division = 480;
  const result = midiToMusicXml(
    buildMidi(note(60, { start: 2 * division, length: division }), { division }),
  );
  assert.match(result.xml, /<rest\/>/);
  assert.equal(result.noteCount, 1);
});

test("completa o último compasso e liga o que atravessa a barra", () => {
  const division = 480;
  // Uma nota de 6 semínimas começando no tempo 0: atravessa a barra de 4/4.
  const result = midiToMusicXml(
    buildMidi(note(60, { start: 0, length: 6 * division }), { division }),
  );
  assert.match(result.xml, /<tie type="start"\/>/);
  assert.match(result.xml, /<tie type="stop"\/>/);
  assert.equal(result.xml.match(/<measure number=/g).length, 2);
});

test("monta pauta dupla quando a peça usa as duas mãos", () => {
  const division = 480;
  const events = [
    ...note(72, { start: 0, length: division }), // mão direita
    { delta: 0, bytes: [0x90, 43, 0x64] }, // mão esquerda, simultânea
    { delta: division, bytes: [0x80, 43, 0x40] },
  ];
  const result = midiToMusicXml(buildMidi(events, { division }));

  assert.match(result.xml, /<staves>2<\/staves>/);
  assert.match(result.xml, /<clef number="1"><sign>G<\/sign>/);
  assert.match(result.xml, /<clef number="2"><sign>F<\/sign>/);
  assert.match(result.xml, /<backup><duration>16<\/duration><\/backup>/);
  assert.match(result.xml, /<staff>1<\/staff>/);
  assert.match(result.xml, /<staff>2<\/staff>/);
  // A esquerda não vira acorde da direita: são vozes separadas.
  assert.doesNotMatch(result.xml, /<chord\/>/);
});

test("nota longa da mão esquerda não é cortada pela mão direita", () => {
  const division = 480;
  const events = [
    { delta: 0, bytes: [0x90, 48, 0x64] }, // C3 sustentado por duas semínimas
    { delta: 0, bytes: [0x90, 60, 0x64] }, // C4, semínima
    { delta: division, bytes: [0x80, 60, 0x40] },
    { delta: 0, bytes: [0x90, 62, 0x64] }, // D4, semínima
    { delta: division, bytes: [0x80, 48, 0x40] },
    { delta: 0, bytes: [0x80, 62, 0x40] },
  ];
  const xml = midiToMusicXml(buildMidi(events, { division })).xml;
  const bass = xml.split("<backup>")[1];

  assert.match(bass, /<step>C<\/step>\s*<octave>3<\/octave>/);
  assert.match(bass, /<type>half<\/type>/, "a mão esquerda mantém a mínima");
  assert.doesNotMatch(bass.split("<type>half</type>")[0], /<rest\/>/);
});

test("usa uma pauta só quando há um registro só", () => {
  const result = midiToMusicXml(scaleMidi());
  assert.doesNotMatch(result.xml, /<staves>/);
  assert.doesNotMatch(result.xml, /<backup>/);
  assert.match(result.xml, /<clef><sign>G<\/sign>/);
});

test("peça grave sozinha ganha clave de fá", () => {
  const division = 480;
  const result = midiToMusicXml(buildMidi(note(43, { start: 0, length: division }), { division }));
  assert.match(result.xml, /<clef><sign>F<\/sign><line>4<\/line><\/clef>/);
});

// Soma as durações de cada compasso, contando o acorde uma vez só.
function measureDurations(xml) {
  return xml.split("<measure number=").slice(1).map((measure) =>
    measure
      .split("<note>")
      .slice(1)
      .filter((note) => !note.includes("<chord/>"))
      .reduce((total, note) => total + Number(note.match(/<duration>(\d+)<\/duration>/)[1]), 0),
  );
}

test("todo compasso fecha com a duração exata do compasso", () => {
  const division = 96;
  // Ritmo irregular de propósito: colcheia pontuada, semicolcheia e ligaduras.
  const events = [
    { delta: 0, bytes: [0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08] }, // 3/4
    ...note(60, { start: 0, length: 72 }),
    ...note(62, { start: 0, length: 24 }),
    ...note(64, { start: 0, length: 5 * 96 }),
  ];
  const result = midiToMusicXml(buildMidi(events, { division }));
  const durations = measureDurations(result.xml);

  assert.ok(durations.length >= 2, "gerou mais de um compasso");
  for (const total of durations) {
    assert.equal(total, 12, "3/4 com semínima = 4 unidades → 12 por compasso");
  }
});

test("usa bemóis quando a armadura tem bemóis", () => {
  const division = 480;
  const events = [
    { delta: 0, bytes: [0xff, 0x59, 0x02, 0xfd, 0x00] }, // -3 → Mi bemol maior
    ...note(63, { start: 0, length: division }),
  ];
  const result = midiToMusicXml(buildMidi(events, { division }));
  assert.match(result.xml, /<step>E<\/step>/);
  assert.match(result.xml, /<alter>-1<\/alter>/);
  assert.match(result.xml, /<fifths>-3<\/fifths>/);
});

test("escapa caracteres especiais no título", () => {
  const result = midiToMusicXml(scaleMidi(), { title: 'Estudo "A" & B <1>' });
  assert.match(result.xml, /Estudo &quot;A&quot; &amp; B &lt;1&gt;/);
  assert.doesNotMatch(result.xml, /<work-title>Estudo "A"/);
});

// --- Auxiliares puros ------------------------------------------------------

test("midiToPitch nomeia as alturas com sustenidos ou bemóis", () => {
  assert.deepEqual(midiToPitch(60), { step: "C", alter: 0, octave: 4 });
  assert.deepEqual(midiToPitch(61), { step: "C", alter: 1, octave: 4 });
  assert.deepEqual(midiToPitch(61, true), { step: "D", alter: -1, octave: 4 });
  assert.deepEqual(midiToPitch(70, true), { step: "B", alter: -1, octave: 4 });
  assert.deepEqual(midiToPitch(21), { step: "A", alter: 0, octave: 0 });
});

test("splitDuration quebra durações quebradas em valores escrevíveis", () => {
  assert.deepEqual(splitDuration(4).map((item) => item.type), ["quarter"]);
  assert.deepEqual(splitDuration(6).map((item) => item.type), ["quarter"]);
  assert.deepEqual(splitDuration(6)[0].dots, 1);
  assert.deepEqual(splitDuration(5).map((item) => item.type), ["quarter", "16th"]);
  assert.equal(
    splitDuration(16).reduce((total, item) => total + item.units, 0),
    16,
  );
});
