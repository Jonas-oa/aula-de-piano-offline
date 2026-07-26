const MXL_TYPE = "application/vnd.recordare.musicxml";
const MAX_MUSICXML_BYTES = 20 * 1024 * 1024;
const UTF8 = new TextDecoder("utf-8");

function asBytes(source) {
  if (source instanceof Uint8Array) return Promise.resolve(source);
  if (source instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(source));
  if (source?.bytes instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(source.bytes));
  if (ArrayBuffer.isView(source?.bytes)) {
    return Promise.resolve(new Uint8Array(
      source.bytes.buffer,
      source.bytes.byteOffset,
      source.bytes.byteLength,
    ));
  }
  if (typeof source?.arrayBuffer === "function") {
    return source.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  throw new Error("O arquivo MusicXML não pôde ser lido.");
}

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("O arquivo MXL não possui um diretório ZIP válido.");
}

function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(bytes);
  const entryCount = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("O diretório do arquivo MXL está corrompido.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) throw new Error("O arquivo MXL possui um nome inválido.");
    if (flags & 0x1) throw new Error("Arquivos MXL protegidos por senha não são aceitos.");
    if (uncompressedSize > MAX_MUSICXML_BYTES) {
      throw new Error("O MusicXML compactado excede o limite de 20 MB.");
    }
    entries.push({
      name: UTF8.decode(bytes.subarray(nameStart, nameEnd)),
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Este navegador não consegue descompactar arquivos MXL.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error(`A entrada “${entry.name}” do MXL está corrompida.`);
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new Error(`A entrada “${entry.name}” está incompleta.`);
  const compressed = bytes.subarray(start, end);
  let result;
  if (entry.method === 0) result = compressed.slice();
  else if (entry.method === 8) result = await inflateRaw(compressed);
  else throw new Error(`O método de compactação ${entry.method} do MXL não é aceito.`);
  if (result.length > MAX_MUSICXML_BYTES) {
    throw new Error("O MusicXML descompactado excede o limite de 20 MB.");
  }
  if (entry.uncompressedSize && result.length !== entry.uncompressedSize) {
    throw new Error(`A entrada “${entry.name}” não foi descompactada por completo.`);
  }
  return result;
}

function xmlAttribute(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function extractMxl(bytes) {
  const entries = readZipEntries(bytes);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const container = entries.find((entry) =>
    entry.name.toLowerCase() === "meta-inf/container.xml");
  let rootPath = "";
  if (container) {
    const containerXml = UTF8.decode(await readEntry(bytes, container));
    rootPath = xmlAttribute(
      containerXml.match(/<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i)?.[1],
    );
  }
  const score = (rootPath && byName.get(rootPath))
    || entries.find((entry) =>
      !entry.name.toLowerCase().startsWith("meta-inf/")
      && /\.(musicxml|xml)$/i.test(entry.name));
  if (!score) throw new Error("O arquivo MXL não contém uma partitura MusicXML.");
  return UTF8.decode(await readEntry(bytes, score));
}

export async function readMusicXmlFile(source) {
  const bytes = await asBytes(source);
  if (!bytes.length) throw new Error("O arquivo MusicXML está vazio.");
  const name = String(source?.name || "").toLowerCase();
  const type = String(source?.type || "").toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || name.endsWith(".mxl") || type === MXL_TYPE) return extractMxl(bytes);
  if (bytes.length > MAX_MUSICXML_BYTES) {
    throw new Error("O MusicXML excede o limite de 20 MB.");
  }
  return UTF8.decode(bytes);
}
