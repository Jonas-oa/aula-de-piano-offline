import { noteToMidi, midiToPortuguese } from '../core/music.js';

const NS = 'http://www.w3.org/2000/svg';
const NATURAL_STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// Geometria das pautas (coordenadas do viewBox)
const TREBLE_TOP = 80;
const BASS_TOP = 210;
const STEP = 6;
const SCORE_WIDTH = 920;
const NOTE_START_X = 180;
const NOTE_SPACING = 88;
const PLAYHEAD_X = 310;
const SCROLL_DURATION_MS = 280;
const TRACK_ANIMATIONS = new WeakMap();

// Metadados corretivos para transcrições que ainda usam o formato legado.
// Für Elise está em 3/8: como as durações do catálogo usam a semínima como 1,
// cada compasso equivale a 1,5 unidades.
const SCORE_METADATA = {
  'fur-elise': { beatsPerBar: 1.5, timeSignature: '3/8' },
};

export function effectiveBeatsPerBar(song) {
  const override = SCORE_METADATA[song?.id]?.beatsPerBar;
  if (Number.isFinite(override)) return override;

  if (song?.beatsPerBar !== undefined && song?.beatsPerBar !== null) {
    const configured = Number(song.beatsPerBar);
    return Number.isFinite(configured) ? configured : 0;
  }

  return 4;
}

export function timeSignatureLabel(song) {
  if (song?.timeSignature) return String(song.timeSignature);
  const override = SCORE_METADATA[song?.id]?.timeSignature;
  if (override) return override;

  const beatsPerBar = effectiveBeatsPerBar(song);
  if (beatsPerBar === 4) return '4/4';
  if (beatsPerBar === 3) return '3/4';
  if (beatsPerBar === 2) return '2/4';
  return '';
}

export function scoreTranslateXForIndex(song, currentIndex = 0) {
  const noteCount = Math.max(0, song?.notes?.length || 0);
  if (!noteCount) return 0;
  const visualIndex = Math.min(Math.max(Number(currentIndex) || 0, 0), noteCount - 1);
  const currentX = NOTE_START_X + visualIndex * NOTE_SPACING;
  return Math.min(0, PLAYHEAD_X - currentX);
}

export function renderScore(container, song, currentIndex = 0, showNames = true) {
  const scoreKey = `${song.id}:${showNames ? 1 : 0}`;
  let svg = container.querySelector('svg[data-score-key]');

  if (!svg || svg.dataset.scoreKey !== scoreKey) {
    container.replaceChildren();
    svg = buildScore(song, showNames);
    container.append(svg);
  }

  updateScoreState(svg, song, currentIndex);
}

function buildScore(song, showNames) {
  const hasBass = song.clef === 'grand';
  const height = hasBass ? 430 : 310;
  const svg = create('svg', {
    viewBox: `0 0 ${SCORE_WIDTH} ${height}`,
    role: 'presentation',
    'data-score-key': `${song.id}:${showNames ? 1 : 0}`,
  });
  svg.dataset.focusViewBox = hasBass ? '35 20 850 375' : '35 20 850 245';
  svg.append(create('rect', { x: 0, y: 0, width: SCORE_WIDTH, height, fill: '#fbfcfd' }));

  const clipId = `score-window-${safeId(song.id)}`;
  const defs = create('defs');
  const clipPath = create('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
  clipPath.append(create('rect', {
    x: 145,
    y: 42,
    width: 735,
    height: hasBass ? 330 : 220,
  }));
  defs.append(clipPath);
  svg.append(defs);

  drawStaff(svg, 55, TREBLE_TOP, 820);
  svg.append(create('text', {
    x: 63,
    y: 135,
    'font-size': 64,
    'font-family': 'serif',
    fill: '#172033',
  }, '𝄞'));

  if (hasBass) {
    drawStaff(svg, 55, BASS_TOP, 820);
    svg.append(create('text', {
      x: 66,
      y: 238,
      'font-size': 46,
      'font-family': 'serif',
      fill: '#172033',
    }, '𝄢'));
    svg.append(create('line', {
      x1: 55,
      y1: TREBLE_TOP,
      x2: 55,
      y2: BASS_TOP + 48,
      stroke: '#172033',
      'stroke-width': 2,
    }));
  }

  const signature = timeSignatureLabel(song);
  svg.append(create('text', {
    x: 122,
    y: 77,
    'font-size': 15,
    'font-weight': 800,
    fill: '#667085',
  }, `${song.key} · ${song.bpm} bpm${signature ? ` · ${signature}` : ''}`));

  // A linha fica parada enquanto as notas deslizam por baixo dela.
  svg.append(create('line', {
    x1: PLAYHEAD_X,
    y1: hasBass ? 52 : 56,
    x2: PLAYHEAD_X,
    y2: hasBass ? 278 : 150,
    stroke: 'rgba(215,168,75,0.24)',
    'stroke-width': 2,
    'stroke-dasharray': '5 7',
  }));

  // O recorte fica no grupo externo. Somente a faixa interna é deslocada;
  // assim, a janela permanece fixa enquanto a partitura rola.
  const viewport = create('g', {
    class: 'score-viewport',
    'clip-path': `url(#${clipId})`,
  });
  const track = create('g', {
    class: 'score-track',
    transform: 'translate(0 0)',
    'data-translate-x': '0',
  });
  viewport.append(track);
  svg.append(viewport);

  const namesY = hasBass ? 320 : 205;
  const durationY = hasBass ? 348 : 235;
  const barBottom = hasBass ? BASS_TOP + 48 : 128;
  const beatsPerBar = effectiveBeatsPerBar(song);
  const pickupOffset = song.pickupBeats && beatsPerBar > 0
    ? beatsPerBar - Number(song.pickupBeats)
    : 0;
  let runningBeat = pickupOffset;

  song.notes.forEach((event, index) => {
    const x = NOTE_START_X + index * NOTE_SPACING;
    const eventGroup = create('g', {
      class: 'score-event',
      'data-index': index,
    });

    const crossesBar = beatsPerBar > 0
      && ((index === 0 && !song.pickupBeats)
        || Math.floor(runningBeat / beatsPerBar)
          !== Math.floor((runningBeat - 0.001) / beatsPerBar));
    if (crossesBar) {
      track.append(create('line', {
        x1: x - 34,
        y1: 80,
        x2: x - 34,
        y2: barBottom,
        stroke: '#aeb8c4',
        'stroke-width': 1.5,
      }));
    }

    const pitches = event.pitches || [event];
    const treble = hasBass ? pitches.filter((pitch) => noteToMidi(pitch.pitch) >= 60) : pitches;
    const bass = hasBass ? pitches.filter((pitch) => noteToMidi(pitch.pitch) < 60) : [];

    const haloGroup = create('g', { class: 'score-current-halo', visibility: 'hidden' });
    pitches.forEach((pitch) => {
      const onBass = hasBass && noteToMidi(pitch.pitch) < 60;
      haloGroup.append(create('circle', {
        cx: x,
        cy: noteY(pitch.pitch, onBass),
        r: 22,
        fill: 'rgba(215,168,75,0.18)',
      }));
    });
    eventGroup.append(haloGroup);

    drawEventOnStaff(eventGroup, treble, x, false);
    drawEventOnStaff(eventGroup, bass, x, true);

    if (showNames) {
      const label = pitches.map((pitch) => midiToPortuguese(noteToMidi(pitch.pitch))).join(' + ');
      eventGroup.append(create('text', {
        x,
        y: namesY,
        'text-anchor': 'middle',
        'font-size': pitches.length > 1 ? 11 : 14,
        'font-weight': 750,
        fill: 'currentColor',
      }, label));
    }

    eventGroup.append(create('text', {
      x,
      y: durationY,
      'text-anchor': 'middle',
      'font-size': 12,
      fill: '#8993a2',
    }, durationSymbol(event.duration)));

    track.append(eventGroup);
    runningBeat += Number(event.duration) || 0;
  });

  svg.append(create('text', {
    x: 55,
    y: height - 28,
    'font-size': 13,
    fill: '#667085',
  }, 'Dedilhado sugerido junto às notas · leitura simplificada'));

  return svg;
}

function updateScoreState(svg, song, currentIndex) {
  const completedAll = currentIndex >= song.notes.length;

  svg.querySelectorAll('.score-event').forEach((group) => {
    const index = Number(group.dataset.index);
    const isCurrent = !completedAll && index === currentIndex;
    const isCompleted = completedAll || index < currentIndex;
    const color = isCurrent ? '#d7a84b' : isCompleted ? '#177a4b' : '#172033';
    group.style.color = color;
    group.querySelector('.score-current-halo')?.setAttribute('visibility', isCurrent ? 'visible' : 'hidden');
    group.querySelectorAll('[data-finger]').forEach((finger) => {
      finger.setAttribute('fill', isCurrent ? '#8b650f' : '#667085');
    });
  });

  const track = svg.querySelector('.score-track');
  if (!track) return;
  animateTrackTo(track, scoreTranslateXForIndex(song, currentIndex));
}

function animateTrackTo(track, targetX) {
  const activeFrame = TRACK_ANIMATIONS.get(track);
  if (activeFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(activeFrame);

  const startX = Number(track.dataset.translateX || 0);
  const distance = targetX - startX;
  const reduceMotion = typeof window === 'undefined'
    || typeof requestAnimationFrame !== 'function'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || Math.abs(distance) < 0.5) {
    setTrackTranslate(track, targetX);
    return;
  }

  const startTime = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - startTime) / SCROLL_DURATION_MS);
    const eased = 1 - (1 - progress) ** 3;
    setTrackTranslate(track, startX + distance * eased);

    if (progress < 1) {
      TRACK_ANIMATIONS.set(track, requestAnimationFrame(step));
    } else {
      TRACK_ANIMATIONS.delete(track);
      setTrackTranslate(track, targetX);
    }
  };

  TRACK_ANIMATIONS.set(track, requestAnimationFrame(step));
}

function setTrackTranslate(track, value) {
  const normalized = Number.isFinite(value) ? value : 0;
  track.dataset.translateX = String(normalized);
  // O atributo SVG usa as unidades do viewBox. Isso evita o erro de escala que
  // ocorria com translateX(px) em telas grandes, fazendo as notas sumirem.
  track.setAttribute('transform', `translate(${normalized.toFixed(2)} 0)`);
}

function drawEventOnStaff(parent, pitches, x, isBass) {
  if (!pitches.length) return;
  const placed = pitches
    .map((pitch) => ({ ...pitch, y: noteY(pitch.pitch, isBass), step: diatonicStep(pitch.pitch) }))
    .sort((a, b) => a.y - b.y);

  placed.forEach((pitch) => drawLedgerLines(parent, x, pitch.y, isBass));

  const midStaffY = isBass ? BASS_TOP + 24 : TREBLE_TOP + 24;
  const meanY = placed.reduce((sum, pitch) => sum + pitch.y, 0) / placed.length;
  const stemUp = meanY >= midStaffY;
  const stemX = stemUp ? x + 8 : x - 8;

  let previousStep = null;
  let shifted = false;
  const heads = placed.map((pitch) => {
    shifted = previousStep !== null && Math.abs(pitch.step - previousStep) === 1 && !shifted;
    previousStep = pitch.step;
    return { ...pitch, headX: shifted ? x + (stemUp ? 15 : -15) : x };
  });

  heads.forEach((pitch) => {
    drawAccidental(parent, pitch.pitch, pitch.headX - 23, pitch.y + 6);
    parent.append(create('ellipse', {
      cx: pitch.headX,
      cy: pitch.y,
      rx: 10,
      ry: 7,
      transform: `rotate(-18 ${pitch.headX} ${pitch.y})`,
      fill: pitch.duration >= 2 ? '#fbfcfd' : 'currentColor',
      stroke: 'currentColor',
      'stroke-width': 2.5,
    }));
    if (pitch.finger) {
      parent.append(create('text', {
        x: pitch.headX + (stemUp ? -21 : 21) + (pitch.pitch.length > 2 ? (stemUp ? -8 : 8) : 0),
        y: pitch.y + 5,
        'text-anchor': 'middle',
        'font-size': 13,
        'font-weight': 900,
        fill: '#667085',
        'data-finger': 'true',
      }, String(pitch.finger)));
    }
  });

  const shortest = Math.min(...placed.map((pitch) => pitch.duration));
  if (shortest < 4) {
    const anchor = stemUp ? heads[heads.length - 1] : heads[0];
    const tip = stemUp ? heads[0].y - 43 : heads[heads.length - 1].y + 43;
    parent.append(create('line', {
      x1: stemX,
      y1: anchor.y,
      x2: stemX,
      y2: tip,
      stroke: 'currentColor',
      'stroke-width': 2.4,
    }));
    if (shortest < 1) {
      const flagPath = stemUp
        ? `M ${stemX} ${tip} Q ${stemX + 18} ${tip + 9} ${stemX + 5} ${tip + 23}`
        : `M ${stemX} ${tip} Q ${stemX - 18} ${tip - 9} ${stemX - 5} ${tip - 23}`;
      parent.append(create('path', {
        d: flagPath,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2.4,
      }));
    }
  }
}

function drawStaff(svg, x, y, width) {
  for (let index = 0; index < 5; index += 1) {
    svg.append(create('line', {
      x1: x,
      y1: y + index * 12,
      x2: x + width,
      y2: y + index * 12,
      stroke: '#667085',
      'stroke-width': 1.2,
    }));
  }
  svg.append(create('line', { x1: x, y1: y, x2: x, y2: y + 48, stroke: '#172033', 'stroke-width': 2 }));
  svg.append(create('line', { x1: x + width, y1: y, x2: x + width, y2: y + 48, stroke: '#172033', 'stroke-width': 2 }));
}

function drawAccidental(parent, pitch, x, y) {
  if (pitch.includes('#')) parent.append(create('text', { x, y, 'font-size': 22, fill: 'currentColor' }, '♯'));
  if (pitch.includes('b')) parent.append(create('text', { x, y, 'font-size': 22, fill: 'currentColor' }, '♭'));
}

function drawLedgerLines(parent, x, y, isBass) {
  const top = isBass ? BASS_TOP : TREBLE_TOP;
  const bottom = top + 48;
  const ledgerYs = [];
  if (y >= bottom + 12) {
    for (let lineY = bottom + 12; lineY <= y + 1; lineY += 12) ledgerYs.push(lineY);
  }
  if (y <= top - 12) {
    for (let lineY = top - 12; lineY >= y - 1; lineY -= 12) ledgerYs.push(lineY);
  }
  ledgerYs.forEach((lineY) => parent.append(create('line', {
    x1: x - 15,
    y1: lineY,
    x2: x + 15,
    y2: lineY,
    stroke: 'currentColor',
    'stroke-width': 1.2,
  })));
}

function diatonicStep(pitch) {
  const match = /^([A-G])(?:#|b)?(-?\d)$/.exec(pitch);
  return Number(match[2]) * 7 + NATURAL_STEP[match[1]];
}

function noteY(pitch, isBass = false) {
  const step = diatonicStep(pitch);
  if (isBass) {
    const g2 = 2 * 7 + NATURAL_STEP.G;
    return BASS_TOP + 48 - (step - g2) * STEP;
  }
  const e4 = 4 * 7 + NATURAL_STEP.E;
  return TREBLE_TOP + 48 - (step - e4) * STEP;
}

function durationSymbol(duration) {
  if (duration >= 4) return '4 tempos';
  if (duration >= 2) return '2 tempos';
  if (duration >= 1) return '1 tempo';
  if (duration >= 0.5) return '½ tempo';
  if (duration >= 0.25) return '¼ de tempo';
  return 'subdivisão';
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
}

function create(tag, attributes = {}, text = '') {
  const node = document.createElementNS(NS, tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}
