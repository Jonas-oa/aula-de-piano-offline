const FUR_ELISE_MIDI_EVENTS = "AGABTGBgAUtgYAFMYGABS2BgAUxgYAFHYGABSmBgAUhgwAECLUVgYAE0YGABOWBgATxgYAFAYGABRWDAAQIoR2BgATRgYAE4YGABQGBgAURgYAFHYMABAi1IYGABNGBgATlgYAFAYGABTGBgAUtgYAFMYGABS2BgAUxgYAFHYGABSmBgAUhgwAECLUVgYAE0YGABOWBgATxgYAFAYGABRWDAAQIoR2BgATRgYAE4YGABQGBgAUhgYAFHYIADAi1FYGABNGBgATnAAcABAi1FYGABNGBgATlgYAFHYGABSGBgAUpgoAICMExgYAE3YGABPGBgAUNgYAFNYGABTGCgAgIrSmBgATdgYAE7YGABQWBgAUxgYAFKYKACAi1IYGABNGBgATlgYAFAYGABSmBgAUhgwAECKEdgYAE0YGABQGBgAUBgYAFMYGABQGBgAUxgYAFMYGABWGBgAUtgYAFMYGABS2DAAQFMYGABS2BgAUxgYAFLYGABTGBgAUtgYAFMYGABS2BgAUxgYAFHYGABSmBgAUhgwAECLUVgYAE0YGABOWBgATxgYAFAYGABRWDAAQIoR2BgATRgYAE4YGABQGBgAURgYAFHYMABAi1IYGABNGBgATlgYAFAYGABTGBgAUtgYAFMYGABS2BgAUxgYAFHYGABSmBgAUhgwAECLUVgYAE0YGABOWBgATxgYAFAYGABRWDAAQIoR2BgATRgYAE4YGABQGBgAUhgYAFHYMABAi1FYGABNGBgATlgYAFHYGABSGBgAUpgwAECLUVgYAE0YGABOWBgBDo8QEhgYAQ5PEFIYGAGNzo8QENIYIADAjVIYGABOWBgATxgYAE5YJABAjxNYGABOTAwAUwwwAECNUxgYAE6YMABAj5KYGABOmCQAQI+UmBgATowMAFRMGACNVFgYAJAT2BgBDU3Ok1gYAJATGBgBDU3OkpgYAJASGDAAQI1RmBgATlgtQECPEVgYAE5YGACPEUwMAFDMGACOUUwMAFGMIADAjVIYGABOWBgATxgYAE5YGACPEpgYAI5S2CgAgI0TGBgATlgYAE8YGACOUxgYAMyPk1gYAI1RWCAAwI3SGBgAUBgYAE3YGABQGCQAQI3SmBgAUEwMAFHMMABAzxASDAwAU8wMAFDMDABTzAwAUUwMAFPMGADQUNHMDABTzBgA0BDSDAwAU8wYAQ+QUNKMDABTzDAAQQ8QENMMDABTzAwAVQwMAFTMMABAzU5UTAwAU8wMAFNMDABTDDAAQM3O0owMAFPMDABTTAwAUowwAECPEgwMAFPMDABQzAwAU8wMAFFMDABTzBgA0FDRzAwAU8wYANAQ0gwMAFPMGAEPkFDSjAwAU8wwAEEPEBDTDAwAU8wMAFUMDABUzDAAQM1OVEwMAFPMDABTTAwAUwwwAEDNztKMDABTzAwAU0wMAFKMMABAzg7TDAwAU0wMAFMMDABSzAwAUwwMAFHMDABTDAwAUswMAFMMDABRzAwAUwwMAFLMKACAUygAmABR2BgAUxgYAFLYKACAUygAmABR2BgAUxgYAFLYGABTGBgAUtgYAFMYGABS2BgAUxgYAFLYGABTGBgAUtgYAFMYGABR2BgAUpgYAFIYMABAi1FYGABNGBgATlgYAE8YGABQGBgAUVgwAECKEdgYAE0YGABOGBgAUBgYAFEYGABR2DAAQItSGBgATRgYAE5YGABQGBgAUxgYAFLYGABTGBgAUtgYAFMYGABR2BgAUpgYAFIYMABAi1FYGABNGBgATlgYAE8YGABQGBgAUVgwAECKEdgYAE0YGABOGBgAUBgYAFIYGABR2DAAQItRWBgATRgYAE5YGABR2BgAUhgYAFKYKACAjBMYGABN2BgATxgYAFDYGABTWBgAUxgoAICK0pgYAE3YGABO2BgAUFgYAFMYGABSmCgAgItSGBgATRgYAE5YGABQGBgAUpgYAFIYMABAihHYGABNGBgAUBgYAFAYGABTGBgAUBgYAFMYGABTGBgAVhgYAFLYGABTGBgAUtgYAFMYGABS2BgAUxgYAFLYGABTGBgAUtgYAFMYGABS2BgAUxgYAFHYGABSmBgAUhgwAECLUVgYAE0YGABOWBgATxgYAFAYGABRWDAAQIoR2BgATRgYAE4YGABQGBgAURgYAFHYMABAi1IYGABNGBgATlgYAFAYGABTGBgAUtgYAFMYGABS2BgAUxgYAFHYGABSmBgAUhgwAECLUVgYAE0YGABOWBgATxgYAFAYGABRWDAAQIoR2BgATRgYAE4YGABQGBgAUhgYAFHYMABAi1FYGABLWBgAS1gYAEtYGABLWBgAS1gwAQFLUBDRklgYAEtYGABLWBgAS1gYAEtYGABLWCAAwQtQUVKYGABLWBgAS1gYAEtYGADLUlMYGADLUpNYIADBC1ESk1gYAEtYGABLWBgAS1gwAEELURKTWBgAS1gwAQELUVITGBgAS1gYAEtYGABLWBgAS1gYAEtYIADBCYtQUpgYAImLWBgAiYtYGACJi1gYAQmLUBIYGAEJi0+R2CAAwUnLTxCRWBgAictYGACJy1gYAInLWDAAQQnLTxFYGACJy1gwAEEKC08RWBgAigtYMABBCgtQEhgYAIoLWDAAQQoLD5HYGACKCxgwAQEIS08RWBgAS1gYAEtYGABLWBgAS1gYAEtYMAEBS1AQ0ZJYGABLWBgAS1gYAEtYGABLWBgAS1ggAMELUFFSmBgAS1gYAEtYGABLWBgAy1JTGBgAy1KTWCAAwMtSk1gYAEtYGABLWBgAS1gwAEDLUpNYGABLWDABAMuSk1gYAEuYGABLmBgAS5gYAEuYGABLmCAAwMuQ0tgYAEuYGABLmBgAS5gYAMuQUpgYAMuP0hggAMELj5BRmBgAS5gYAEuYGABLmDAAQQuPkFFYGABLmCAAwQvPkFEYGABL2BgAS9gYAEvYMABBC8+QURgYAEvYIADBDA8QEXABMABBDQ4QEfABMABAiE5QEABPEBAAUBAQAFFQEABSEBAAUxAwAEEOTxASkBAAUhAQAFHQMABBDk8QEVAQAFIQEABTEBAAVFAQAFUQEABWEDAAQQ5PEBWQEABVEBAAVNAwAEEOTxAUUBAAVRAQAFYQEABXUBAAWBAQAFkQMABBDk8QGJAQAFgQEABX0DAAQQ5PEBeQEABXUBAAVxAQAFbQEABWkBAAVlAQAFYQEABV0BAAVZAQAFVQEABVEBAAVNAQAFSQEABUUBAAVBAQAFPQEABTkBAAU1AYAFMYGABS2BgAUxgYAFHYGABSmBgAUhgwAECLUVgYAE0YGABOWBgATxgYAFAYGABRWDAAQIoR2BgATRgYAE4YGABQGBgAURgYAFHYMABAi1IYGABNGBgATlgYAFAYGABTGBgAUtgYAFMYGABS2BgAUxgYAFHYGABSmBgAUhgwAECLUVgYAE0YGABOWBgATxgYAFAYGABRWDAAQIoR2BgATRgYAE4YGABQGBgAUhgYAFHYMABAi1FYGABNGBgATlgYAFHYGABSGBgAUpgoAICMExgYAE3YGABPGBgAUNgYAFNYGABTGCgAgIrSmBgATdgYAE7YGABQWBgAUxgYAFKYKACAi1IYGABNGBgATlgYAFAYGABSmBgAUhgwAECKEdgYAE0YGABQGBgAUBgYAFMYGABQGBgAUxgYAFMYGABWGBgAUtgYAFMYGABS2BgAUxgYAFLYGABTGBgAUtgYAFMYGABS2BgAUxgYAFLYGABTGBgAUdgYAFKYGABSGDAAQItRWBgATRgYAE5YGABPGBgAUBgYAFFYMABAihHYGABNGBgAThgYAFAYGABRGBgAUdgwAECLUhgYAE0YGABOWBgAUBgYAFMYGABS2BgAUxgYAFLYGABTGBgAUdgYAFKYGABSGDAAQItRWBgATRgYAE5YGABPGBgAUBgYAFFYMABAihHYGABNGBgAThgYAFAYGABSGBgAUdgwAEDIS1F";

const SCORE_DEFINITIONS = [{
  id: "beethoven-fur-elise-woo59-mutopia-931",
  title: "Für Elise",
  composer: "Ludwig van Beethoven",
  bpm: 72,
  timeSignature: "3/8",
  ticksPerBeat: 384,
  eventCount: 660,
  pdfSha256: ["f356611307e9949b65a266ca1b91a110b9c32143be437213f2bdd63e082124e2"],
  source: {
    name: "Mutopia Project 931",
    url: "https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931",
    score: "Breitkopf & Härtel, 1888",
    license: "Public Domain",
  },
  encodedEvents: FUR_ELISE_MIDI_EVENTS,
}];

const decodedScores = new Map();

function decodeBase64(value) {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readVariableInteger(bytes, offset) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  let byte;
  do {
    byte = bytes[cursor];
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return { value, offset: cursor };
}

function midiLabel(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function decodeEvents(definition) {
  if (decodedScores.has(definition.id)) return decodedScores.get(definition.id);
  const bytes = decodeBase64(definition.encodedEvents);
  const events = [];
  let offset = 0;
  let tick = 0;

  while (offset < bytes.length) {
    const delta = readVariableInteger(bytes, offset);
    const duration = readVariableInteger(bytes, delta.offset);
    const midiCount = bytes[duration.offset];
    offset = duration.offset + 1;
    tick += delta.value;
    const midis = Array.from(bytes.slice(offset, offset + midiCount));
    offset += midiCount;
    events.push({
      beat: tick / definition.ticksPerBeat,
      duration: duration.value / definition.ticksPerBeat,
      midis,
      pitches: midis.map(midiLabel),
    });
  }

  if (events.length !== definition.eventCount) {
    throw new Error(`Dados musicais incompletos para ${definition.title}.`);
  }
  decodedScores.set(definition.id, events);
  return events;
}

function materializeScore(definition) {
  if (!definition) return null;
  const { encodedEvents, pdfSha256, ...metadata } = definition;
  return { ...metadata, pdfSha256: [...pdfSha256], events: decodeEvents(definition) };
}

export function getPublicDomainScore(id) {
  return materializeScore(SCORE_DEFINITIONS.find((score) => score.id === id));
}

export function getPublicDomainScoreByPdfHash(hash) {
  const normalized = String(hash || "").toLowerCase();
  return materializeScore(
    SCORE_DEFINITIONS.find((score) => score.pdfSha256.includes(normalized)),
  );
}

export async function sha256Hex(bytes, subtle = globalThis.crypto?.subtle) {
  if (!subtle) return "";
  const view = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function identifyPublicDomainScore(pdfAsset) {
  if (!pdfAsset?.bytes) return null;
  return getPublicDomainScoreByPdfHash(await sha256Hex(pdfAsset.bytes));
}
