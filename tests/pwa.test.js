import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('arquivos essenciais da PWA existem', () => {
  const required = [
    'index.html',
    'styles.css',
    'manifest.webmanifest',
    'sw.js',
    'src/app.js',
    'src/core/audio-engine.js',
    'src/core/music.js',
    'src/data/catalog.js',
    'src/ui/score-renderer.js',
    'src/ui/focus-mode.js',
    'assets/icons/icon-192.png',
    'assets/icons/icon-512.png',
  ];
  required.forEach((relative) => assert.ok(fs.existsSync(path.join(root, relative)), `Arquivo ausente: ${relative}`));
});

test('manifesto usa caminhos relativos compatíveis com GitHub Pages', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
});

test('service worker lista somente recursos existentes', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const match = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(match, 'APP_SHELL não encontrado');
  const entries = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  for (const entry of entries) {
    if (entry === './') continue;
    assert.ok(fs.existsSync(path.join(root, entry.replace(/^\.\//, ''))), `Recurso do cache ausente: ${entry}`);
  }
});


test('modo foco é carregado pelo renderizador de partitura', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/ui/score-renderer.js'), 'utf8');
  const focus = fs.readFileSync(path.join(root, 'src/ui/focus-mode.js'), 'utf8');
  assert.match(renderer, /focus-mode\.js/);
  assert.match(focus, /practice-focus/);
  assert.match(focus, /focusControlsButton/);
  assert.match(focus, /aria-expanded/);
});
