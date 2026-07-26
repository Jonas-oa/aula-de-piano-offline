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
    "piano-recognition-engine.js",
    "timing-evaluator.js",
    "rhythm-exercises.js",
    "document-viewer.js",
    "piano-keyboard.js",
    "pdf.min.mjs",
    "pdf.worker.min.mjs",
    "opensheetmusicdisplay.min.js",
  ]) {
    assert.match(worker, new RegExp(asset.replaceAll(".", "\\.")));
  }
  assert.match(worker, /partitura-viva-v1-113/);
});

test("interface é centrada em repertório, importação e partitura", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /id="libraryView"/);
  assert.match(html, /id="importView"/);
  assert.match(html, /id="practiceView"/);
  assert.match(html, /accept="[^"]*\.pdf/);
  assert.match(html, /MusicXML/);
  assert.match(html, /id="downloadMusicXmlButton"/);
  assert.match(html, /id="topbarToggleButton"/);
  assert.match(html, /id="bottombarToggleButton"/);
  assert.match(html, /id="pianoKeyboard"/);
  assert.doesNotMatch(html, /Catálogo/);
});

test("modo de estudo amplia a pauta e mantém barras recolhidas finas", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /\.document-stage svg\[data-score-key\]\s*\{[^}]*scale\(1\.68\)/s);
  assert.match(css, /\.practice-topbar\.is-collapsed\s*\{[^}]*min-height:\s*36px/s);
  assert.match(css, /\.practice-bottombar\.is-collapsed\s*\{[^}]*min-height:\s*30px/s);
});
