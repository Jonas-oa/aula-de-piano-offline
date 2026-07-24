import test from "node:test";
import assert from "node:assert/strict";
import { extractMusicXml } from "../src/core/omr-vision.js";

const SAMPLE = '<?xml version="1.0"?><score-partwise version="3.1"><part id="P1"></part></score-partwise>';

test("extrai MusicXML puro", () => {
  const xml = extractMusicXml(SAMPLE);
  assert.match(xml, /<score-partwise/);
  assert.match(xml, /<\/score-partwise>$/);
});

test("remove cercas de código e prosa ao redor", () => {
  const wrapped = "Claro! Aqui está:\n```xml\n" + SAMPLE + "\n```\nEspero ajudar.";
  const xml = extractMusicXml(wrapped);
  assert.ok(xml.startsWith("<?xml"), "mantém a declaração xml");
  assert.match(xml, /<\/score-partwise>$/);
  assert.doesNotMatch(xml, /Claro|Espero|```/);
});

test("aceita score-timewise", () => {
  const timewise = "<score-timewise><part id=\"P1\"></part></score-timewise>";
  const xml = extractMusicXml(timewise);
  assert.match(xml, /^<score-timewise/);
});

test("erro quando não há MusicXML", () => {
  assert.throws(() => extractMusicXml("Não consegui ler a partitura."), /reconhecível/);
});

test("erro quando a resposta é vazia", () => {
  assert.throws(() => extractMusicXml("   "), /não retornou conteúdo/);
});
