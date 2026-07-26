import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shell offline inclui leitores, biblioteca e avaliador rítmico", () => {
  const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  for (const asset of [
    "library-store.js",
    "musicxml.js",
    "musicxml-export.js",
    "onset-engine.js",
    "piano-playback-engine.js",
    "piano-recognition-engine.js",
    "timing-evaluator.js",
    "rhythm-exercises.js",
    "document-viewer.js",
    "piano-keyboard.js",
    "pdf.min.mjs",
    "pdf.worker.min.mjs",
  ]) {
    assert.match(worker, new RegExp(asset.replaceAll(".", "\\.")));
  }
  assert.match(worker, /partitura-viva-v1-119/);
});

test("o shell não carrega mais o leitor OpenSheetMusicDisplay", () => {
  // A pauta é desenhada pelo renderizador SVG próprio; o OSMD saiu do projeto.
  for (const file of ["sw.js", "index.html"]) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, file), "utf8"),
      /opensheetmusicdisplay/i,
    );
  }
  assert.equal(fs.existsSync(path.join(root, "vendor/osmd")), false);
});

test("interface é centrada em repertório, MusicXML e partitura", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /id="libraryView"/);
  assert.match(html, /id="importView"/);
  assert.match(html, /id="practiceView"/);
  assert.match(html, /accept="[^"]*\.musicxml/);
  assert.doesNotMatch(html, /accept="[^"]*\.pdf/);
  assert.match(html, /MusicXML/);
  assert.match(html, /id="rhythmPanel"/);
  assert.doesNotMatch(html, /<details id="rhythmPanel"[^>]*\sopen(?:\s|>)/);
  assert.match(html, /id="topbarToggleButton"/);
  assert.match(html, /id="bottombarToggleButton"/);
  assert.match(html, /id="pianoKeyboard"/);
  assert.match(html, /id="playbackControls"/);
  assert.match(html, /id="playbackToggleButton"/);
  assert.match(html, /id="practicePrimaryActions"/);
  assert.match(html, /Arraste a pauta · segure para marcar A–B/);
  assert.equal((html.match(/data-view-target="importView"/g) || []).length, 1);
  assert.equal((html.match(/Adicionar partitura/g) || []).length, 1);
  assert.doesNotMatch(html, /Catálogo/);
});

test("modo de estudo amplia a pauta e mantém ferramentas nas laterais", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.doesNotMatch(css, /\.document-stage svg\[data-score-key\]\s*\{[^}]*scale\(/s);
  assert.match(css, /\.practice-topbar\s*\{[^}]*left:\s*3px/s);
  assert.match(css, /\.practice-bottombar\s*\{[^}]*right:\s*3px/s);
  assert.match(css, /\.practice-workspace\s*\{[^}]*inset:\s*3px 34px/s);
  assert.match(css, /\.tempo-chip\.is-expanded\s*\{[^}]*width:\s*min\(460px/s);
  assert.match(css, /\.practice-primary-actions\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.practice-primary-actions\s*\{[^}]*top:\s*max\(8px/s);
  assert.match(css, /\.document-stage svg\[data-score-key\]\s*\{[^}]*touch-action:\s*none/s);
});

test("audição fica integrada à tela de estudo", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  assert.doesNotMatch(app, /listen-piece-button/);
  assert.doesNotMatch(app, /sessionMode/);
  assert.match(app, /playbackControls"\)\.hidden = false/);
  assert.match(app, /documentStage"\)\.addEventListener\("pointerdown", beginScoreGesture\)/);
  assert.match(app, /SCORE_LONG_PRESS_MS = 430/);
});

test("estudo solicita tela cheia e o PWA prioriza modo imersivo", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"),
  );

  assert.match(app, /requestFullscreen/);
  assert.match(app, /navigationUI: "hide"/);
  assert.match(app, /screen\.orientation\?\.lock\?\.\("landscape"\)/);
  assert.deepEqual(manifest.display_override, ["fullscreen", "standalone"]);
});
