import { noteToMidi, midiToPortuguese } from '../core/music.js';

const NS = 'http://www.w3.org/2000/svg';
const NATURAL_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// Geometria das pautas (coordenadas do viewBox)
const TREBLE_TOP = 80; // linha superior da pauta de Sol (linhas a cada 12px)
const BASS_TOP = 210; // linha superior da pauta de Fá (usada só no grand staff)
const STEP = 6; // meia distância entre linhas = um grau diatônico

export function renderScore(container, song, currentIndex = 0, showNames = true) {
  container.replaceChildren();

  const events = song.notes.map((event) => event.pitches || [event]);
  const hasBass = events.some((pitches) => pitches.some((p) => noteToMidi(p.pitch) < 60));
  const height = hasBass ? 430 : 310;

  const svg = create('svg', { viewBox: `0 0 920 ${height}`, role: 'presentation' });
  svg.dataset.focusViewBox = hasBass ? '35 20 850 375' : '35 20 850 245';
  svg.append(create('rect', { x: 0, y: 0, width: 920, height, fill: '#fbfcfd' }));

  const start = Math.max(0, Math.min(song.notes.length - 8, currentIndex - 2));
  const visible = song.notes.slice(start, start + 8);

  drawStaff(svg, 55, TREBLE_TOP, 820);
  svg.append(create('text', { x: 63, y: 135, 'font-size': 64, 'font-family': 'serif', fill: '#172033' }, '𝄞'));
  if (hasBass) {
    drawStaff(svg, 55, BASS_TOP, 820);
    svg.append(create('text', { x: 66, y: 238, 'font-size': 46, 'font-family': 'serif', fill: '#172033' }, '𝄢'));
    // barra vertical unindo as duas pautas (início do sistema)
    svg.append(create('line', { x1: 55, y1: TREBLE_TOP, x2: 55, y2: BASS_TOP + 48, stroke: '#172033', 'stroke-width': 2 }));
  }
  svg.append(create('text', { x: 122, y: 77, 'font-size': 15, 'font-weight': 800, fill: '#667085' }, `${song.key} · ${song.bpm} bpm`));

  const namesY = hasBass ? 320 : 205;
  const durationY = hasBass ? 348 : 235;
  const barBottom = hasBass ? BASS_TOP + 48 : 128;

  let runningBeat = song.notes.slice(0, start).reduce((sum, note) => sum + note.duration, 0);
  const spacing = 88;
  visible.forEach((event, localIndex) => {
    const globalIndex = start + localIndex;
    const x = 180 + localIndex * spacing;
    const isCurrent = globalIndex === currentIndex;
    const isCompleted = globalIndex < currentIndex;
    const fill = isCurrent ? '#d7a84b' : isCompleted ? '#177a4b' : '#172033';
    const pitches = event.pitches || [event];

    const beatsPerBar = song.beatsPerBar ?? 4;
    const crossesBar = beatsPerBar >= 2
      && (globalIndex === 0 || Math.floor(runningBeat / beatsPerBar) !== Math.floor((runningBeat - 0.001) / beatsPerBar));
    if (crossesBar) {
      svg.append(create('line', { x1: x - 34, y1: 80, x2: x - 34, y2: barBottom, stroke: '#aeb8c4', 'stroke-width': 1.5 }));
    }

    // Divide o evento entre as pautas: Dó central (60) para cima → Sol; abaixo → Fá
    const treble = pitches.filter((p) => noteToMidi(p.pitch) >= 60);
    const bass = pitches.filter((p) => noteToMidi(p.pitch) < 60);
    if (isCurrent) {
      [...treble, ...bass].forEach((p) => {
        svg.append(create('circle', { cx: x, cy: noteY(p.pitch, noteToMidi(p.pitch) < 60), r: 22, fill: 'rgba(215,168,75,0.18)' }));
      });
    }
    drawEventOnStaff(svg, treble, x, false, fill, isCurrent);
    drawEventOnStaff(svg, bass, x, true, fill, isCurrent);

    if (showNames) {
      const label = pitches.map((p) => midiToPortuguese(noteToMidi(p.pitch))).join(' + ');
      svg.append(create('text', {
        x,
        y: namesY,
        'text-anchor': 'middle',
        'font-size': pitches.length > 1 ? 11 : 14,
        'font-weight': isCurrent ? 900 : 700,
        fill,
      }, label));
    }

    svg.append(create('text', {
      x,
      y: durationY,
      'text-anchor': 'middle',
      'font-size': 12,
      fill: '#8993a2',
    }, durationSymbol(event.duration)));

    runningBeat += event.duration;
  });

  if (start > 0) svg.append(create('text', { x: 120, y: 112, 'font-size': 24, fill: '#8993a2' }, '…'));
  if (start + visible.length < song.notes.length) svg.append(create('text', { x: 875, y: 112, 'font-size': 24, fill: '#8993a2' }, '…'));

  svg.append(create('text', { x: 55, y: height - 28, 'font-size': 13, fill: '#667085' }, 'Dedilhado sugerido junto às notas · leitura simplificada'));
  container.append(svg);
}

// Desenha as notas de um evento numa das pautas: cabeças, haste única
// compartilhada, linhas suplementares, acidentes e dedilhado.
function drawEventOnStaff(svg, pitches, x, isBass, fill, isCurrent) {
  if (!pitches.length) return;
  const placed = pitches
    .map((p) => ({ ...p, y: noteY(p.pitch, isBass), step: diatonicStep(p.pitch) }))
    .sort((a, b) => a.y - b.y); // do agudo (y menor) ao grave

  placed.forEach((p) => drawLedgerLines(svg, x, p.y, isBass));

  const midStaffY = isBass ? BASS_TOP + 24 : TREBLE_TOP + 24;
  const meanY = placed.reduce((sum, p) => sum + p.y, 0) / placed.length;
  const stemUp = meanY >= midStaffY;
  const stemX = stemUp ? x + 8 : x - 8;

  // Cabeças; segundas (graus vizinhos) deslocam a cabeça para o lado da haste
  let previousStep = null;
  let shifted = false;
  const heads = placed.map((p) => {
    shifted = previousStep !== null && Math.abs(p.step - previousStep) === 1 && !shifted;
    previousStep = p.step;
    return { ...p, headX: shifted ? x + (stemUp ? 15 : -15) : x };
  });

  const open = Math.max(...placed.map((p) => p.duration)) >= 2;
  heads.forEach((p) => {
    drawAccidental(svg, p.pitch, p.headX - 23, p.y + 6, fill);
    svg.append(create('ellipse', {
      cx: p.headX,
      cy: p.y,
      rx: 10,
      ry: 7,
      transform: `rotate(-18 ${p.headX} ${p.y})`,
      fill: p.duration >= 2 ? '#fbfcfd' : fill,
      stroke: fill,
      'stroke-width': 2.5,
    }));
    if (p.finger) {
      svg.append(create('text', {
        x: p.headX + (stemUp ? -21 : 21) + (p.pitch.length > 2 ? (stemUp ? -8 : 8) : 0),
        y: p.y + 5,
        'text-anchor': 'middle',
        'font-size': 13,
        'font-weight': 900,
        fill: isCurrent ? '#8b650f' : '#667085',
      }, String(p.finger)));
    }
  });

  const shortest = Math.min(...placed.map((p) => p.duration));
  if (shortest < 4) {
    const anchor = stemUp ? heads[heads.length - 1] : heads[0]; // nota mais distante da ponta
    const tip = stemUp ? heads[0].y - 43 : heads[heads.length - 1].y + 43;
    svg.append(create('line', { x1: stemX, y1: anchor.y, x2: stemX, y2: tip, stroke: fill, 'stroke-width': 2.4 }));
    if (shortest < 1) {
      const flagPath = stemUp
        ? `M ${stemX} ${tip} Q ${stemX + 18} ${tip + 9} ${stemX + 5} ${tip + 23}`
        : `M ${stemX} ${tip} Q ${stemX - 18} ${tip - 9} ${stemX - 5} ${tip - 23}`;
      svg.append(create('path', { d: flagPath, fill: 'none', stroke: fill, 'stroke-width': 2.4 }));
    }
  }
}

function drawStaff(svg, x, y, width) {
  for (let i = 0; i < 5; i += 1) {
    svg.append(create('line', { x1: x, y1: y + i * 12, x2: x + width, y2: y + i * 12, stroke: '#667085', 'stroke-width': 1.2 }));
  }
  svg.append(create('line', { x1: x, y1: y, x2: x, y2: y + 48, stroke: '#172033', 'stroke-width': 2 }));
  svg.append(create('line', { x1: x + width, y1: y, x2: x + width, y2: y + 48, stroke: '#172033', 'stroke-width': 2 }));
}

function drawAccidental(svg, pitch, x, y, fill) {
  if (pitch.includes('#')) svg.append(create('text', { x, y, 'font-size': 22, fill }, '♯'));
  if (pitch.includes('b')) svg.append(create('text', { x, y, 'font-size': 22, fill }, '♭'));
}

function drawLedgerLines(svg, x, y, isBass) {
  const top = isBass ? BASS_TOP : TREBLE_TOP;
  const bottom = top + 48;
  const ledgerYs = [];
  if (y >= bottom + 12) for (let lineY = bottom + 12; lineY <= y + 1; lineY += 12) ledgerYs.push(lineY);
  if (y <= top - 12) for (let lineY = top - 12; lineY >= y - 1; lineY -= 12) ledgerYs.push(lineY);
  ledgerYs.forEach((lineY) => svg.append(create('line', { x1: x - 15, y1: lineY, x2: x + 15, y2: lineY, stroke: '#667085', 'stroke-width': 1.2 })));
}

function diatonicStep(pitch) {
  const match = /^([A-G])(?:#|b)?(-?\d)$/.exec(pitch);
  return Number(match[2]) * 7 + NATURAL_STEP[match[1]];
}

function noteY(pitch, isBass = false) {
  const step = diatonicStep(pitch);
  if (isBass) {
    // Pauta de Fá: Sol 2 na linha inferior (BASS_TOP + 48)
    const g2 = 2 * 7 + NATURAL_STEP.G;
    return BASS_TOP + 48 - (step - g2) * STEP;
  }
  // Pauta de Sol: Mi 4 na linha inferior (TREBLE_TOP + 48)
  const e4 = 4 * 7 + NATURAL_STEP.E;
  return TREBLE_TOP + 48 - (step - e4) * STEP;
}

function durationSymbol(duration) {
  if (duration >= 4) return '4 tempos';
  if (duration >= 2) return '2 tempos';
  if (duration >= 1) return '1 tempo';
  return '½ tempo';
}

function create(tag, attributes = {}, text = '') {
  const node = document.createElementNS(NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}

import("./focus-mode.js").catch(() => {});
