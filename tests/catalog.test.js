import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, lessons, getSong } from '../src/data/catalog.js';
import { noteToMidi, midiToNote } from '../src/core/music.js';
import { yinPitch } from '../src/core/audio-engine.js';
import { demoPitchDurationSeconds } from '../src/core/playback-fixes.js';
import { effectiveBeatsPerBar, timeSignatureLabel } from '../src/ui/score-renderer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('catálogo possui repertório inicial amplo e dividido por categoria', () => {
  assert.ok(catalog.length >= 30);
  assert.ok(catalog.filter((song) => song.category === 'classical').length >= 10);
  assert.ok(catalog.filter((song) => song.category === 'hymn').length >= 10);
  assert.ok(catalog.filter((song) => song.category === 'exercise').length >= 6);
});

test('todas as músicas possuem eventos, notas e parâmetros didáticos válidos', () => {
  const ids = new Set();
  for (const song of catalog) {
    assert.ok(!ids.has(song.id), `ID duplicado: ${song.id}`);
    ids.add(song.id);
    assert.ok(song.notes.length >= 16, `${song.id} tem poucas notas`);
    assert.ok(song.bpm >= 40 && song.bpm <= 180, `${song.id} tem BPM inválido`);
    assert.ok(song.difficulty >= 1 && song.difficulty <= 5);

    for (const event of song.notes) {
      assert.ok(event.duration > 0, `${song.id} contém evento sem duração`);
      const pitches = event.pitches || [event];
      assert.ok(pitches.length >= 1, `${song.id} contém evento vazio`);
      for (const pitch of pitches) {
        const midi = noteToMidi(pitch.pitch);
        assert.ok(Number.isInteger(midi), `${song.id}: nota inválida ${pitch.pitch}`);
        assert.ok(pitch.duration > 0, `${song.id}: duração inválida em ${pitch.pitch}`);
      }
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
  for (let i = 0; i < buffer.length; i += 1) {
    buffer[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  const result = yinPitch(buffer, sampleRate);
  assert.ok(result);
  assert.ok(Math.abs(result.frequency - 440) < 2, `Frequência: ${result.frequency}`);
});

test('dedilhado é correto ou omitido — nunca inventado', () => {
  const ode = getSong('ode-to-joy');
  assert.equal(ode.notes[0].finger, 3);
  assert.equal(ode.notes[2].finger, 4);
  assert.equal(ode.notes[3].finger, 5);
  assert.equal(ode.notes[8].finger, 1);

  const scale = getSong('exercise-c-scale');
  assert.deepEqual(scale.notes.slice(0, 8).map((note) => note.finger), [1, 2, 3, 1, 2, 3, 4, 5]);

  const elise = getSong('fur-elise');
  assert.ok(elise.notes.every((note) => !note.finger));
});

test('fórmulas de compasso e anacruse são resolvidas semanticamente', () => {
  assert.equal(effectiveBeatsPerBar(getSong('minuet-g')), 3);
  assert.equal(effectiveBeatsPerBar(getSong('fur-elise')), 1.5);
  assert.equal(timeSignatureLabel(getSong('fur-elise')), '3/8');

  const grace = getSong('amazing-grace');
  assert.equal(grace.pickupBeats, 1);
  assert.equal(effectiveBeatsPerBar(grace), 3);
});

test('acordes preservam duração individual e voz superior compatível', () => {
  const chords = getSong('exercise-c-chords');
  const first = chords.notes[0];
  assert.equal(first.pitches.length, 3);
  assert.deepEqual(first.pitches.map((note) => note.pitch), ['C4', 'E4', 'G4']);
  assert.ok(first.pitches.every((note) => note.duration === 2));
  assert.equal(first.pitch, 'G4');
  assert.equal(first.duration, 2);

  const ode = getSong('ode-to-joy-duas-maos');
  const opening = ode.notes[0];
  assert.deepEqual(opening.pitches.map((note) => note.pitch), ['C3', 'E4']);
  assert.equal(opening.duration, 1);
  assert.equal(opening.pitches[0].duration, 4);
  assert.ok(getSong('ode-to-joy').notes.every((note) => note.pitches.length === 1));
});

test('demonstração respeita sustain individual do baixo e da melodia', () => {
  const song = getSong('ode-to-joy-duas-maos');
  const bassSeconds = demoPitchDurationSeconds(song, 0, 0, 1);
  const melodySeconds = demoPitchDurationSeconds(song, 0, 1, 1);

  assert.ok(bassSeconds > melodySeconds);
  assert.ok(Math.abs(bassSeconds / melodySeconds - 4) < 0.001);
  assert.equal(demoPitchDurationSeconds(song, 999, 0), null);
});

test('renderizador possui pauta dupla, janela fixa e faixa rolante', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/ui/score-renderer.js'), 'utf8');
  assert.match(renderer, /BASS_TOP/);
  assert.match(renderer, /𝄢/);
  assert.match(renderer, /score-viewport/);
  assert.match(renderer, /score-track/);
  assert.match(renderer, /translateX\(/);
  assert.match(renderer, /song\.clef === 'grand'/);
});

test('melodias principais das aulas estão completas', () => {
  const beats = (song) => song.notes.reduce((sum, note) => sum + note.duration, 0);
  const ode = getSong('ode-to-joy');
  assert.equal(beats(ode), 64);
  assert.ok(ode.notes.some((note) => note.pitch === 'G3'));

  const grace = getSong('amazing-grace');
  assert.equal((beats(grace) - grace.pickupBeats) % effectiveBeatsPerBar(grace), 0);

  assert.ok(getSong('fur-elise').notes.length >= 80);
});

test('shell offline inclui os módulos adicionados na versão auditada', () => {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(worker, /aula-piano-v8-auditoria-033/);
  assert.match(worker, /src\/core\/playback-fixes\.js/);
  assert.match(index, /src\/core\/playback-fixes\.js/);
});
