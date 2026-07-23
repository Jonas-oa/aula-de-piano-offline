import { rhythmExercises } from "./data/rhythm-exercises.js";
import {
  deletePiece,
  fileToStoredAsset,
  listPieces,
  savePiece,
} from "./core/library-store.js";
import { parseMusicXml } from "./core/musicxml.js";
import { MidiInput, OnsetEngine } from "./core/onset-engine.js";
import { ScreenWakeLockManager } from "./core/screen-wake-lock.js";
import {
  createPulseGrid,
  eventsToSchedule,
  markMissed,
  matchOnset,
  summarizeAttempts,
} from "./core/timing-evaluator.js";
import { DocumentViewer } from "./ui/document-viewer.js";
import { renderScore } from "./ui/score-renderer.js";

const byId = (id) => document.getElementById(id);
const state = {
  pieces: [],
  selectedFiles: [],
  currentItem: null,
  currentEvents: null,
  currentMusicXml: "",
  currentView: "libraryView",
  inputMode: "microphone",
  practiceActive: false,
  countInActive: false,
  schedule: [],
  attempts: [],
  missed: 0,
  animationFrame: null,
  countTimers: [],
  startedAt: 0,
  exactMode: false,
  lastMidiAttempt: null,
};

const viewer = new DocumentViewer(byId("documentStage"), {
  onPageChange: ({ page, pages, type }) => {
    byId("pageLabel").textContent = type === "pdf" ? `${page} / ${pages}` : "Partitura";
    byId("previousPageButton").disabled = type !== "pdf" || page <= 1;
    byId("nextPageButton").disabled = type !== "pdf" || page >= pages;
  },
});

const wakeLock = new ScreenWakeLockManager({
  onStatus(status) {
    const label = byId("screenStatus");
    const labels = {
      active: "Tela protegida",
      unsupported: "Wake Lock indisponível",
      error: "Toque na tela para reativar",
      released: "Proteção liberada",
    };
    label.textContent = labels[status] || "Tela ativa";
  },
});

const onsetEngine = new OnsetEngine({
  onOnset: (timestamp) => handleOnset(timestamp, null),
  onLevel: (level) => {
    byId("levelBar").style.width = `${Math.round(level * 100)}%`;
  },
  onError: (error) => toast(readableError(error)),
});

const midiInput = new MidiInput({
  onNote: ({ midi, timestamp }) => handleOnset(timestamp, midi),
  onStatus: (status, count) => {
    if (status === "connected") toast(`${count} entrada MIDI conectada${count > 1 ? "s" : ""}.`);
    if (status === "empty") toast("Nenhum piano MIDI foi encontrado.");
  },
});

function showView(viewId) {
  state.currentView = viewId;
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === viewId);
  });
  byId("bottomNav").classList.toggle("hidden", viewId === "practiceView");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function levelLabel(level) {
  return { iniciante: "Iniciante", intermediario: "Intermediário", avancado: "Avançado" }[level] || level;
}

function beatsPerBar(timeSignature = "4/4") {
  const [numerator, denominator] = String(timeSignature).split("/").map(Number);
  if (!numerator || !denominator) return 4;
  return denominator === 8 ? numerator / 2 : numerator;
}

function renderLibrary() {
  const query = byId("librarySearch").value.trim().toLocaleLowerCase("pt-BR");
  const pieces = state.pieces
    .filter((piece) => `${piece.title} ${piece.composer}`.toLocaleLowerCase("pt-BR").includes(query))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const grid = byId("pieceGrid");
  grid.replaceChildren();

  if (!pieces.length) {
    const empty = document.createElement("div");
    empty.className = "empty-library";
    empty.innerHTML = `
      <span class="score-thumbnail" aria-hidden="true"></span>
      <strong>${query ? "Nenhuma peça encontrada" : "Seu repertório ainda está vazio"}</strong>
      <span>${query ? "Tente outro título ou compositor." : "Importe um PDF para começar a estudar uma peça inteira."}</span>
      ${query ? "" : '<button class="primary-button">Adicionar primeira peça</button>'}
    `;
    empty.querySelector("button")?.addEventListener("click", () => showView("importView"));
    grid.append(empty);
    return;
  }

  for (const piece of pieces) {
    const card = document.createElement("article");
    card.className = "piece-card";
    const format = piece.musicXmlAsset ? "PDF + MusicXML" : piece.pdfAsset ? "PDF" : "MusicXML";
    card.innerHTML = `
      <div class="piece-card-top">
        <span class="score-thumbnail" aria-hidden="true"></span>
        <button class="card-menu" aria-label="Excluir ${escapeHtml(piece.title)}">×</button>
      </div>
      <h3>${escapeHtml(piece.title)}</h3>
      <p>${escapeHtml(piece.composer || "Compositor não informado")}</p>
      <div class="card-tags">
        <span class="tag">${format}</span>
        <span class="tag">${piece.bpm} bpm</span>
        <span class="tag">${escapeHtml(piece.timeSignature)}</span>
      </div>
      <button class="primary-button">Abrir partitura</button>
    `;
    card.querySelector(".primary-button").addEventListener("click", () => openPractice(piece));
    card.querySelector(".card-menu").addEventListener("click", async () => {
      if (!window.confirm(`Excluir “${piece.title}” deste aparelho?`)) return;
      await deletePiece(piece.id);
      state.pieces = state.pieces.filter((item) => item.id !== piece.id);
      renderLibrary();
      toast("Peça excluída do repertório local.");
    });
    grid.append(card);
  }
}

function renderRhythms() {
  const style = byId("rhythmFilter").value;
  const exercises = rhythmExercises.filter((exercise) => style === "all" || exercise.style === style);
  const grid = byId("rhythmGrid");
  grid.replaceChildren();

  for (const exercise of exercises) {
    const card = document.createElement("article");
    card.className = "rhythm-card";
    card.innerHTML = `
      <div>
        <span class="tag">${escapeHtml(exercise.style)}</span>
        <span class="tag level-${exercise.level}">${levelLabel(exercise.level)}</span>
      </div>
      <h3>${escapeHtml(exercise.title)}</h3>
      <p>${escapeHtml(exercise.focus)}</p>
      <div class="card-tags">
        <span class="tag">${exercise.timeSignature}</span>
        <span class="tag">${exercise.bpm} bpm</span>
        <span class="tag">Duas mãos</span>
      </div>
      <button class="ghost-button">Praticar exercício</button>
    `;
    card.querySelector("button").addEventListener("click", () => openPractice(exercise));
    grid.append(card);
  }
}

function renderSelectedFiles() {
  const container = byId("selectedFiles");
  container.replaceChildren();
  for (const file of state.selectedFiles) {
    const item = document.createElement("div");
    item.className = "selected-file";
    item.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span>`;
    container.append(item);
  }
}

function acceptFiles(files) {
  const accepted = [...files].filter((file) =>
    /\.pdf$/i.test(file.name) || /\.(xml|musicxml)$/i.test(file.name),
  );
  state.selectedFiles = accepted;
  renderSelectedFiles();
  if (accepted.length !== files.length) {
    toast("Nesta versão, selecione arquivos PDF, XML ou MusicXML sem compactação.");
  }
}

async function importPiece(event) {
  event.preventDefault();
  const pdfFile = state.selectedFiles.find((file) => /\.pdf$/i.test(file.name));
  const xmlFile = state.selectedFiles.find((file) => /\.(xml|musicxml)$/i.test(file.name));
  if (!pdfFile && !xmlFile) {
    toast("Escolha ao menos um PDF ou MusicXML.");
    return;
  }

  let parsed = null;
  if (xmlFile) {
    try {
      parsed = parseMusicXml(await xmlFile.text());
    } catch (error) {
      toast(readableError(error));
      return;
    }
  }

  const piece = {
    id: globalThis.crypto?.randomUUID?.() || `piece-${Date.now()}`,
    type: "piece",
    title: byId("pieceTitle").value.trim() || parsed?.title || "Peça importada",
    composer: byId("pieceComposer").value.trim() || parsed?.composer || "",
    bpm: Number(byId("pieceBpm").value) || 72,
    timeSignature: byId("pieceTimeSignature").value,
    pdfAsset: await fileToStoredAsset(pdfFile),
    musicXmlAsset: await fileToStoredAsset(xmlFile),
    createdAt: new Date().toISOString(),
  };

  try {
    await savePiece(piece);
    state.pieces.push(piece);
    byId("importForm").reset();
    byId("pieceBpm").value = "72";
    state.selectedFiles = [];
    renderSelectedFiles();
    renderLibrary();
    showView("libraryView");
    toast("Peça salva neste aparelho.");
  } catch (error) {
    toast(`Não foi possível salvar: ${readableError(error)}`);
  }
}

function xmlTextFromAsset(asset) {
  if (!asset) return "";
  return new TextDecoder().decode(asset.bytes);
}

function exerciseAsLegacyScore(exercise) {
  return {
    id: exercise.id,
    title: exercise.title,
    key: "",
    bpm: exercise.bpm,
    timeSignature: exercise.timeSignature,
    beatsPerBar: exercise.beatsPerBar,
    clef: "grand",
    notes: exercise.events.map((event) => ({
      pitch: event.pitches.at(-1),
      duration: event.duration,
      pitches: event.pitches.map((pitch) => ({
        pitch,
        duration: event.duration,
        finger: null,
      })),
    })),
  };
}

async function openPractice(item) {
  await stopPractice({ showResult: false });
  state.currentItem = item;
  state.currentEvents = null;
  state.currentMusicXml = "";
  state.exactMode = item.type === "rhythm" || Boolean(item.musicXmlAsset);

  byId("practiceTitle").textContent = item.title;
  byId("practiceComposer").textContent = (item.composer || item.style || "EXERCÍCIO").toUpperCase();
  byId("tempoSlider").value = String(item.bpm || 72);
  byId("tempoOutput").value = String(item.bpm || 72);
  resetPracticeUi();
  showView("practiceView");
  await wakeLock.setEnabled(true);

  try {
    if (item.type === "rhythm") {
      state.currentEvents = item.events;
      const legacyScore = exerciseAsLegacyScore(item);
      viewer.showRhythm((container) => renderScore(container, legacyScore, 0, false));
      setAnalysisMode("Exercício estruturado", "O aplicativo conhece cada ataque esperado. O microfone avalia o tempo; com um piano MIDI, também confere as alturas.");
      byId("pdfOnlyOptions").hidden = true;
      return;
    }

    if (item.musicXmlAsset) {
      state.currentMusicXml = xmlTextFromAsset(item.musicXmlAsset);
      state.currentEvents = parseMusicXml(state.currentMusicXml).events;
    }

    if (item.pdfAsset) {
      await viewer.showPdf(item.pdfAsset);
    } else if (state.currentMusicXml) {
      await viewer.showMusicXml(state.currentMusicXml);
    }

    if (state.currentEvents?.length) {
      setAnalysisMode("Partitura estruturada", "O MusicXML fornece os ataques e as notas esperadas. O microfone avalia o tempo; um piano MIDI também permite conferir as alturas.");
      byId("pdfOnlyOptions").hidden = true;
    } else {
      setAnalysisMode("Tempo pelo PDF", "O PDF é visual: o microfone mede a proximidade de cada ataque à grade escolhida. Para conferir notas e pausas exatas, importe também o MusicXML.");
      byId("pdfOnlyOptions").hidden = false;
    }
  } catch (error) {
    byId("documentStage").innerHTML = `<div class="loading-state">${escapeHtml(readableError(error))}</div>`;
    toast(readableError(error));
  }
}

function setAnalysisMode(label, explanation) {
  byId("analysisModeBadge").textContent = label;
  byId("analysisExplanation").textContent = explanation;
}

async function selectInputMode(mode) {
  if (state.practiceActive || state.countInActive) return;
  state.inputMode = mode;
  byId("microphoneModeButton").classList.toggle("active", mode === "microphone");
  byId("midiModeButton").classList.toggle("active", mode === "midi");
  byId("levelBar").style.width = "0";

  if (mode === "midi") {
    try {
      const count = await midiInput.connect();
      if (!count) toast("Conecte e ligue o piano MIDI, depois tente novamente.");
    } catch (error) {
      state.inputMode = "microphone";
      byId("microphoneModeButton").classList.add("active");
      byId("midiModeButton").classList.remove("active");
      toast(readableError(error));
    }
  } else {
    midiInput.disconnect();
  }
}

async function startPractice() {
  if (!state.currentItem || state.practiceActive || state.countInActive) return;
  const bpm = Number(byId("tempoSlider").value);
  const beatMs = 60_000 / bpm;
  const countBeats = Math.max(2, Math.round(
    state.currentItem.beatsPerBar || beatsPerBar(state.currentItem.timeSignature),
  ));

  state.schedule = [];
  state.attempts = [];
  state.missed = 0;
  state.lastMidiAttempt = null;
  state.countInActive = true;
  resetPracticeUi();
  byId("startPracticeButton").disabled = true;
  byId("stopPracticeButton").disabled = false;
  await wakeLock.setEnabled(true);

  try {
    if (state.inputMode === "microphone") await onsetEngine.start();
    else if (!midiInput.access) await midiInput.connect();
  } catch (error) {
    state.countInActive = false;
    byId("startPracticeButton").disabled = false;
    byId("stopPracticeButton").disabled = true;
    toast(readableError(error));
    return;
  }

  const startAt = performance.now() + countBeats * beatMs + 120;
  state.startedAt = startAt;
  if (state.currentEvents?.length) {
    state.schedule = eventsToSchedule(state.currentEvents, bpm, startAt);
  } else {
    state.schedule = createPulseGrid({
      bpm,
      startMs: startAt,
      subdivision: Number(byId("subdivisionSelect").value),
      beatsPerBar: beatsPerBar(state.currentItem.timeSignature),
      bars: 64,
    });
  }

  byId("countInDisplay").classList.add("visible");
  for (let index = 0; index < countBeats; index += 1) {
    const timer = window.setTimeout(() => {
      const remaining = countBeats - index;
      byId("countInDisplay").textContent = String(remaining);
      playCountClick(index === 0);
    }, index * beatMs);
    state.countTimers.push(timer);
  }

  state.countTimers.push(window.setTimeout(() => {
    byId("countInDisplay").textContent = "Toque";
    window.setTimeout(() => byId("countInDisplay").classList.remove("visible"), 420);
    state.countInActive = false;
    state.practiceActive = true;
    setFeedback("neutral", "VALENDO", "Acompanhe a partitura", "Escutando cada ataque.");
    practiceTick();
  }, countBeats * beatMs + 120));
}

function handleOnset(timestamp, midi) {
  if (!state.practiceActive) return;

  if (
    midi !== null
    && state.lastMidiAttempt
    && timestamp - state.lastMidiAttempt.timestamp < 120
    && state.lastMidiAttempt.event.midis?.length > 1
  ) {
    state.lastMidiAttempt.playedMidis.add(midi);
    state.lastMidiAttempt.noteCorrect = state.lastMidiAttempt.event.midis.every((expected) =>
      state.lastMidiAttempt.playedMidis.has(expected),
    );
    updateFeedbackForAttempt(state.lastMidiAttempt);
    return;
  }

  const result = matchOnset(state.schedule, timestamp, {
    toleranceMs: state.exactMode ? 125 : 115,
    searchWindowMs: state.exactMode ? 430 : 280,
  });
  if (!result) {
    setFeedback("late", "FORA DA GRADE", "Ataque não associado", "Tente manter o pulso interno.");
    return;
  }

  const attempt = {
    ...result,
    timestamp,
    midi,
    playedMidis: new Set(midi === null ? [] : [midi]),
    noteCorrect: midi === null || !result.event.midis?.length
      ? null
      : result.event.midis.includes(midi),
  };
  state.attempts.push(attempt);
  state.lastMidiAttempt = midi === null ? null : attempt;
  updateFeedbackForAttempt(attempt);
  updateStats();
  appendAttemptDot(attempt.grade);
  advanceScore(attempt.event.index + 1);
}

function updateFeedbackForAttempt(attempt) {
  const signed = attempt.offsetMs > 0 ? `+${attempt.offsetMs}` : String(attempt.offsetMs);
  let detail = `${signed} ms do tempo esperado.`;
  if (attempt.noteCorrect === true) detail += " Notas corretas.";
  if (attempt.noteCorrect === false) detail += " Confira as notas tocadas.";
  setFeedback(attempt.grade, attempt.label.toUpperCase(), attempt.label, detail);
}

function practiceTick() {
  if (!state.practiceActive) return;

  if (state.exactMode) {
    const missed = markMissed(state.schedule, performance.now(), 430);
    if (missed.length) {
      state.missed += missed.length;
      for (const event of missed) {
        appendAttemptDot("missed");
        advanceScore(event.index + 1);
      }
      setFeedback("missed", "PASSOU", "Ataque não detectado", "Retome no próximo pulso.");
      updateStats();
    }

    const complete = state.schedule.length
      && state.schedule.every((event) => event.matched || event.missed);
    if (complete) {
      stopPractice({ showResult: true });
      return;
    }
  }

  state.animationFrame = requestAnimationFrame(practiceTick);
}

function advanceScore(index) {
  if (state.currentItem?.type === "rhythm") {
    renderScore(
      byId("documentStage"),
      exerciseAsLegacyScore(state.currentItem),
      index,
      false,
    );
    return;
  }
  if (viewer.osmd?.cursor) {
    try {
      viewer.osmd.cursor.show();
      viewer.osmd.cursor.next();
    } catch {
      // O cursor é um auxílio; a avaliação continua mesmo se a edição não o expuser.
    }
  }
}

async function stopPractice({ showResult = true } = {}) {
  const hadActivity = state.practiceActive || state.countInActive || state.attempts.length;
  state.practiceActive = false;
  state.countInActive = false;
  for (const timer of state.countTimers) window.clearTimeout(timer);
  state.countTimers = [];
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  byId("countInDisplay")?.classList.remove("visible");
  byId("startPracticeButton").disabled = false;
  byId("stopPracticeButton").disabled = true;
  await onsetEngine.stop();

  if (showResult && hadActivity) showPracticeResult();
}

function resetPracticeUi() {
  byId("onTimeStat").textContent = "0";
  byId("earlyStat").textContent = "0";
  byId("lateStat").textContent = "0";
  byId("accuracyStat").textContent = "0%";
  byId("attemptTimeline").replaceChildren();
  setFeedback("neutral", "PRONTO", "Observe a partitura", "O aplicativo contará um compasso antes de começar.");
}

function updateStats() {
  const onTime = state.attempts.filter((attempt) => attempt.grade === "on-time").length;
  const early = state.attempts.filter((attempt) => attempt.grade === "early").length;
  const late = state.attempts.filter((attempt) => attempt.grade === "late").length;
  const summary = summarizeAttempts(state.attempts, state.exactMode ? state.missed : 0);
  byId("onTimeStat").textContent = String(onTime);
  byId("earlyStat").textContent = String(early);
  byId("lateStat").textContent = String(late);
  byId("accuracyStat").textContent = `${summary.accuracy}%`;
}

function appendAttemptDot(grade) {
  const dot = document.createElement("span");
  dot.className = `attempt-dot ${grade}`;
  byId("attemptTimeline").append(dot);
  while (byId("attemptTimeline").children.length > 36) {
    byId("attemptTimeline").firstElementChild.remove();
  }
}

function setFeedback(grade, kicker, title, detail) {
  const panel = byId("timingFeedback");
  panel.className = `timing-feedback ${grade}`;
  panel.innerHTML = `<span>${escapeHtml(kicker)}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small>`;
}

function showPracticeResult() {
  const summary = summarizeAttempts(state.attempts, state.exactMode ? state.missed : 0);
  const noteAttempts = state.attempts.filter((attempt) => attempt.noteCorrect !== null);
  const correctNotes = noteAttempts.filter((attempt) => attempt.noteCorrect).length;
  byId("resultContent").innerHTML = `
    <p class="eyebrow">RESUMO DA PRÁTICA</p>
    <h2>${escapeHtml(state.currentItem?.title || "Prática concluída")}</h2>
    <p>${summary.accuracy >= 75 ? "O pulso está consistente. Continue aumentando o trecho aos poucos." : "Repita em um andamento mais lento e procure sentir a subdivisão antes de tocar."}</p>
    <div class="result-grid">
      <div><span>Precisão rítmica</span><strong>${summary.accuracy}%</strong></div>
      <div><span>Desvio médio</span><strong>${summary.meanAbsoluteOffsetMs} ms</strong></div>
      <div><span>Ataques captados</span><strong>${summary.played}</strong></div>
      <div><span>Não detectados</span><strong>${summary.missed}</strong></div>
      ${noteAttempts.length ? `<div><span>Notas MIDI</span><strong>${correctNotes}/${noteAttempts.length}</strong></div>` : ""}
    </div>
  `;
  byId("resultDialog").showModal();
}

async function leavePractice() {
  await stopPractice({ showResult: false });
  await wakeLock.setEnabled(false);
  midiInput.disconnect();
  viewer.clear();
  showView("libraryView");
}

let countAudioContext = null;
async function playCountClick(accent = false) {
  try {
    countAudioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await countAudioContext.resume();
    const oscillator = countAudioContext.createOscillator();
    const gain = countAudioContext.createGain();
    const now = countAudioContext.currentTime;
    oscillator.frequency.setValueAtTime(accent ? 1050 : 780, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    oscillator.connect(gain).connect(countAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  } catch {
    // A contagem visual continua funcionando se o áudio do sistema estiver bloqueado.
  }
}

function readableError(error) {
  if (error?.name === "NotAllowedError") return "Permita o acesso ao microfone nas configurações do navegador.";
  if (error?.name === "QuotaExceededError") return "Não há espaço local suficiente para salvar este arquivo.";
  return error?.message || String(error || "Ocorreu um erro.");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let toastTimer = null;
function toast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("visible"), 3600);
}

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  byId("installButton").hidden = false;
});
byId("installButton").addEventListener("click", async () => {
  await deferredInstallPrompt?.prompt();
  deferredInstallPrompt = null;
  byId("installButton").hidden = true;
});

document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.viewTarget));
});
byId("brandButton").addEventListener("click", () => showView("libraryView"));
byId("librarySearch").addEventListener("input", renderLibrary);
byId("rhythmFilter").addEventListener("change", renderRhythms);
byId("pieceFiles").addEventListener("change", (event) => acceptFiles(event.target.files));
byId("importForm").addEventListener("submit", importPiece);
byId("dropZone").addEventListener("dragover", (event) => {
  event.preventDefault();
  byId("dropZone").classList.add("dragging");
});
byId("dropZone").addEventListener("dragleave", () => byId("dropZone").classList.remove("dragging"));
byId("dropZone").addEventListener("drop", (event) => {
  event.preventDefault();
  byId("dropZone").classList.remove("dragging");
  acceptFiles(event.dataTransfer.files);
});
byId("leavePracticeButton").addEventListener("click", leavePractice);
byId("microphoneModeButton").addEventListener("click", () => selectInputMode("microphone"));
byId("midiModeButton").addEventListener("click", () => selectInputMode("midi"));
byId("startPracticeButton").addEventListener("click", startPractice);
byId("stopPracticeButton").addEventListener("click", () => stopPractice({ showResult: true }));
byId("tempoSlider").addEventListener("input", (event) => {
  byId("tempoOutput").value = event.target.value;
});
byId("previousPageButton").addEventListener("click", () => viewer.previousPage());
byId("nextPageButton").addEventListener("click", () => viewer.nextPage());
byId("zoomOutButton").addEventListener("click", () => viewer.zoomBy(-0.12));
byId("zoomInButton").addEventListener("click", () => viewer.zoomBy(0.12));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.currentView === "practiceView") {
    wakeLock.setEnabled(true);
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

try {
  state.pieces = await listPieces();
} catch (error) {
  toast(`Biblioteca local indisponível: ${readableError(error)}`);
}
renderLibrary();
renderRhythms();
