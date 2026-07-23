import test from "node:test";
import assert from "node:assert/strict";
import {
  getPublicDomainScore,
  getPublicDomainScoreByPdfHash,
  sha256Hex,
} from "../src/data/public-domain-scores.js";

const FUR_ELISE_PDF_SHA256 = "f356611307e9949b65a266ca1b91a110b9c32143be437213f2bdd63e082124e2";

test("reconhece exatamente o PDF de Für Elise enviado", () => {
  const score = getPublicDomainScoreByPdfHash(FUR_ELISE_PDF_SHA256);
  assert.equal(score.id, "beethoven-fur-elise-woo59-mutopia-931");
  assert.equal(score.title, "Für Elise");
  assert.equal(score.composer, "Ludwig van Beethoven");
  assert.equal(score.bpm, 72);
  assert.equal(score.timeSignature, "3/8");
  assert.equal(score.events.length, 660);
  assert.deepEqual(score.events[0], {
    beat: 0,
    duration: 0.25,
    midis: [76],
    pitches: ["E5"],
  });
  assert.deepEqual(score.events.at(-1).midis, [33, 45, 69]);
});

test("não associa PDFs desconhecidos a uma partitura", () => {
  assert.equal(getPublicDomainScoreByPdfHash("0".repeat(64)), null);
  assert.equal(getPublicDomainScore("desconhecida"), null);
});

test("calcula SHA-256 no navegador sem depender do nome do arquivo", async () => {
  const bytes = new TextEncoder().encode("abc");
  assert.equal(
    await sha256Hex(bytes),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
