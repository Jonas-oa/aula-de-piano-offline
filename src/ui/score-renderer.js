import { diatonicStep, noteToMidi, parsePitch } from '../core/music.js';

const NS = 'http://www.w3.org/2000/svg';

// Geometria das pautas (coordenadas do viewBox)
const TREBLE_TOP = 80;
const BASS_TOP = 180;
const STEP = 6;
const SCORE_WIDTH = 920;
const SCORE_VIEW_X = 35;
const SCORE_VIEW_WIDTH = 850;
const NOTE_START_X = 180;
const NOTE_SPACING = 88;
const PLAYHEAD_X = 310;
const VISIBLE_NOTE_COUNT = 10;
const SCROLL_DURATION_MS = 280;
const TRACK_ANIMATIONS = new WeakMap();
const SCORE_EVENT_GROUPS = new WeakMap();
const STAFF_LINE_SPACING = 12;

// A mão vem do <staff> do MusicXML quando existe. O corte pelo dó central é só
// o palpite de reserva: com ele, uma nota grave da mão direita (ou aguda da
// esquerda) ia parar na clave errada.
export function isOnBassStaff(pitch, hasBass) {
  if (!hasBass) return false;
  if (Number.isFinite(Number(pitch?.staff)) && Number(pitch.staff) > 0) {
    return Number(pitch.staff) >= 2;
  }
  try {
    return noteToMidi(pitch?.pitch) < 60;
  } catch {
    return false;
  }
}

export function effectiveBeatsPerBar(song) {
  if (song?.beatsPerBar !== undefined && song?.beatsPerBar !== null) {
    const configured = Number(song.beatsPerBar);
    return Number.isFinite(configured) ? configured : 0;
  }
  return 4;
}

export function timeSignatureLabel(song) {
  if (song?.timeSignature) return String(song.timeSignature);

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

export function scoreVerticalBounds(song, currentIndex = 0) {
  const hasBass = song?.clef === 'grand';
  let minY = 32;
  let maxY = hasBass ? BASS_TOP + 68 : TREBLE_TOP + 78;
  const notes = song?.notes || [];
  const start = Math.max(0, Math.min(Number(currentIndex) || 0, Math.max(0, notes.length - 1)) - 1);
  const visible = notes.slice(start, start + VISIBLE_NOTE_COUNT);

  visible.forEach((event) => {
    (event.pitches || [event]).forEach((pitch) => {
      if (!pitch?.pitch) return;
      try {
        const y = noteY(pitch.pitch, isOnBassStaff(pitch, hasBass));
        minY = Math.min(minY, y - 28);
        maxY = Math.max(maxY, y + 28);
      } catch {
        // Uma altura inválida não deve comprometer o restante da pauta.
      }
    });
  });

  const minimumHeight = hasBass ? 216 : 176;
  if (maxY - minY < minimumHeight) {
    const padding = (minimumHeight - (maxY - minY)) / 2;
    minY -= padding;
    maxY += padding;
  }
  return {
    minY: Math.floor(minY),
    maxY: Math.ceil(maxY),
    height: Math.ceil(maxY) - Math.floor(minY),
  };
}

export function scoreViewBox(song, currentIndex = 0) {
  const { minY, height } = scoreVerticalBounds(song, currentIndex);
  return `${SCORE_VIEW_X} ${minY} ${SCORE_VIEW_WIDTH} ${height}`;
}

// Cabeçalho da pauta. Peças sem tonalidade ou sem fórmula de compasso não devem
// deixar separadores soltos como " · 72 bpm".
export function scoreHeadline(song) {
  return [
    song?.key,
    Number.isFinite(Number(song?.bpm)) ? `${song.bpm} bpm` : "",
    timeSignatureLabel(song),
  ].filter(Boolean).join(' · ');
}

export function isExplicitMeasureBoundary(notes, index) {
  const event = notes?.[index];
  if (!Number.isInteger(event?.measureIndex)) return false;
  return index === 0 || event.measureIndex !== notes[index - 1]?.measureIndex;
}

export function scoreIndexesToRefresh(noteCount, previousIndex, currentIndex) {
  const total = Math.max(0, Number(noteCount) || 0);
  if (!total) return [];
  const current = Math.max(0, Math.min(Number(currentIndex) || 0, total));
  if (!Number.isInteger(previousIndex)) {
    return Array.from({ length: total }, (_, index) => index);
  }
  const previous = Math.max(0, Math.min(previousIndex, total));
  const first = Math.max(0, Math.min(previous, current) - 1);
  const last = Math.min(total - 1, Math.max(previous, current));
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

export function bassClefGeometry() {
  const staffLines = Array.from(
    { length: 5 },
    (_, index) => BASS_TOP + index * STAFF_LINE_SPACING,
  );
  const fLineY = staffLines[1]; // quarta linha contando de baixo para cima
  return {
    staffLines,
    fLineY,
    dotYs: [fLineY - STAFF_LINE_SPACING / 2, fLineY + STAFF_LINE_SPACING / 2],
  };
}

export function scoreIndexForDrag(startIndex, deltaClientX, svgWidth, noteCount) {
  const total = Math.max(0, Number(noteCount) || 0);
  if (!total) return 0;
  const width = Math.max(1, Number(svgWidth) || 1);
  const scoreUnitsPerPixel = SCORE_VIEW_WIDTH / width;
  const movedNotes = Math.round(
    (Number(deltaClientX) || 0) * scoreUnitsPerPixel / NOTE_SPACING,
  );
  return Math.max(0, Math.min(total - 1, Number(startIndex) - movedNotes));
}

export function scoreIndexAtClientX(svg, song, clientX) {
  const noteCount = song?.notes?.length || 0;
  if (!svg || !noteCount) return 0;
  let localX;
  try {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = 0;
    localX = point.matrixTransform(svg.getScreenCTM().inverse()).x;
  } catch {
    const rect = svg.getBoundingClientRect();
    localX = SCORE_VIEW_X
      + ((clientX - rect.left) / Math.max(1, rect.width)) * SCORE_VIEW_WIDTH;
  }
  const translateX = Number(svg.querySelector('.score-track')?.dataset.translateX || 0);
  const index = Math.round((localX - translateX - NOTE_START_X) / NOTE_SPACING);
  return Math.max(0, Math.min(noteCount - 1, index));
}

export function renderScore(
  container,
  song,
  currentIndex = 0,
  loop = null,
  { immediate = false } = {},
) {
  const scoreKey = String(song.id);
  let svg = container.querySelector('svg[data-score-key]');

  if (!svg || svg.dataset.scoreKey !== scoreKey) {
    container.replaceChildren();
    svg = buildScore(song);
    container.append(svg);
  }

  updateLoopRegion(svg, song, loop);
  updateScoreState(svg, song, currentIndex, { immediate });
}

// Faixa de repetição A–B, desenhada dentro do track para rolar junto das notas.
function updateLoopRegion(svg, song, loop) {
  const track = svg.querySelector('.score-track');
  if (!track) return;
  const loopKey = loop && loop.a != null && loop.b != null
    ? `${loop.a}:${loop.b}:${loop.count || 0}`
    : '';
  if (svg.dataset.loopKey === loopKey) return;
  svg.dataset.loopKey = loopKey;
  track.querySelector('.score-loop')?.remove();

  const noteCount = song.notes?.length || 0;
  if (!loop || loop.a == null || loop.b == null || !noteCount) return;
  const a = Math.max(0, Math.min(loop.a, loop.b, noteCount - 1));
  const b = Math.min(noteCount - 1, Math.max(loop.a, loop.b));
  if (b < a) return;

  const hasBass = song.clef === 'grand';
  const bottom = hasBass ? BASS_TOP + 60 : 150;
  const xA = NOTE_START_X + a * NOTE_SPACING - 34;
  const xB = NOTE_START_X + b * NOTE_SPACING + 34;
  const group = create('g', { class: 'score-loop' });
  group.append(create('rect', {
    x: xA, y: 60, width: Math.max(0, xB - xA), height: bottom - 60, rx: 8,
    fill: 'rgba(215,168,75,0.15)',
  }));
  [[xA, 'A'], [xB, 'B']].forEach(([x, label]) => {
    const handle = create('g', {
      class: 'score-loop-handle',
      'data-loop-point': label.toLowerCase(),
      role: 'button',
      'aria-label': `Mover ponto ${label}`,
    });
    handle.append(create('rect', {
      x: x - 25, y: 30, width: 50, height: bottom - 24, rx: 12,
      fill: 'transparent',
    }));
    handle.append(create('line', { x1: x, y1: 54, x2: x, y2: bottom, stroke: '#d7a84b', 'stroke-width': 3 }));
    handle.append(create('rect', { x: x - 15, y: 40, width: 30, height: 22, rx: 6, fill: '#d7a84b' }));
    handle.append(create('text', {
      x, y: 56, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800, fill: '#1a1400',
    }, label));
    group.append(handle);
  });
  if (loop.count) {
    const mid = (xA + xB) / 2;
    group.append(create('rect', { x: mid - 26, y: 40, width: 52, height: 22, rx: 11, fill: '#33240a' }));
    group.append(create('text', {
      x: mid, y: 56, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#f0cd85',
    }, `↻ ${loop.count}`));
  }
  track.prepend(group);
}

function buildScore(song) {
  const hasBass = song.clef === 'grand';
  // A pauta é sempre compacta na vertical: os nomes das notas ficam no teclado
  // de apoio, o que devolve largura útil para a partitura em paisagem.
  const height = hasBass ? 352 : 250;
  const svg = create('svg', {
    viewBox: scoreViewBox(song, 0),
    role: 'presentation',
    preserveAspectRatio: 'xMidYMid meet',
    'data-score-key': String(song.id),
  });
  // O fundo é reposicionado em updateScoreState: o enquadramento vertical muda
  // conforme as notas visíveis, e uma altura fixa deixava faixas transparentes
  // quando havia linhas suplementares agudas.
  svg.append(create('rect', {
    class: 'score-background',
    x: 0,
    y: 0,
    width: SCORE_WIDTH,
    height,
    fill: '#fbfcfd',
  }));

  const clipId = `score-window-${safeId(song.id)}`;
  const defs = create('defs');
  const clipPath = create('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
  clipPath.append(create('rect', {
    x: 145,
    y: -400,
    width: 735,
    height: 1000,
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
    drawBassClef(svg, 68);
    svg.append(create('line', {
      x1: 55,
      y1: TREBLE_TOP,
      x2: 55,
      y2: BASS_TOP + 48,
      stroke: '#172033',
      'stroke-width': 2,
    }));
  }

  svg.append(create('text', {
    x: 122,
    y: 77,
    'font-size': 15,
    'font-weight': 800,
    fill: '#667085',
  }, scoreHeadline(song)));

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

  const barBottom = hasBass ? BASS_TOP + 48 : 128;
  const beatsPerBar = effectiveBeatsPerBar(song);
  const hasMeasureInformation = song.notes.some((event) => Number.isInteger(event.measureIndex));
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

    const measureBoundary = isExplicitMeasureBoundary(song.notes, index);
    const inferredBoundary = beatsPerBar > 0
      && ((index === 0 && !song.pickupBeats)
        || Math.floor(runningBeat / beatsPerBar)
          !== Math.floor((runningBeat - 0.001) / beatsPerBar));
    const crossesBar = hasMeasureInformation ? measureBoundary : inferredBoundary;
    if (crossesBar) {
      track.append(create('line', {
        class: 'score-barline',
        'data-measure': event.measureNumber || event.measureIndex + 1,
        x1: x - 34,
        y1: TREBLE_TOP,
        x2: x - 34,
        y2: barBottom,
        stroke: '#667085',
        'stroke-width': 2,
      }));
    }

    const pitches = event.pitches || [event];
    const bass = pitches.filter((pitch) => isOnBassStaff(pitch, hasBass));
    const treble = pitches.filter((pitch) => !isOnBassStaff(pitch, hasBass));

    const haloGroup = create('g', { class: 'score-current-halo', visibility: 'hidden' });
    pitches.forEach((pitch) => {
      haloGroup.append(create('circle', {
        cx: x,
        cy: noteY(pitch.pitch, isOnBassStaff(pitch, hasBass)),
        r: 22,
        fill: 'rgba(215,168,75,0.18)',
      }));
    });
    eventGroup.append(haloGroup);

    drawEventOnStaff(eventGroup, treble, x, false);
    drawEventOnStaff(eventGroup, bass, x, true);

    track.append(eventGroup);
    runningBeat += Number(event.duration) || 0;
  });

  if (song.notes.length) {
    const finalX = NOTE_START_X + (song.notes.length - 1) * NOTE_SPACING + 34;
    track.append(create('line', {
      class: 'score-barline score-final-barline',
      x1: finalX,
      y1: TREBLE_TOP,
      x2: finalX,
      y2: barBottom,
      stroke: '#172033',
      'stroke-width': 3,
    }));
  }

  return svg;
}

function updateScoreState(svg, song, currentIndex, { immediate = false } = {}) {
  const completedAll = currentIndex >= song.notes.length;
  const bounds = scoreVerticalBounds(song, currentIndex);
  svg.setAttribute('viewBox', `${SCORE_VIEW_X} ${bounds.minY} ${SCORE_VIEW_WIDTH} ${bounds.height}`);
  // O fundo acompanha o enquadramento para não sobrar faixa transparente.
  const background = svg.querySelector('.score-background');
  if (background) {
    background.setAttribute('y', String(bounds.minY));
    background.setAttribute('height', String(bounds.height));
  }
  let groups = SCORE_EVENT_GROUPS.get(svg);
  if (!groups) {
    groups = [...svg.querySelectorAll('.score-event')];
    SCORE_EVENT_GROUPS.set(svg, groups);
  }
  const previousIndex = Number.isInteger(Number(svg.dataset.currentIndex))
    ? Number(svg.dataset.currentIndex)
    : null;
  svg.dataset.currentIndex = String(currentIndex);
  scoreIndexesToRefresh(groups.length, previousIndex, currentIndex).forEach((groupIndex) => {
    const group = groups[groupIndex];
    if (!group) return;
    const eventIndex = Number(group.dataset.index);
    const isCurrent = !completedAll && eventIndex === currentIndex;
    const isCompleted = completedAll || eventIndex < currentIndex;
    const color = isCurrent ? '#d7a84b' : isCompleted ? '#177a4b' : '#172033';
    group.style.color = color;
    group.querySelector('.score-current-halo')?.setAttribute('visibility', isCurrent ? 'visible' : 'hidden');
    group.querySelectorAll('[data-finger]').forEach((finger) => {
      finger.setAttribute('fill', isCurrent ? '#8b650f' : '#667085');
    });
  });

  const track = svg.querySelector('.score-track');
  if (!track) return;
  const targetX = scoreTranslateXForIndex(song, currentIndex);
  if (immediate) {
    const activeFrame = TRACK_ANIMATIONS.get(track);
    if (activeFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(activeFrame);
    TRACK_ANIMATIONS.delete(track);
    setTrackTranslate(track, targetX);
  } else {
    animateTrackTo(track, targetX);
  }
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

function drawBassClef(svg, x) {
  const { fLineY, dotYs } = bassClefGeometry();
  const group = create('g', {
    class: 'bass-clef',
    'data-f-line-y': fLineY,
    fill: 'none',
    stroke: '#172033',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  group.append(create('ellipse', {
    cx: x + 4,
    cy: fLineY,
    rx: 7,
    ry: 6,
    fill: '#172033',
    stroke: 'none',
  }));
  group.append(create('path', {
    d: `M ${x + 5} ${fLineY - 6}
        C ${x + 28} ${fLineY - 22}, ${x + 42} ${fLineY - 7}, ${x + 34} ${fLineY + 11}
        C ${x + 29} ${fLineY + 23}, ${x + 18} ${fLineY + 31}, ${x - 2} ${fLineY + 39}
        C ${x + 13} ${fLineY + 27}, ${x + 23} ${fLineY + 15}, ${x + 25} ${fLineY + 4}
        C ${x + 27} ${fLineY - 5}, ${x + 18} ${fLineY - 12}, ${x + 5} ${fLineY - 6}`,
    'stroke-width': 4.8,
  }));
  dotYs.forEach((cy) => {
    group.append(create('circle', {
      cx: x + 47,
      cy,
      r: 3.4,
      fill: '#172033',
      stroke: 'none',
    }));
  });
  svg.append(group);
}

const ACCIDENTAL_SYMBOL = { '#': '♯', b: '♭', '##': '𝄪', x: '𝄪', bb: '𝄫' };

function drawAccidental(parent, pitch, x, y) {
  const symbol = ACCIDENTAL_SYMBOL[parsePitch(pitch)?.accidental];
  if (!symbol) return;
  parent.append(create('text', { x, y, 'font-size': 22, fill: 'currentColor' }, symbol));
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

function noteY(pitch, isBass = false) {
  const step = diatonicStep(pitch);
  if (isBass) {
    const g2 = diatonicStep('G2');
    return BASS_TOP + 48 - (step - g2) * STEP;
  }
  const e4 = diatonicStep('E4');
  return TREBLE_TOP + 48 - (step - e4) * STEP;
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
