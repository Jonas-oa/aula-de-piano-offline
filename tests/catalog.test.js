import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, lessons, getSong } from '../src/data/catalog.js';
import { noteToMidi, midiToNote } from '../src/core/music.js';
import { yinPitch } from '../src/core/audio-engine.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('catálogo possui repertório inicial amplo e dividido por categoria', () => {
  assert.ok(catalog.length >= 30);
  assert.ok(catalog.filter((song) => song.category === 'classical').length >= 10);
  assert.ok(catalog.filter((song) => song.category === 'hymn').length >= 10);
  assert.ok(catalog.filter((song) => song.category === 'exercise').length >= 6);
});

test('todas as músicas possuem notas válidas e parâmetros didáticos', () => {
  const ids = new Set();
  for (const song of catalog) {
    assert.ok(!ids.has(song.id), `ID duplicado: ${song.id}`);
    ids.add(song.id);
    assert.ok(song.notes.length >= 16, `${song.id} tem poucas notas`);
    assert.ok(song.bpm >= 40 && song.bpm <= 180, `${song.id} tem BPM inválido`);
    assert.ok(song.difficulty >= 1 && song.difficulty <= 5);
    for (const note of song.notes) {
      const midi = noteToMidi(note.pitch);
      assert.ok(Number.isInteger(midi));
      assert.ok(note.duration > 0);
    }
  }
});

test('todas as aulas apontam para músicas existentes', () => {
  for (const lesson of lessons) {
    assert.equal(getSong(lesson.songId).id, lesson.songId);
  }
});

test('conversão MIDI é reversível para sustenidos', () => {
  for (let midi = 36; midi <= 96; midi += 1) {
    assert.equal(noteToMidi(midiToNote(midi)), midi);
  }
});

test('YIN reconhece uma onda senoidal de Lá 440 Hz', () => {
  const sampleRate = 48000;
  const buffer = new Float32Array(4096);
  for (let i = 0; i < buffer.length; i += 1) buffer[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  const result = yinPitch(buffer, sampleRate);
  assert.ok(result);
  assert.ok(Math.abs(result.frequency - 440) < 2, `Frequência: ${result.frequency}`);
});

test('dedilhado é correto ou omitido — nunca inventado', () => {
  const ode = getSong('ode-to-joy');
  // Ode à Alegria em posição de Dó: Mi=3, Fá=4, Sol=5, Ré=2, Dó=1
  assert.equal(ode.notes[0].finger, 3); // E4
  assert.equal(ode.notes[2].finger, 4); // F4
  assert.equal(ode.notes[3].finger, 5); // G4
  assert.equal(ode.notes[8].finger, 1); // C4

  // Escalas com dedilhado padrão de mão direita (passagem de polegar)
  const scale = getSong('exercise-c-scale');
  assert.deepEqual(scale.notes.slice(0, 8).map((n) => n.finger), [1, 2, 3, 1, 2, 3, 4, 5]);

  // Peças fora de posição fixa e sem dedilhado explícito não sugerem nada
  const elise = getSong('fur-elise');
  assert.ok(elise.notes.every((n) => !n.finger));
});

test('barras de compasso respeitam a fórmula de compasso', () => {
  assert.equal(getSong('minuet-g').beatsPerBar, 3);
  assert.equal(getSong('fur-elise').beatsPerBar, 0);
  const renderer = fs.readFileSync(path.join(root, 'src/ui/score-renderer.js'), 'utf8');
  assert.match(renderer, /x1: x - 34, y1: 80, x2: x - 34, y2: barBottom/);
  assert.match(renderer, /beatsPerBar/);
});

test('acordes: notação com +, herança de duração e voz superior compatível', () => {
  const chords = getSong('exercise-c-chords');
  const first = chords.notes[0];
  assert.equal(first.pitches.length, 3);
  assert.deepEqual(first.pitches.map((n) => n.pitch), ['C4', 'E4', 'G4']);
  assert.ok(first.pitches.every((n) => n.duration === 2)); // ':2' herdado pelo acorde todo
  assert.equal(first.pitch, 'G4'); // compatibilidade: voz superior
  assert.equal(first.duration, 2);

  const ode = getSong('ode-to-joy-duas-maos');
  const opening = ode.notes[0];
  assert.deepEqual(opening.pitches.map((n) => n.pitch), ['C3', 'E4']); // baixo + melodia
  assert.equal(opening.duration, 1); // passo do evento = próximo ataque da melodia
  assert.equal(opening.pitches[0].duration, 4); // baixo sustentado

  // Peças monofônicas seguem com um único pitch por evento
  assert.ok(getSong('ode-to-joy').notes.every((n) => n.pitches.length === 1));
});

test('renderizador desenha pauta dupla e divide no Dó central', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/ui/score-renderer.js'), 'utf8');
  assert.match(renderer, /BASS_TOP/);
  assert.match(renderer, /𝄢/);
  assert.match(renderer, /noteToMidi\(p\.pitch\) >= 60/);
  assert.match(renderer, /focusViewBox/);
});
