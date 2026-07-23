import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shell offline inclui leitores, biblioteca e avaliador rítmico", () => {
  const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  for (const asset of [
    "library-store.js",
    "musicxml.js",
    "onset-engine.js",
    "study-display.js",
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
  assert.match(worker, /partitura-viva-v2-study-101/);
});

test("interface é centrada em repertório, importação e partitura", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /id="libraryView"/);
  assert.match(html, /id="importView"/);
  assert.match(html, /id="practiceView"/);
  assert.match(html, /accept="[^"]*\.pdf/);
  assert.match(html, /MusicXML/);
  assert.match(html, /id="studyKeyboard"/);
  assert.match(html, /id="microphoneStatus"/);
  assert.match(html, /id="fullscreenButton"/);
  assert.match(html, /id="rotateOverlay"/);
  assert.doesNotMatch(html, /Catálogo/);
});

test("PWA e modo de estudo priorizam a orientação horizontal", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");

  assert.equal(manifest.orientation, "landscape");
  assert.equal(manifest.display, "fullscreen");
  assert.match(css, /@media \(orientation: portrait\)/);
  assert.match(css, /body\.study-mode/);
  assert.match(app, /requestStudyDisplay\(\)/);
  assert.match(app, /activateMicrophone\(\)/);
  assert.match(app, /inspectPdfAsset/);
});

test("leitores de PDF e MusicXML estão completos e não truncados", () => {
  const expected = new Map([
    ["vendor/pdfjs/pdf.worker.min.mjs", "2ab9e09667296dab1a618868b3ce6e6c23d5b8f48120ae7c5b34e7e335ed01fa"],
    ["vendor/osmd/opensheetmusicdisplay.min.js", "4cd2b3c0458ecd7ead256cb26f976c5cf97b1bd1066045d9097f1bb97944d031"],
  ]);
  for (const [relativePath, checksum] of expected) {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    assert.ok(bytes.length > 1_200_000, `${relativePath} foi truncado`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), checksum);
  }
});
