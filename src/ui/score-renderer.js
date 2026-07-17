import { noteToMidi, midiToPortuguese } from '../core/music.js';

const NS = 'http://www.w3.org/2000/svg';
const NATURAL_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

export function renderScore(container, song, currentIndex = 0, showNames = true) {
  container.replaceChildren();
  const svg = create('svg', { viewBox: '0 0 920 310', role: 'presentation' });
  svg.append(create('rect', { x: 0, y: 0, width: 920, height: 310, fill: '#fbfcfd' }));

  const start = Math.max(0, Math.min(song.notes.length - 8, currentIndex - 2));
  const visible = song.notes.slice(start, start + 8);
  drawStaff(svg, 55, 80, 820);
  svg.append(create('text', { x: 63, y: 135, 'font-size': 64, 'font-family': 'serif', fill: '#172033' }, '𝄞'));
  svg.append(create('text', { x: 122, y: 77, 'font-size': 15, 'font-weight': 800, fill: '#667085' }, `${song.key} · ${song.bpm} bpm`));

  let runningBeat = song.notes.slice(0, start).reduce((sum, note) => sum + note.duration, 0);
  const spacing = 88;
  visible.forEach((note, localIndex) => {
    const globalIndex = start + localIndex;
    const x = 180 + localIndex * spacing;
    const y = noteY(note.pitch);
    const isCurrent = globalIndex === currentIndex;
    const isCompleted = globalIndex < currentIndex;
    const fill = isCurrent ? '#d7a84b' : isCompleted ? '#177a4b' : '#172033';

    if (globalIndex === 0 || Math.floor(runningBeat / 4) !== Math.floor((runningBeat - 0.001) / 4)) {
      svg.append(create('line', { x: x - 34, y1: 80, x1: x - 34, y2: 128, stroke: '#aeb8c4', 'stroke-width': 1.5 }));
    }

    drawLedgerLines(svg, x, y);
    if (isCurrent) {
      svg.append(create('circle', { cx: x, cy: y, r: 25, fill: 'rgba(215,168,75,0.18)' }));
    }
    drawAccidental(svg, note.pitch, x - 23, y + 6, fill);
    drawNote(svg, x, y, note.duration, fill);

    svg.append(create('text', {
      x,
      y: y < 105 ? y - 30 : y + 42,
      'text-anchor': 'middle',
      'font-size': 13,
      'font-weight': 900,
      fill: isCurrent ? '#8b650f' : '#667085',
    }, String(note.finger || '')));

    if (showNames) {
      svg.append(create('text', {
        x,
        y: 205,
        'text-anchor': 'middle',
        'font-size': 14,
        'font-weight': isCurrent ? 900 : 700,
        fill,
      }, midiToPortuguese(noteToMidi(note.pitch))));
    }

    svg.append(create('text', {
      x,
      y: 235,
      'text-anchor': 'middle',
      'font-size': 12,
      fill: '#8993a2',
    }, durationSymbol(note.duration)));

    runningBeat += note.duration;
  });

  if (start > 0) svg.append(create('text', { x: 120, y: 112, 'font-size': 24, fill: '#8993a2' }, '…'));
  if (start + visible.length < song.notes.length) svg.append(create('text', { x: 875, y: 112, 'font-size': 24, fill: '#8993a2' }, '…'));

  svg.append(create('text', { x: 55, y: 282, 'font-size': 13, fill: '#667085' }, 'Dedilhado sugerido acima/abaixo das notas · leitura simplificada'));
  container.append(svg);
}

function drawStaff(svg, x, y, width) {
  for (let i = 0; i < 5; i += 1) {
    svg.append(create('line', { x1: x, y1: y + i * 12, x2: x + width, y2: y + i * 12, stroke: '#667085', 'stroke-width': 1.2 }));
  }
  svg.append(create('line', { x1: x, y1: y, x2: x, y2: y + 48, stroke: '#172033', 'stroke-width': 2 }));
  svg.append(create('line', { x1: x + width, y1: y, x2: x + width, y2: y + 48, stroke: '#172033', 'stroke-width': 2 }));
}

function drawNote(svg, x, y, duration, fill) {
  const open = duration >= 2;
  svg.append(create('ellipse', {
    cx: x,
    cy: y,
    rx: 10,
    ry: 7,
    transform: `rotate(-18 ${x} ${y})`,
    fill: open ? '#fbfcfd' : fill,
    stroke: fill,
    'stroke-width': 2.5,
  }));
  if (duration < 4) {
    const stemUp = y >= 104;
    const stemX = stemUp ? x + 8 : x - 8;
    const stemEndY = stemUp ? y - 43 : y + 43;
    svg.append(create('line', { x1: stemX, y1: y, x2: stemX, y2: stemEndY, stroke: fill, 'stroke-width': 2.4 }));
    if (duration < 1) {
      const flagPath = stemUp
        ? `M ${stemX} ${stemEndY} Q ${stemX + 18} ${stemEndY + 9} ${stemX + 5} ${stemEndY + 23}`
        : `M ${stemX} ${stemEndY} Q ${stemX - 18} ${stemEndY - 9} ${stemX - 5} ${stemEndY - 23}`;
      svg.append(create('path', { d: flagPath, fill: 'none', stroke: fill, 'stroke-width': 2.4 }));
    }
  }
}

function drawAccidental(svg, pitch, x, y, fill) {
  if (pitch.includes('#')) svg.append(create('text', { x, y, 'font-size': 22, fill }, '♯'));
  if (pitch.includes('b')) svg.append(create('text', { x, y, 'font-size': 22, fill }, '♭'));
}

function drawLedgerLines(svg, x, y) {
  const ledgerYs = [];
  if (y >= 140) for (let lineY = 140; lineY <= y + 1; lineY += 12) ledgerYs.push(lineY);
  if (y <= 68) for (let lineY = 68; lineY >= y - 1; lineY -= 12) ledgerYs.push(lineY);
  ledgerYs.forEach((lineY) => svg.append(create('line', { x1: x - 15, y1: lineY, x2: x + 15, y2: lineY, stroke: '#667085', 'stroke-width': 1.2 })));
}

function noteY(pitch) {
  const match = /^([A-G])(?:#|b)?(-?\d)$/.exec(pitch);
  const diatonic = Number(match[2]) * 7 + NATURAL_STEP[match[1]];
  const e4 = 4 * 7 + NATURAL_STEP.E;
  return 128 - (diatonic - e4) * 6;
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
