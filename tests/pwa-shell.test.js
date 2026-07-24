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
    "onset-engine.js",
    "timing-evaluator.js",
    "rhythm-exercises.js",
    "document-viewer.js",
    "pdf.min.mjs",
    "pdf.worker.min.mjs",
    "opensheetmusicdisplay.min.js",
  ]) {
    assert.match(worker, new RegExp(asset.replaceAll(".", "\\.")));
  }
  assert.match(worker, /partitura-viva-v1-104/);
});

test("interface é centrada em repertório, importação e partitura", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /id="libraryView"/);
  assert.match(html, /id="importView"/);
  assert.match(html, /id="practiceView"/);
  assert.match(html, /accept="[^"]*\.pdf/);
  assert.match(html, /MusicXML/);
  assert.doesNotMatch(html, /Catálogo/);
});
