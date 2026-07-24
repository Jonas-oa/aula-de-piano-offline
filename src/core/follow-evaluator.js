// Motor do "modo professor": acompanha a execução nota a nota.
// O cursor para no evento atual e só avança quando as alturas corretas são
// tocadas. Alturas erradas não avançam — apenas sinalizam o erro.
//
// Cada evento esperado tem a forma { midis: number[], pitches?, beat?, duration? }.
// Eventos sem `midis` (por exemplo, uma grade de PDF sem MusicXML) são tratados
// como "qualquer ataque avança", já que não há altura para conferir.

export function createFollowState(events = []) {
  const list = Array.isArray(events) ? events : [];
  return {
    events: list,
    index: 0,
    satisfied: new Set(),
    done: list.length === 0,
  };
}

export function currentEvent(state) {
  if (!state || state.done) return null;
  return state.events[state.index] || null;
}

function expectedMidis(event) {
  const midis = event?.midis;
  return Array.isArray(midis) ? midis.filter((value) => Number.isFinite(value)) : [];
}

// Avança o ponteiro para o próximo evento e devolve se a peça terminou.
function advance(state) {
  state.satisfied = new Set();
  state.index += 1;
  if (state.index >= state.events.length) {
    state.done = true;
    state.index = state.events.length;
    return true;
  }
  return false;
}

// Registra uma nota tocada (MIDI). Devolve o resultado da tentativa sem lançar.
//
// type:
//  - "advance"  → o evento atual foi completado; `index` é o próximo evento
//  - "progress" → nota correta que faz parte de um acorde ainda incompleto
//  - "wrong"    → a nota não pertence ao evento atual (não avança)
//  - "complete" → o último evento foi completado; a peça terminou
//  - "idle"     → não havia evento pendente
export function registerNote(state, midi, { octaveSensitive = true } = {}) {
  if (!state || state.done) {
    return { type: "idle", index: state?.index ?? 0, done: true };
  }
  const event = currentEvent(state);
  const expected = expectedMidis(event);

  // Sem alturas conhecidas: qualquer ataque avança um passo.
  if (!expected.length) {
    const finished = advance(state);
    return {
      type: finished ? "complete" : "advance",
      index: state.index,
      completedIndex: state.index - 1,
      done: state.done,
      expected: [],
      remaining: [],
    };
  }

  const matches = (candidate) => octaveSensitive
    ? candidate === midi
    : ((candidate % 12) + 12) % 12 === ((midi % 12) + 12) % 12;

  const target = expected.find(matches);
  if (target === undefined) {
    return {
      type: "wrong",
      index: state.index,
      expected,
      remaining: expected.filter((value) => !state.satisfied.has(value)),
      played: midi,
    };
  }

  state.satisfied.add(target);
  const remaining = expected.filter((value) => !state.satisfied.has(value));
  if (remaining.length) {
    return { type: "progress", index: state.index, expected, remaining, played: midi };
  }

  const completedIndex = state.index;
  const finished = advance(state);
  return {
    type: finished ? "complete" : "advance",
    index: state.index,
    completedIndex,
    done: state.done,
    expected,
    remaining: [],
    played: midi,
  };
}

// Avança o evento atual sem conferir alturas. Usado quando a entrada não
// informa a nota (por exemplo, um ataque captado pelo microfone).
export function forceAdvance(state) {
  if (!state || state.done) {
    return { type: "idle", index: state?.index ?? 0, done: true };
  }
  const completedIndex = state.index;
  const finished = advance(state);
  return {
    type: finished ? "complete" : "advance",
    index: state.index,
    completedIndex,
    done: state.done,
  };
}

// Reposiciona o ponteiro num evento específico (usado pelo laço A–B).
export function seekTo(state, index) {
  if (!state) return;
  const total = state.events.length;
  const target = Math.max(0, Math.min(Number(index) || 0, total));
  state.index = target;
  state.satisfied = new Set();
  state.done = total === 0 || target >= total;
}

export function progress(state) {
  const total = state?.events?.length || 0;
  const done = Math.min(state?.index ?? 0, total);
  return { done, total, ratio: total ? done / total : 0 };
}
