const MUSICXML_TYPE = "application/vnd.recordare.musicxml+xml;charset=utf-8";

export function musicXmlFilename({ assetName = "", title = "" } = {}) {
  const candidate = String(assetName || title || "partitura")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(musicxml|xml|mxl)$/i, "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${candidate || "partitura"}.musicxml`;
}

export function musicXmlBlob(asset) {
  if (!asset || asset.bytes == null) {
    throw new Error("Esta peça não possui um arquivo MusicXML para baixar.");
  }
  return new Blob([asset.bytes], { type: MUSICXML_TYPE });
}
