import { diatonicStep, noteToMidi, parsePitch } from '../core/music.js';

const NS = 'http://www.w3.org/2000/svg';

// Geometria das pautas (coordenadas do viewBox)
const TREBLE_TOP = 80;
const BASS_TOP = 180;
const STEP = 6;
const SCORE_VIEW_X = 20;
// A janela anterior tinha 900 unidades. Com 1.280, a notação aparece com
// aproximadamente 70% do tamanho anterior e revela cerca de 40% mais pauta,
// sem reduzir a distância musical segura entre ataques.
export const SCORE_VIEW_WIDTH = 1280;
const SCORE_RIGHT_X = SCORE_VIEW_X + SCORE_VIEW_WIDTH;
const SCORE_WIDTH = SCORE_RIGHT_X;
const STAFF_START_X = 55;
const STAFF_RIGHT_GUTTER = 45;
const STAFF_WIDTH = SCORE_RIGHT_X - STAFF_START_X - STAFF_RIGHT_GUTTER;
const SCORE_CLIP_X = 145;
const SCORE_CLIP_RIGHT_GUTTER = 40;
const SCORE_CLIP_WIDTH = SCORE_RIGHT_X - SCORE_CLIP_X - SCORE_CLIP_RIGHT_GUTTER;
const NOTE_START_X = 180;
const BEAT_SPACING = 88;
// Colcheias e semicolcheias não podem herdar uma distância tão pequena que
// cabeças, acidentes, hastes e bandeirolas se sobreponham. A pauta continua
// proporcional ao tempo, mas cada novo ataque recebe esta largura mínima.
export const MIN_EVENT_SPACING = 62;
const PLAYHEAD_X = 310;
const VISIBLE_NOTE_COUNT = 15;
const SCROLL_DURATION_MS = 280;
const TRACK_ANIMATIONS = new WeakMap();
const SCORE_EVENT_GROUPS = new WeakMap();
const SCORE_BEAT_LAYOUTS = new WeakMap();
const STAFF_LINE_SPACING = 12;
const BEAM_LEVEL_GAP = 8;
const BEAM_THICKNESS = 6;

// A mão vem do <staff> do MusicXML quando existe. O corte pelo dó central é só
// o palpite de reserva: com ele, uma nota grave da mão direita (ou aguda da
// esquerda) ia parar na clave errada.
export function isOnBassStaff(pitch, hasBass) {
  if (!hasBass) return false;
  if (pitch?.clef === 'bass') return true;
  if (pitch?.clef === 'treble') return false;
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
  const currentX = scoreEventX(song, visualIndex);
  return Math.min(0, PLAYHEAD_X - currentX);
}

function eventBeat(event, index) {
  return Number.isFinite(Number(event?.beat)) ? Number(event.beat) : index;
}

function scoreBeatLayout(song) {
  if (!song || typeof song !== 'object') return null;
  const cached = SCORE_BEAT_LAYOUTS.get(song);
  if (cached) return cached;

  const beats = [];
  const positions = [];
  for (const [index, event] of (song.notes || []).entries()) {
    const beat = Math.max(0, eventBeat(event, index));
    if (!beats.length) {
      beats.push(beat);
      positions.push(NOTE_START_X + beat * BEAT_SPACING);
      continue;
    }
    const previousBeat = beats.at(-1);
    if (Math.abs(beat - previousBeat) < 1e-7) continue;
    const rhythmicDistance = Math.max(0, beat - previousBeat) * BEAT_SPACING;
    beats.push(beat);
    positions.push(positions.at(-1) + Math.max(MIN_EVENT_SPACING, rhythmicDistance));
  }

  const layout = { beats, positions };
  SCORE_BEAT_LAYOUTS.set(song, layout);
  return layout;
}

// Converte qualquer posição temporal (nota, pausa ou barra de compasso) para a
// mesma malha visual. Entre dois ataques a interpolação mantém a proporção; nos
// trechos densos a malha se expande para proteger a leitura.
export function scoreXForBeat(beat, song = null) {
  const value = Math.max(0, Number(beat) || 0);
  const layout = scoreBeatLayout(song);
  if (!layout?.beats.length) return NOTE_START_X + value * BEAT_SPACING;

  const { beats, positions } = layout;
  if (value <= beats[0]) {
    return positions[0] - (beats[0] - value) * BEAT_SPACING;
  }
  const last = beats.length - 1;
  if (value >= beats[last]) {
    return positions[last] + (value - beats[last]) * BEAT_SPACING;
  }

  let low = 0;
  let high = last;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (beats[middle] <= value) low = middle;
    else high = middle;
  }
  const progress = (value - beats[low]) / Math.max(1e-7, beats[high] - beats[low]);
  return positions[low] + (positions[high] - positions[low]) * progress;
}

export function scoreEventX(song, index) {
  return scoreXForBeat(eventBeat(song?.notes?.[index], index), song);
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

export function scoreAccessibleLabel(song) {
  const noteCount = song?.notes?.length || 0;
  const signature = timeSignatureLabel(song);
  return [
    `Partitura de ${song?.title || 'peça sem título'}`,
    signature ? `compasso ${signature}` : '',
    `${noteCount} ${noteCount === 1 ? 'ataque' : 'ataques'}`,
    song?.clef === 'grand' ? 'em duas claves' : '',
  ].filter(Boolean).join(', ');
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
    symbol: '𝄢',
    symbolX: 61,
    symbolY: BASS_TOP + 57,
    fontSize: 68,
  };
}

export function scoreIndexForDrag(startIndex, deltaClientX, svgWidth, noteCount, song = null) {
  const total = Math.max(0, Number(noteCount) || song?.notes?.length || 0);
  if (!total) return 0;
  const width = Math.max(1, Number(svgWidth) || 1);
  const scoreUnitsPerPixel = SCORE_VIEW_WIDTH / width;
  if (song?.notes?.length) {
    const start = Math.max(0, Math.min(total - 1, Number(startIndex) || 0));
    const targetX = scoreEventX(song, start)
      - (Number(deltaClientX) || 0) * scoreUnitsPerPixel;
    return nearestScoreIndex(song, targetX);
  }
  const movedNotes = Math.round(
    (Number(deltaClientX) || 0) * scoreUnitsPerPixel / BEAT_SPACING,
  );
  return Math.max(0, Math.min(total - 1, Number(startIndex) - movedNotes));
}

function nearestScoreIndex(song, scoreX) {
  const notes = song?.notes || [];
  if (!notes.length) return 0;
  let low = 0;
  let high = notes.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (scoreEventX(song, middle) < scoreX) low = middle + 1;
    else high = middle;
  }
  if (low > 0) {
    const before = scoreEventX(song, low - 1);
    const after = scoreEventX(song, low);
    if (Math.abs(scoreX - before) <= Math.abs(after - scoreX)) return low - 1;
  }
  return low;
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
  return nearestScoreIndex(song, localX - translateX);
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

// Faixa do trecho selecionado, desenhada dentro do track para rolar com as notas.
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
  const xA = scoreEventX(song, a) - 34;
  const xB = scoreEventX(song, b) + 34;
  const group = create('g', {
    class: 'score-loop',
    'data-start-index': a,
    'data-end-index': b,
    role: 'group',
    'aria-label': `Trecho selecionado entre os eventos ${a + 1} e ${b + 1}`,
  });
  group.append(create('rect', {
    x: xA, y: 60, width: Math.max(0, xB - xA), height: bottom - 60, rx: 8,
    fill: 'rgba(215,168,75,0.15)',
  }));
  [
    [xA, 'a', 'I', 'início'],
    [xB, 'b', 'F', 'fim'],
  ].forEach(([x, point, label, description]) => {
    const handle = create('g', {
      class: 'score-loop-handle',
      'data-loop-point': point,
      role: 'button',
      'aria-label': `Mover ${description} do trecho`,
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
    // `presentation` escondia a partitura inteira de quem usa leitor de tela:
    // não sobrava nada além dos botões. Como imagem rotulada, ao menos a peça,
    // a fórmula de compasso e o tamanho do trecho são anunciados.
    role: 'img',
    'aria-label': scoreAccessibleLabel(song),
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
    class: 'score-clip-window',
    x: SCORE_CLIP_X,
    y: -400,
    width: SCORE_CLIP_WIDTH,
    height: 1000,
  }));
  defs.append(clipPath);
  svg.append(defs);

  drawStaff(svg, STAFF_START_X, TREBLE_TOP, STAFF_WIDTH);
  svg.append(create('text', {
    x: 63,
    y: 135,
    'font-size': 64,
    'font-family': 'serif',
    fill: '#172033',
  }, '𝄞'));

  if (hasBass) {
    drawStaff(svg, STAFF_START_X, BASS_TOP, STAFF_WIDTH);
    drawBassClef(svg);
    svg.append(create('line', {
      x1: 55,
      y1: TREBLE_TOP,
      x2: 55,
      y2: BASS_TOP + 48,
      stroke: '#172033',
      'stroke-width': 2,
    }));
  }

  drawKeySignature(svg, song, false);
  if (hasBass) drawKeySignature(svg, song, true);

  svg.append(create('text', {
    class: 'score-headline',
    x: 60,
    y: 50,
    'font-size': 14,
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
  const hasMeasureTimeline = Boolean(song.measures?.length);
  const hasMeasureInformation = hasMeasureTimeline
    || song.notes.some((event) => Number.isInteger(event.measureIndex));
  const pickupOffset = song.pickupBeats && beatsPerBar > 0
    ? beatsPerBar - Number(song.pickupBeats)
    : 0;
  let runningBeat = pickupOffset;

  if (hasMeasureTimeline) {
    song.measures.forEach((measure, measureIndex) => {
      const boundaryX = scoreXForBeat(measure.beat, song) - 34;
      track.append(create('line', {
        class: 'score-barline',
        'data-measure': measure.number || measure.index + 1,
        x1: boundaryX,
        y1: TREBLE_TOP,
        x2: boundaryX,
        y2: barBottom,
        stroke: '#667085',
        'stroke-width': 2,
      }));
      const previousSignature = song.measures[measureIndex - 1]?.timeSignature
        || song.timeSignature;
      if (
        measureIndex > 0
        && measure.timeSignature
        && measure.timeSignature !== previousSignature
      ) {
        for (const isBass of hasBass ? [false, true] : [false]) {
          track.append(create('text', {
            class: 'score-time-change',
            x: boundaryX + 9,
            y: (isBass ? BASS_TOP : TREBLE_TOP) + 31,
            'font-size': 18,
            'font-weight': 800,
            fill: '#172033',
          }, measure.timeSignature));
        }
      }
    });
  }

  for (const rest of song.rests || []) {
    drawRest(
      track,
      rest,
      scoreXForBeat(rest.beat, song),
      isOnBassStaff(rest, hasBass),
    );
  }

  const previousClefs = new Map();
  const stemGeometries = [];
  song.notes.forEach((event, index) => {
    const x = scoreEventX(song, index);
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
    if (!hasMeasureTimeline && crossesBar) {
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
    for (const pitch of pitches) {
      if (!pitch.clef) continue;
      const key = `${pitch.partIndex ?? 0}:${pitch.staff ?? 1}`;
      const previous = previousClefs.get(key);
      if (previous && previous !== pitch.clef) {
        eventGroup.append(create('text', {
          class: 'score-clef-change',
          x: x - 29,
          y: (pitch.clef === 'bass' ? BASS_TOP : TREBLE_TOP) + 39,
          'font-size': 32,
          'font-family': 'serif',
          fill: '#172033',
        }, pitch.clef === 'bass' ? '𝄢' : '𝄞'));
      }
      previousClefs.set(key, pitch.clef);
    }
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

    for (const [isBass, staffPitches] of [[false, treble], [true, bass]]) {
      const voiceGroups = groupPitchesByVoice(staffPitches);
      for (const voicePitches of voiceGroups) {
        const geometry = drawEventOnStaff(
          eventGroup,
          voicePitches,
          x,
          isBass,
          voiceGroups.length > 1,
          { song, beat: Number(event.beat) || 0 },
        );
        if (geometry) {
          stemGeometries.push({
            ...geometry,
            beat: Number(event.beat) || 0,
            measureIndex: event.measureIndex,
            eventIndex: index,
            eventGroup,
            isBass,
            voiceKey: notationVoiceKey(voicePitches[0]),
          });
        }
      }
    }

    track.append(eventGroup);
    runningBeat += Number(event.duration) || 0;
  });

  drawBeams(withAutomaticBeams(stemGeometries, song));

  if (song.notes.length) {
    const lastMeasure = song.measures?.at(-1);
    const finalX = lastMeasure
      ? scoreXForBeat(lastMeasure.beat + lastMeasure.duration, song) - 34
      : scoreEventX(song, song.notes.length - 1) + 34;
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

function drawEventOnStaff(
  parent,
  pitches,
  x,
  isBass,
  hasMultipleVoices = false,
  { song = null, beat = 0 } = {},
) {
  if (!pitches.length) return null;
  const placed = pitches
    .map((pitch) => ({ ...pitch, y: noteY(pitch.pitch, isBass), step: diatonicStep(pitch.pitch) }))
    .sort((a, b) => a.y - b.y);

  placed.forEach((pitch) => drawLedgerLines(parent, x, pitch.y, isBass));

  const midStaffY = isBass ? BASS_TOP + 24 : TREBLE_TOP + 24;
  const meanY = placed.reduce((sum, pitch) => sum + pitch.y, 0) / placed.length;
  const explicitStem = placed.map((pitch) => pitch.stem).find((stem) =>
    stem === 'up' || stem === 'down');
  const voiceNumber = Number(String(placed[0]?.voice || '').split(':').at(-1));
  const voiceStemUp = Number.isInteger(voiceNumber) ? voiceNumber % 2 === 1 : null;
  const stemUp = explicitStem
    ? explicitStem === 'up'
    : hasMultipleVoices && voiceStemUp !== null
      ? voiceStemUp
      : meanY >= midStaffY;
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
      // A cabeça vazada é decidida pela figura escrita, não pela duração que
      // soa. Uma semínima ligada a outra soa dois tempos, mas continua sendo
      // semínima: preenchê-la pela duração desenhava uma mínima na pauta.
      fill: notationForPitch(pitch).base >= 2 ? '#fbfcfd' : 'currentColor',
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

  const shortest = placed.reduce((current, pitch) =>
    notationForPitch(pitch).base < notationForPitch(current).base ? pitch : current);
  const notation = notationForPitch(shortest);
  let stemLine = null;
  let tip = null;
  const flagElements = [];
  if (notation.base < 4) {
    const anchor = stemUp ? heads[heads.length - 1] : heads[0];
    tip = stemUp ? heads[0].y - 43 : heads[heads.length - 1].y + 43;
    stemLine = create('line', {
      class: 'score-stem',
      x1: stemX,
      y1: anchor.y,
      x2: stemX,
      y2: tip,
      stroke: 'currentColor',
      'stroke-width': 2.4,
    });
    parent.append(stemLine);
    for (let level = 1; level <= notation.flags; level += 1) {
      const flagY = tip + (stemUp ? (level - 1) * 9 : -(level - 1) * 9);
      const flagPath = stemUp
        ? `M ${stemX} ${flagY} Q ${stemX + 18} ${flagY + 9} ${stemX + 5} ${flagY + 23}`
        : `M ${stemX} ${flagY} Q ${stemX - 18} ${flagY - 9} ${stemX - 5} ${flagY - 23}`;
      const flagElement = create('path', {
        class: 'score-flag',
        d: flagPath,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2.4,
      });
      flagElements.push(flagElement);
      parent.append(flagElement);
    }
  }

  for (let dot = 0; dot < notation.dots; dot += 1) {
    parent.append(create('circle', {
      cx: x + 15 + dot * 7,
      cy: meanY - 3,
      r: 2.2,
      fill: 'currentColor',
    }));
  }

  for (const pitch of placed) {
    if (!pitch.tieStart) continue;
    // A ligadura termina onde a nota seguinte é desenhada. Medir em BEAT_SPACING
    // ignorava a compressão da malha adaptativa, e uma ligadura longa passava por
    // cima dos ataques seguintes em vez de alcançar apenas o próximo.
    const tiedX = scoreXForBeat(beat + Math.max(0, Number(pitch.duration) || 0), song);
    const endX = Math.max(x + 28, tiedX);
    const y = pitch.y + (stemUp ? 15 : -15);
    parent.append(create('path', {
      class: 'score-tie',
      d: `M ${x + 7} ${y} Q ${(x + endX) / 2} ${y + (stemUp ? 13 : -13)} ${endX - 7} ${y}`,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
    }));
  }

  return {
    beams: mergedBeams(placed),
    duration: Number(shortest.duration) || notation.base,
    flagElements,
    flags: notation.flags,
    stemLine,
    stemUp,
    stemX,
    tipY: tip,
  };
}

function notationVoiceKey(pitch) {
  return [
    pitch?.partIndex ?? 0,
    pitch?.voice || '1',
    pitch?.staff || 1,
    pitch?.clef || '',
  ].join(':');
}

function groupPitchesByVoice(pitches) {
  const groups = new Map();
  for (const pitch of pitches || []) {
    const key = notationVoiceKey(pitch);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pitch);
  }
  return [...groups.values()];
}

function mergedBeams(pitches) {
  const byLevel = new Map();
  for (const beam of (pitches || []).flatMap((pitch) => pitch.beams || [])) {
    const level = Number(beam?.number) || 1;
    if (!byLevel.has(level) && beam?.value) byLevel.set(level, beam.value);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, value]) => ({ number, value }));
}

export function explicitBeamRuns(nodes, level = 1) {
  const runs = [];
  let active = [];
  const flush = () => {
    if (active.length >= 2) runs.push({ type: 'run', nodes: active });
    active = [];
  };

  for (const node of nodes || []) {
    const value = (node.beams || []).find((beam) => beam.number === level)?.value || '';
    if (value === 'begin') {
      flush();
      active = [node];
    } else if (value === 'continue') {
      if (!active.length) active = [node];
      else active.push(node);
    } else if (value === 'end') {
      if (!active.length) active = [node];
      else active.push(node);
      flush();
    } else if (value === 'forward hook' || value === 'backward hook') {
      flush();
      runs.push({ type: value, nodes: [node] });
    } else {
      flush();
    }
  }
  flush();
  return runs;
}

export function beamLineGeometry(nodes) {
  if (!nodes?.length) return [];
  if (nodes.length === 1) return [{ ...nodes[0], beamY: nodes[0].tipY }];
  const first = nodes[0];
  const last = nodes.at(-1);
  const dx = Math.max(1, last.stemX - first.stemX);
  const rawSlope = (last.tipY - first.tipY) / dx;
  const slope = Math.max(-0.18, Math.min(0.18, rawSlope));
  const raw = nodes.map((node) =>
    first.tipY + (node.stemX - first.stemX) * slope);
  const offsets = nodes.map((node, index) => node.tipY - raw[index]);
  const shift = first.stemUp ? Math.min(...offsets) : Math.max(...offsets);
  return nodes.map((node, index) => ({ ...node, beamY: raw[index] + shift }));
}

function streamKey(stem) {
  return `${stem.voiceKey}:${stem.isBass ? 'bass' : 'treble'}`;
}

function streamsFromStems(stems) {
  const streams = new Map();
  for (const stem of stems) {
    if (!stem.stemLine || stem.tipY == null) continue;
    const key = streamKey(stem);
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key).push(stem);
  }
  for (const stream of streams.values()) {
    stream.sort((a, b) => a.beat - b.beat || a.eventIndex - b.eventIndex);
  }
  return streams;
}

function drawBeams(stems) {
  const streams = streamsFromStems(stems);
  for (const stream of streams.values()) {
    const maxLevel = Math.max(0, ...stream.flatMap((stem) =>
      stem.beams.map((beam) => Number(beam.number) || 1)));
    for (let level = 1; level <= maxLevel; level += 1) {
      for (const run of explicitBeamRuns(stream, level)) {
        if (run.type === 'run') {
          run.nodes.forEach((node) => node.flagElements?.[level - 1]?.remove());
          drawBeamRun(run.nodes, level);
        } else {
          run.nodes[0].flagElements?.[level - 1]?.remove();
          drawBeamHook(run.nodes[0], level, run.type === 'forward hook');
        }
      }
    }
  }
}

function timeSignatureParts(signature) {
  const match = /^(\d+)\/(\d+)$/.exec(String(signature || ""));
  if (!match) return null;
  const beats = Number(match[1]);
  const beatType = Number(match[2]);
  return beats > 0 && beatType > 0 ? { beats, beatType } : null;
}

export function metricBeamPattern(signature) {
  const parts = timeSignatureParts(signature);
  if (!parts) return [];
  const { beats, beatType } = parts;
  const denominatorUnit = 4 / beatType;
  if (beatType === 8 && beats >= 6 && beats % 3 === 0) {
    return Array.from({ length: beats / 3 }, () => 3 * denominatorUnit);
  }
  const irregular = beatType === 8 && {
    5: [2, 3],
    7: [2, 2, 3],
    8: [3, 3, 2],
  }[beats];
  if (irregular) return irregular.map((count) => count * denominatorUnit);
  return Array.from({ length: beats }, () => denominatorUnit);
}

function measureForStem(node, song) {
  if (Number.isInteger(node.measureIndex)) {
    return song?.measures?.[node.measureIndex]
      || song?.measures?.find((measure) => measure.index === node.measureIndex)
      || null;
  }
  return null;
}

function metricGroupKey(node, song) {
  const measure = measureForStem(node, song);
  const signature = measure?.timeSignature || song?.timeSignature || "";
  const pattern = metricBeamPattern(signature);
  const fallbackLength = Number(measure?.beatsPerBar)
    || effectiveBeatsPerBar(song);
  const inferredMeasureIndex = Number.isInteger(node.measureIndex)
    ? node.measureIndex
    : fallbackLength > 0
      ? Math.floor((node.beat + 1e-7) / fallbackLength)
      : 0;
  const measureStart = Number.isFinite(Number(measure?.beat))
    ? Number(measure.beat)
    : inferredMeasureIndex * Math.max(0, fallbackLength);
  const relativeBeat = Math.max(0, node.beat - measureStart);
  if (!pattern.length) {
    return `${inferredMeasureIndex}:${Math.floor(relativeBeat + 1e-7)}`;
  }
  let boundary = 0;
  for (const [index, length] of pattern.entries()) {
    boundary += length;
    if (relativeBeat < boundary - 1e-7) {
      return `${inferredMeasureIndex}:${index}`;
    }
  }
  return `${inferredMeasureIndex}:${pattern.length - 1}`;
}

function assignAutomaticBeamLevel(run, level) {
  let eligible = [];
  const flush = () => {
    if (!eligible.length) return;
    if (eligible.length === 1) {
      const [{ node, index }] = eligible;
      node.beams.push({
        number: level,
        value: index < run.length - 1 ? 'forward hook' : 'backward hook',
      });
    } else {
      eligible.forEach(({ node }, index) => {
        node.beams.push({
          number: level,
          value: index === 0 ? 'begin' : index === eligible.length - 1 ? 'end' : 'continue',
        });
      });
    }
    eligible = [];
  };

  run.forEach((node, index) => {
    if (node.flags >= level) eligible.push({ node, index });
    else flush();
  });
  flush();
}

export function automaticBeamPlan(nodes, song) {
  const planned = (nodes || []).map((node) => ({
    ...node,
    beams: [...(node.beams || [])],
  }));
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const maxLevel = Math.max(...run.map((node) => node.flags || 0));
      for (let level = 1; level <= maxLevel; level += 1) {
        assignAutomaticBeamLevel(run, level);
      }
    }
    run = [];
  };

  for (const node of planned) {
    const previous = run.at(-1);
    const eligible = node.flags > 0 && node.beams.length === 0;
    const sameMetricGroup = previous
      && metricGroupKey(previous, song) === metricGroupKey(node, song);
    const expectedBeat = previous
      ? previous.beat + Math.max(0, Number(previous.duration) || 0)
      : node.beat;
    const consecutive = previous && Math.abs(node.beat - expectedBeat) <= 1e-4;
    if (!eligible || (previous && (!sameMetricGroup || !consecutive))) flush();
    if (eligible) run.push(node);
  }
  flush();
  return planned;
}

function withAutomaticBeams(stems, song) {
  const planned = [];
  for (const stream of streamsFromStems(stems).values()) {
    planned.push(...automaticBeamPlan(stream, song));
  }
  return planned;
}

function drawBeamRun(nodes, level) {
  const geometry = level > 1 && nodes.every((node) => node.primaryBeamY != null)
    ? nodes.map((node) => ({ ...node, beamY: node.primaryBeamY }))
    : beamLineGeometry(nodes);
  if (level === 1) {
    geometry.forEach((node, index) => {
      nodes[index].primaryBeamY = node.beamY;
      node.stemLine?.setAttribute('y2', String(node.beamY));
    });
  }
  const direction = geometry[0].stemUp ? 1 : -1;
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const from = geometry[index];
    const to = geometry[index + 1];
    from.eventGroup.append(create('line', {
      class: 'score-beam',
      'data-beam-level': level,
      x1: from.stemX,
      y1: from.beamY + direction * (level - 1) * BEAM_LEVEL_GAP,
      x2: to.stemX,
      y2: to.beamY + direction * (level - 1) * BEAM_LEVEL_GAP,
      stroke: 'currentColor',
      'stroke-width': BEAM_THICKNESS,
      'stroke-linecap': 'butt',
    }));
  }
}

function drawBeamHook(node, level, forward) {
  if (!node?.eventGroup) return;
  const direction = node.stemUp ? 1 : -1;
  const hookLength = 18 * (forward ? 1 : -1);
  const beamY = node.primaryBeamY ?? node.tipY;
  node.eventGroup.append(create('line', {
    class: 'score-beam score-beam-hook',
    'data-beam-level': level,
    x1: node.stemX,
    y1: beamY + direction * (level - 1) * BEAM_LEVEL_GAP,
    x2: node.stemX + hookLength,
    y2: beamY + direction * (level - 1) * BEAM_LEVEL_GAP,
    stroke: 'currentColor',
    'stroke-width': BEAM_THICKNESS,
    'stroke-linecap': 'butt',
  }));
}

const NOTE_TYPE_BASE = {
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
  '128th': 0.03125,
  '256th': 0.015625,
};

export function notationForPitch(pitch) {
  const base = NOTE_TYPE_BASE[pitch?.type];
  if (!base) return durationNotation(pitch?.duration);
  return {
    base,
    dots: Math.max(0, Number(pitch?.dotCount) || 0),
    flags: base < 1 ? Math.max(1, Math.round(Math.log2(1 / base))) : 0,
  };
}

export function durationNotation(duration) {
  const value = Math.max(1 / 64, Number(duration) || 1);
  const bases = [4, 2, 1, 0.5, 0.25, 0.125, 0.0625];
  let best = { base: 1, dots: 0, difference: Number.POSITIVE_INFINITY };
  for (const base of bases) {
    let factor = 1;
    for (let dots = 0; dots <= 2; dots += 1) {
      const candidate = base * factor;
      const difference = Math.abs(value - candidate);
      if (difference < best.difference) best = { base, dots, difference };
      factor += 1 / (2 ** (dots + 1));
    }
  }
  return {
    base: best.base,
    dots: best.dots,
    flags: best.base < 1 ? Math.max(1, Math.round(Math.log2(1 / best.base))) : 0,
  };
}

function drawRest(parent, rest, x, isBass) {
  const notation = durationNotation(rest.duration);
  const symbol = notation.base >= 4 ? '𝄻'
    : notation.base >= 2 ? '𝄼'
      : notation.base >= 1 ? '𝄽'
        : notation.base >= 0.5 ? '𝄾'
          : notation.base >= 0.25 ? '𝄿'
            : notation.base >= 0.125 ? '𝅀'
              : '𝅁';
  const y = (isBass ? BASS_TOP : TREBLE_TOP) + 30;
  const group = create('g', {
    class: 'score-rest',
    'data-beat': rest.beat,
  });
  group.append(create('text', {
    x,
    y,
    'text-anchor': 'middle',
    'font-size': 28,
    'font-family': 'serif',
    fill: '#667085',
  }, symbol));
  for (let dot = 0; dot < notation.dots; dot += 1) {
    group.append(create('circle', {
      cx: x + 13 + dot * 7,
      cy: y - 6,
      r: 2,
      fill: '#667085',
    }));
  }
  parent.append(group);
}

export function keySignaturePitches(fifths, isBass = false) {
  const count = Math.min(7, Math.abs(Number(fifths) || 0));
  if (!count) return [];
  const sharps = isBass
    ? ['F3', 'C3', 'G3', 'D3', 'A2', 'E3', 'B2']
    : ['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4'];
  const flats = isBass
    ? ['B2', 'E3', 'A2', 'D3', 'G2', 'C3', 'F2']
    : ['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4'];
  return (Number(fifths) > 0 ? sharps : flats).slice(0, count);
}

function drawKeySignature(svg, song, isBass) {
  const fifths = Number(song?.keyFifths) || 0;
  const symbol = fifths > 0 ? '♯' : '♭';
  keySignaturePitches(fifths, isBass).forEach((pitch, index) => {
    svg.append(create('text', {
      class: 'score-key-signature',
      x: 108 + index * 10,
      y: noteY(pitch, isBass) + 7,
      'font-size': 22,
      fill: '#172033',
    }, symbol));
  });
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

function drawBassClef(svg) {
  const {
    fLineY,
    symbol,
    symbolX,
    symbolY,
    fontSize,
  } = bassClefGeometry();
  const group = create('g', {
    class: 'bass-clef',
    'data-f-line-y': fLineY,
    fill: '#172033',
  });
  group.append(create('text', {
    class: 'bass-clef-symbol',
    x: symbolX,
    y: symbolY,
    'font-size': fontSize,
    'font-family': '"Noto Music", "Bravura Text", "Segoe UI Symbol", serif',
    fill: 'currentColor',
  }, symbol));
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

export function noteY(pitch, isBass = false) {
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
