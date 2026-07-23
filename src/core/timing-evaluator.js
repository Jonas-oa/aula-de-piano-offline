export function classifyTiming(offsetMs, toleranceMs = 110) {
  const absolute = Math.abs(offsetMs);
  if (absolute <= toleranceMs) {
    return { grade: "on-time", label: "No tempo" };
  }
  if (offsetMs < 0) {
    return { grade: "early", label: "Adiantado" };
  }
  return { grade: "late", label: "Atrasado" };
}

export function eventsToSchedule(events, bpm, startMs) {
  const beatMs = 60_000 / Number(bpm);
  return events.map((event, index) => ({
    ...event,
    index,
    expectedMs: startMs + Number(event.beat) * beatMs,
    matched: false,
    missed: false,
  }));
}

export function createPulseGrid({
  bpm,
  startMs,
  subdivision = 1,
  bars = 32,
  beatsPerBar = 4,
}) {
  const step = 1 / Number(subdivision);
  const totalBeats = Number(bars) * Number(beatsPerBar);
  const events = [];

  for (let beat = 0; beat < totalBeats; beat += step) {
    events.push({ beat, duration: step, midis: [], pitches: [] });
  }

  return eventsToSchedule(events, bpm, startMs);
}

export function createCountInPattern(timeSignature = "4/4") {
  const [numerator, denominator] = String(timeSignature).split("/").map(Number);
  if (!numerator || !denominator) {
    return { pulses: 4, pulseBeats: 1, totalBeats: 4 };
  }
  const compound = denominator === 8 && numerator > 3 && numerator % 3 === 0;
  const pulses = compound ? numerator / 3 : numerator;
  const pulseBeats = compound ? 1.5 : 4 / denominator;
  return { pulses, pulseBeats, totalBeats: pulses * pulseBeats };
}

export function matchOnset(schedule, onsetMs, {
  toleranceMs = 110,
  searchWindowMs = 380,
} = {}) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const event of schedule) {
    if (event.matched || event.missed) continue;
    const distance = Math.abs(onsetMs - event.expectedMs);
    if (distance < closestDistance) {
      closest = event;
      closestDistance = distance;
    }
    if (event.expectedMs > onsetMs + searchWindowMs) break;
  }

  if (!closest || closestDistance > searchWindowMs) {
    return null;
  }

  closest.matched = true;
  const offsetMs = Math.round(onsetMs - closest.expectedMs);
  return {
    event: closest,
    offsetMs,
    ...classifyTiming(offsetMs, toleranceMs),
  };
}

export function markMissed(schedule, nowMs, lateWindowMs = 380) {
  const missed = [];
  for (const event of schedule) {
    if (event.matched || event.missed) continue;
    if (nowMs <= event.expectedMs + lateWindowMs) break;
    event.missed = true;
    missed.push(event);
  }
  return missed;
}

export function summarizeAttempts(attempts, missedCount = 0) {
  const timed = attempts.filter((attempt) => Number.isFinite(attempt.offsetMs));
  const onTime = timed.filter((attempt) => attempt.grade === "on-time").length;
  const total = timed.length + missedCount;
  const meanAbsoluteOffsetMs = timed.length
    ? Math.round(timed.reduce((sum, attempt) => sum + Math.abs(attempt.offsetMs), 0) / timed.length)
    : 0;

  return {
    total,
    played: timed.length,
    onTime,
    missed: missedCount,
    accuracy: total ? Math.round((onTime / total) * 100) : 0,
    meanAbsoluteOffsetMs,
  };
}
