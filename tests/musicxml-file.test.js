import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import { readMusicXmlFile } from "../src/core/musicxml-file.js";

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
