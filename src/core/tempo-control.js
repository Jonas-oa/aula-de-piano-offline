export const MIN_TEMPO_BPM = 30;
export const MAX_TEMPO_BPM = 240;

export function clampTempo(value, fallback = 72) {
  const numeric = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 72;
  return Math.round(Math.max(
    MIN_TEMPO_BPM,
    Math.min(MAX_TEMPO_BPM, Number.isFinite(numeric) ? numeric : safeFallback),
  ));
}

export function tempoPercent(bpm, originalBpm) {
  const original = clampTempo(originalBpm);
  return Math.round((clampTempo(bpm, original) / original) * 100);
}

export function tempoFromPercent(originalBpm, percent) {
  const original = clampTempo(originalBpm);
  const safePercent = Number.isFinite(Number(percent)) ? Number(percent) : 100;
  return clampTempo(original * safePercent / 100, original);
}
