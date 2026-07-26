import assert from "node:assert/strict";
import test from "node:test";
import { musicXmlBlob, musicXmlFilename } from "../src/core/musicxml-export.js";

test("gera nome MusicXML seguro a partir do arquivo original", () => {
  assert.equal(
    musicXmlFilename({ assetName: "../Minha: Peça.xml", title: "Ignorado" }),
    "Minha_ Peça.musicxml",
  );
  assert.equal(musicXmlFilename({ title: "Prelúdio nº 1" }), "Prelúdio no 1.musicxml");
});

test("gera arquivo MusicXML com o tipo correto", async () => {
  const xml = '<?xml version="1.0"?><score-partwise version="4.0"/>';
  const blob = musicXmlBlob({ bytes: new TextEncoder().encode(xml).buffer });
  assert.equal(blob.type, "application/vnd.recordare.musicxml+xml;charset=utf-8");
  assert.equal(await blob.text(), xml);
});

test("recusa exportação sem MusicXML", () => {
  assert.throws(() => musicXmlBlob(null), /não possui um arquivo MusicXML/i);
});
