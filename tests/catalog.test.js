import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, lessons, getSong } from '../src/data/catalog.js';
import { noteToMidi, midiToNote } from '../src/core/music.js';
import { yinPitch } from '../src/core/audio-engine.js';

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
