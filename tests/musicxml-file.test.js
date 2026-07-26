import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import { isMusicXmlFilename, readMusicXmlFile } from "../src/core/musicxml-file.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCORE = '<?xml version="1.0"?><score-partwise version="4.0"><part-list/></score-partwise>';
const CONTAINER = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="scores/main.musicxml"/></rootfiles></container>';

function zip(entries, { deflate = true } = {}) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name);
    const plain = Buffer.from(value);
    const compressed = deflate ? deflateRawSync(plain) : plain;
    const method = deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);

    localParts.push(local, nameBytes, compressed);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + compressed.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, central, end]);
}

test("lê MusicXML comum sem alterar o conteúdo", async () => {
  const result = await readMusicXmlFile({
    name: "peca.musicxml",
    bytes: Buffer.from(SCORE),
  });
  assert.equal(result, SCORE);
});

test("abre MXL deflate seguindo META-INF/container.xml", async () => {
  const bytes = zip([
    ["META-INF/container.xml", CONTAINER],
    ["scores/main.musicxml", SCORE],
    ["preview.xml", "<ignorar/>"],
  ]);
  const result = await readMusicXmlFile({ name: "peca.mxl", bytes });
  assert.equal(result, SCORE);
});

test("abre também MXL armazenado sem compressão", async () => {
  const bytes = zip([["partitura.xml", SCORE]], { deflate: false });
  assert.equal(await readMusicXmlFile({ name: "peca.mxl", bytes }), SCORE);
});

test("recusa um ZIP que não contém MusicXML", async () => {
  const bytes = zip([["leia-me.txt", "sem partitura"]]);
  await assert.rejects(
    readMusicXmlFile({ name: "invalido.mxl", bytes }),
    /não contém uma partitura/,
  );
});

test("todo formato que o leitor abre também passa na seleção de arquivos", async () => {
  // O `.mxl` já era descompactado pelo leitor, mas a tela de importação tinha a
  // própria expressão regular e o recusava antes de chegar aqui: o suporte
  // existia e era inalcançável. Amarrar as duas pontas na mesma função impede
  // que elas voltem a divergir.
  for (const name of ["peca.musicxml", "peca.MusicXML", "peca.xml", "peca.mxl", "peca.MXL"]) {
    assert.equal(isMusicXmlFilename(name), true, `${name} deveria ser aceito`);
  }
  for (const name of ["peca.pdf", "peca.mid", "peca", "peca.xml.txt", "", null]) {
    assert.equal(isMusicXmlFilename(name), false, `${name} não deveria ser aceito`);
  }

  // E o formato aceito na seleção é de fato abrível pelo leitor.
  const bytes = zip([["partitura.musicxml", SCORE]]);
  assert.equal(isMusicXmlFilename("peca.mxl"), true);
  assert.equal(await readMusicXmlFile({ name: "peca.mxl", bytes }), SCORE);
});

test("a importação não mantém a própria lista de extensões", () => {
  // Guarda contra a reincidência: qualquer regex de extensão solta em app.js
  // é uma segunda fonte de verdade esperando para sair de sincronia com o
  // leitor e com o `accept` do formulário.
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  assert.doesNotMatch(
    app,
    /\/\\\.\([^)]*(?:xml|mxl|pdf)[^)]*\)\$?\/[a-z]*/i,
    "use isMusicXmlFilename em vez de uma expressão regular local",
  );
  assert.match(app, /isMusicXmlFilename/);

  // O `accept` do formulário precisa cobrir os mesmos formatos.
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const accept = html.match(/accept="([^"]*)"/)?.[1] || "";
  for (const extension of [".xml", ".musicxml", ".mxl"]) {
    assert.ok(
      accept.split(",").includes(extension),
      `o formulário precisa oferecer ${extension}`,
    );
    assert.equal(isMusicXmlFilename(`peca${extension}`), true);
  }
});
