import test from "node:test";
import assert from "node:assert/strict";
import {
  createFollowState,
  currentEvent,
  registerNote,
  progress,
} from "../src/core/follow-evaluator.js";

const notes = (arr) => arr.map((midis) => ({ midis: Array.isArray(midis) ? midis : [midis] }));

test("avança apenas quando a nota correta é tocada", () => {
  const state = createFollowState(notes([60, 62, 64]));
  assert.equal(currentEvent(state).midis[0], 60);

  const wrong = registerNote(state, 61);
  assert.equal(wrong.type, "wrong");
  assert.equal(state.index, 0, "nota errada não avança");

  const ok = registerNote(state, 60);
  assert.equal(ok.type, "advance");
  assert.equal(state.index, 1);
});

test("acorde exige todas as notas antes de avançar", () => {
  const state = createFollowState(notes([[60, 64, 67]]));
  assert.equal(registerNote(state, 60).type, "progress");
  assert.equal(registerNote(state, 64).type, "progress");
  assert.equal(state.index, 0, "acorde incompleto não avança");
  const last = registerNote(state, 67);
  assert.equal(last.type, "complete");
  assert.equal(state.done, true);
});

test("notas repetidas ou já satisfeitas não travam o acorde", () => {
  const state = createFollowState(notes([[60, 64]]));
  registerNote(state, 60);
  assert.equal(registerNote(state, 60).type, "progress", "repetir nota já correta não é erro");
  assert.equal(registerNote(state, 64).type, "complete");
});

test("nota fora do acorde é erro e não avança", () => {
  const state = createFollowState(notes([[60, 64, 67]]));
  registerNote(state, 60);
  const wrong = registerNote(state, 62);
  assert.equal(wrong.type, "wrong");
  assert.deepEqual(wrong.remaining, [64, 67]);
});

test("modo sem alturas avança a cada ataque", () => {
  const state = createFollowState([{ midis: [] }, { midis: [] }]);
  assert.equal(registerNote(state, null).type, "advance");
  assert.equal(registerNote(state, null).type, "complete");
});

test("modo insensível à oitava aceita a mesma classe de nota", () => {
  const state = createFollowState(notes([60, 65]));
  const ok = registerNote(state, 72, { octaveSensitive: false });
  assert.equal(ok.type, "advance");
  assert.equal(state.index, 1);
});

test("progresso reflete o andamento e termina completo", () => {
  const state = createFollowState(notes([60, 62]));
  assert.deepEqual(progress(state), { done: 0, total: 2, ratio: 0 });
  registerNote(state, 60);
  registerNote(state, 62);
  assert.deepEqual(progress(state), { done: 2, total: 2, ratio: 1 });
  assert.equal(registerNote(state, 64).type, "idle", "após o fim, novas notas são ignoradas");
});
