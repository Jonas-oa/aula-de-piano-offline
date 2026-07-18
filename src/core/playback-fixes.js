import { catalog } from '../data/catalog.js';
import { DemoSynth } from './audio-engine.js';

const PATCH_FLAG = Symbol.for('aula-piano.demo-duration-patch');
const MIN_PIANO_DURATION_SECONDS = 0.72;
const MAX_SUSTAIN_EXTRA_SECONDS = 0.48;

let demoSession = null;
let manualInputUntil = 0;

/**
 * Calcula a duração audível de uma nota individual dentro de um evento.
 * O passo do evento pode ser curto (próximo ataque da melodia), enquanto uma
 * nota grave permanece sustentada por vários tempos.
 */
export function demoPitchDurationSeconds(song, eventIndex, pitchIndex = 0, scale = 0.82) {
  const event = song?.notes?.[eventIndex];
  if (!event || !Number.isFinite(Number(song?.bpm)) || Number(song.bpm) <= 0) return null;

  const pitches = event.pitches || [event];
  const pitch = pitches[pitchIndex] || pitches.at(-1) || event;
  const beats = Number(pitch.duration ?? event.duration);
  if (!Number.isFinite(beats) || beats <= 0) return null;

  const secondsPerBeat = 60 / Number(song.bpm);
  return Math.max(0.18, secondsPerBeat * beats * scale);
}

/**
 * Acrescenta uma cauda musical ao som. Notas rápidas continuam articuladas,
 * mas não são cortadas de forma seca; notas longas mantêm sua proporção.
 */
export function sustainedPianoDurationSeconds(durationSeconds) {
  const base = Number(durationSeconds);
  if (!Number.isFinite(base) || base <= 0) return MIN_PIANO_DURATION_SECONDS;
  const extra = Math.min(MAX_SUSTAIN_EXTRA_SECONDS, 0.24 + base * 0.18);
  return Math.max(MIN_PIANO_DURATION_SECONDS, base + extra);
}

function songFromPracticeView() {
  const title = document.getElementById('practiceTitle')?.textContent?.trim();
  if (!title) return null;
  return catalog.find((song) => song.title === title) || null;
}

function currentEventIndex() {
  const label = document.getElementById('scoreProgress')?.textContent || '';
  const match = /Nota\s+(\d+)\s+de/i.exec(label);
  return match ? Math.max(0, Number(match[1]) - 1) : 0;
}

function beginDemoSession() {
  const song = songFromPracticeView();
  if (!song) {
    demoSession = null;
    return;
  }

  demoSession = {
    song,
    eventIndex: currentEventIndex(),
    pitchIndex: 0,
  };
}

function advanceDemoCursor() {
  if (!demoSession) return;
  const event = demoSession.song.notes[demoSession.eventIndex];
  const pitchCount = (event?.pitches || (event ? [event] : [])).length;
  demoSession.pitchIndex += 1;

  if (!pitchCount || demoSession.pitchIndex >= pitchCount) {
    demoSession.eventIndex += 1;
    demoSession.pitchIndex = 0;
  }
}

function installDemoDurationPatch() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (DemoSynth.prototype[PATCH_FLAG]) return;

  const originalPlayFrequency = DemoSynth.prototype.playFrequency;

  DemoSynth.prototype.playFrequency = function patchedPlayFrequency(
    frequency,
    durationSeconds = 0.45,
    gainValue = 0.12,
  ) {
    const now = performance.now();
    let resolvedDuration = durationSeconds;

    // A sessão é iniciada no clique capturado antes do controlador principal.
    // Não dependemos do instante em que o botão recebe disabled, evitando que a
    // primeira nota seja executada sem a duração individual correta.
    if (demoSession && now >= manualInputUntil) {
      const individualDuration = demoPitchDurationSeconds(
        demoSession.song,
        demoSession.eventIndex,
        demoSession.pitchIndex,
      );
      if (individualDuration !== null) resolvedDuration = individualDuration;
      advanceDemoCursor();
    }

    resolvedDuration = sustainedPianoDurationSeconds(resolvedDuration);
    return originalPlayFrequency.call(this, frequency, resolvedDuration, gainValue);
  };

  Object.defineProperty(DemoSynth.prototype, PATCH_FLAG, {
    configurable: false,
    enumerable: false,
    value: true,
  });

  // Captura antes do controlador principal iniciar a demonstração.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('#demoButton') : null;
    if (target && !target.disabled) beginDemoSession();
  }, true);

  // Uma tecla tocada manualmente durante a demonstração não deve consumir a
  // posição da fila de notas da reprodução automática.
  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.piano-key') : null;
    if (target) manualInputUntil = performance.now() + 160;
  }, true);

  const demoButton = document.getElementById('demoButton');
  if (demoButton) {
    new MutationObserver(() => {
      if (!demoButton.disabled) demoSession = null;
    }).observe(demoButton, { attributes: true, attributeFilter: ['disabled'] });
  }
}

installDemoDurationPatch();
