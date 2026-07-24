import { rhythmExercises } from "./data/rhythm-exercises.js";
import {
  deletePiece,
  fileToStoredAsset,
  listPieces,
  savePiece,
} from "./core/library-store.js";
import { midiToPortuguese } from "./core/music.js";
import { parseMusicXml } from "./core/musicxml.js";
import { renderPdfToImages, transcribeMusicXml } from "./core/omr-vision.js";
import { MidiInput, OnsetEngine } from "./core/onset-engine.js";
import {
  createFollowState,
  currentEvent as currentFollowEvent,
  forceAdvance as forceFollowAdvance,
  progress as followProgress,
  registerNote as registerFollowNote,
  seekTo as seekFollow,
} from "./core/follow-evaluator.js";
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
  omrXml: "",
  currentItem: null,
  currentEvents: null,
  currentMusicXml: "",
  currentView: "libraryView",
  inputMode: "microphone",
  practiceMode: "teacher",
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
  follow: null,
  followStats: { correct: 0, wrong: 0 },
  currentScore: null,
  viewIndex: 0,
  loop: { a: null, b: null, active: false, count: 0 },
};

const viewer = new DocumentViewer(byId("documentStage"), {
  onPageChange: ({ page, pages, type }) => {
    if (type === "pdf") {
      byId("pageLabel").textContent = `${page} / ${pages}`;
      byId("previousPageButton").disabled = page <= 1;
      byId("nextPageButton").disabled = page >= pages;
    } else {
      // Estruturada: os botões de página passam a andar nota a nota na partitura.
      byId("previousPageButton").disabled = false;
      byId("nextPageButton").disabled = false;
    }
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
  state.omrXml = "";
  setOmrStatus("");
  renderSelectedFiles();
  if (accepted.length !== files.length) {
    toast("Nesta versão, selecione arquivos PDF, XML ou MusicXML sem compactação.");
  }
}

async function importPiece(event) {
  event.preventDefault();
  const pdfFile = state.selectedFiles.find((file) => /\.pdf$/i.test(file.name));
  const xmlFile = state.selectedFiles.find((file) => /\.(xml|musicxml)$/i.test(file.name));
  const omrXml = !xmlFile && state.omrXml ? state.omrXml : "";
  if (!pdfFile && !xmlFile && !omrXml) {
    toast("Escolha ao menos um PDF ou MusicXML.");
    return;
  }

  let parsed = null;
  try {
    if (xmlFile) parsed = parseMusicXml(await xmlFile.text());
    else if (omrXml) parsed = parseMusicXml(omrXml);
  } catch (error) {
    toast(readableError(error));
    return;
  }

  const title = byId("pieceTitle").value.trim() || parsed?.title || "Peça importada";
  const musicXmlAsset = xmlFile
    ? await fileToStoredAsset(xmlFile)
    : omrXml
      ? xmlStringToAsset(`${title}.musicxml`, omrXml)
      : null;
  const piece = {
    id: globalThis.crypto?.randomUUID?.() || `piece-${Date.now()}`,
    type: "piece",
    title,
    composer: byId("pieceComposer").value.trim() || parsed?.composer || "",
    bpm: Number(byId("pieceBpm").value) || 72,
    timeSignature: byId("pieceTimeSignature").value,
    pdfAsset: await fileToStoredAsset(pdfFile),
    musicXmlAsset,
    createdAt: new Date().toISOString(),
  };

  try {
    await savePiece(piece);
    state.pieces.push(piece);
    byId("importForm").reset();
    byId("pieceBpm").value = "72";
    byId("omrApiKey").value = loadOmrApiKey();
    state.selectedFiles = [];
    state.omrXml = "";
    setOmrStatus("");
    renderSelectedFiles();
    renderLibrary();
    showView("libraryView");
    toast("Peça salva neste aparelho.");
  } catch (error) {
    toast(`Não foi possível salvar: ${readableError(error)}`);
  }
}

function xmlStringToAsset(name, xml) {
  return {
    name,
    type: "application/vnd.recordare.musicxml+xml",
    bytes: new TextEncoder().encode(xml).buffer,
  };
}

function setOmrStatus(message) {
  const element = byId("omrStatus");
  if (element) element.textContent = message || "";
}

function loadOmrApiKey() {
  try {
    return localStorage.getItem("partitura-viva-omr-key") || "";
  } catch {
    return "";
  }
}

function saveOmrApiKey(value) {
  try {
    if (value) localStorage.setItem("partitura-viva-omr-key", value);
    else localStorage.removeItem("partitura-viva-omr-key");
  } catch {
    // localStorage pode estar indisponível (modo privado); a chave só não persiste.
  }
}

async function convertPdfToMusicXml() {
  const pdfFile = state.selectedFiles.find((file) => /\.pdf$/i.test(file.name));
  if (!pdfFile) {
    toast("Selecione um PDF para converter.");
    return;
  }
  const apiKey = byId("omrApiKey").value.trim();
  if (!apiKey) {
    toast("Informe a chave da API para converter.");
    return;
  }
  const model = byId("omrModel").value.trim() || "claude-opus-4-8";
  const button = byId("omrConvertButton");
  button.disabled = true;
  setOmrStatus("Preparando as páginas do PDF…");
  try {
    const asset = await fileToStoredAsset(pdfFile);
    const { images, totalPages, usedPages } = await renderPdfToImages(asset, { maxPages: 4 });
    setOmrStatus(`Enviando ${usedPages} de ${totalPages} página(s) ao modelo de visão…`);
    const hints = `${byId("pieceTitle").value} ${byId("pieceComposer").value}`.trim();
    const xml = await transcribeMusicXml({ apiKey, model, images, hints });
    const parsed = parseMusicXml(xml);
    state.omrXml = xml;
    if (!byId("pieceTitle").value.trim() && parsed.title) byId("pieceTitle").value = parsed.title;
    if (!byId("pieceComposer").value.trim() && parsed.composer) byId("pieceComposer").value = parsed.composer;
    setOmrStatus(`Pronto: ${parsed.events.length} ataques reconhecidos. Salve para adicionar ao repertório com o modo professor.`);
    toast("Conversão concluída. Revise e salve a peça.");
  } catch (error) {
    state.omrXml = "";
    setOmrStatus(readableError(error));
    toast(readableError(error));
  } finally {
    button.disabled = false;
  }
}

function xmlTextFromAsset(asset) {
  if (!asset) return "";
  return new TextDecoder().decode(asset.bytes);
}

// Converte uma peça estruturada (exercício ou MusicXML) no formato do
// renderizador SVG próprio — a mesma pauta interativa para tudo.
function structuredScore(item, events) {
  return {
    id: item.id,
    title: item.title,
    key: item.key || "",
    bpm: item.bpm,
    timeSignature: item.timeSignature,
    beatsPerBar: item.beatsPerBar || beatsPerBar(item.timeSignature),
    clef: "grand",
    notes: (events || []).map((event) => {
      const pitches = (event.pitches || []).filter(Boolean);
      return {
        pitch: pitches.at(-1),
        duration: event.duration,
        pitches: pitches.map((pitch) => ({ pitch, duration: event.duration, finger: null })),
      };
    }),
  };
}

function activeLoop() {
  return { a: state.loop.a, b: state.loop.b, count: state.loop.count };
}

function renderStructured(index, { fresh = false } = {}) {
  if (!state.currentScore) return;
  state.viewIndex = index;
  if (fresh) {
    viewer.showRhythm((container) => renderScore(container, state.currentScore, index, false, activeLoop()));
  } else {
    renderScore(byId("documentStage"), state.currentScore, index, false, activeLoop());
  }
  if (!state.practiceActive && !state.countInActive) setStructuredPageLabel();
}

function setStructuredPageLabel() {
  const total = state.currentScore?.notes?.length || 0;
  byId("pageLabel").textContent = total ? `Nota ${Math.min(state.viewIndex + 1, total)} / ${total}` : "Partitura";
}

function stepStructured(delta) {
  if (!state.currentScore || state.practiceActive || state.countInActive) return;
  const total = state.currentScore.notes.length;
  renderStructured(Math.max(0, Math.min(state.viewIndex + delta, total - 1)));
}

function normalizeLoop() {
  if (state.loop.a != null && state.loop.b != null && state.loop.a > state.loop.b) {
    [state.loop.a, state.loop.b] = [state.loop.b, state.loop.a];
  }
}

function reflectLoopButtons() {
  const ready = state.loop.a != null && state.loop.b != null;
  const toggle = byId("loopToggleButton");
  toggle.setAttribute("aria-pressed", String(state.loop.active && ready));
  toggle.classList.toggle("active", state.loop.active && ready);
  byId("clearLoopButton").disabled = state.loop.a == null && state.loop.b == null;
}

function refreshLoop() {
  reflectLoopButtons();
  if (state.currentScore) renderStructured(state.viewIndex);
}

function markLoop(point) {
  if (!state.currentScore) {
    toast("Disponível na partitura estruturada (MusicXML ou exercício).");
    return;
  }
  state.loop[point] = state.viewIndex;
  state.loop.count = 0;
  normalizeLoop();
  refreshLoop();
  toast(point === "a" ? `Início A na nota ${state.viewIndex + 1}.` : `Fim B na nota ${state.viewIndex + 1}.`);
}

function clearLoop() {
  state.loop = { a: null, b: null, active: false, count: 0 };
  refreshLoop();
}

function toggleLoop() {
  if (state.loop.a == null || state.loop.b == null) {
    toast("Marque A e B primeiro.");
    return;
  }
  state.loop.active = !state.loop.active;
  reflectLoopButtons();
  toast(state.loop.active ? "Repetição A–B ligada." : "Repetição A–B desligada.");
}

async function openPractice(item) {
  await stopPractice({ showResult: false });
  state.currentItem = item;
  state.currentEvents = null;
  state.currentMusicXml = "";
  state.currentScore = null;
  state.viewIndex = 0;
  state.loop = { a: null, b: null, active: false, count: 0 };
  reflectLoopButtons();
  state.practiceMode = "teacher"; // cada peça abre no modo professor; PDF cai para tempo abaixo
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
    } else if (item.musicXmlAsset) {
      state.currentMusicXml = xmlTextFromAsset(item.musicXmlAsset);
      state.currentEvents = parseMusicXml(state.currentMusicXml).events;
    }

    if (state.currentEvents?.length) {
      // Partitura interativa unificada (SVG próprio): mesma pauta para
      // exercícios e MusicXML, com destaque, rolagem fina e laço A–B.
      state.currentScore = structuredScore(item, state.currentEvents);
      renderStructured(0, { fresh: true });
      setStructuredPageLabel();
      setAnalysisMode(
        item.type === "rhythm" ? "Exercício estruturado" : "Partitura estruturada",
        "O app conhece cada nota. No modo professor o cursor espera a nota certa; marque A–B para repetir um trecho.",
      );
      byId("pdfOnlyOptions").hidden = true;
    } else if (item.pdfAsset) {
      await viewer.showPdf(item.pdfAsset);
      setAnalysisMode("Tempo pelo PDF", "O PDF é visual: o microfone mede o ritmo. Converta o PDF em notas na importação para liberar o modo professor.");
      byId("pdfOnlyOptions").hidden = false;
    }
    applyPracticeModeAvailability();
    applyPieceControls();
  } catch (error) {
    byId("documentStage").innerHTML = `<div class="loading-state">${escapeHtml(readableError(error))}</div>`;
    toast(readableError(error));
  }
}

function setAnalysisMode(label, explanation) {
  byId("analysisModeBadge").textContent = label;
  byId("analysisExplanation").textContent = explanation;
}

// O modo professor só faz sentido quando o app conhece as notas escritas
// (MusicXML ou exercício). Com PDF puro não há altura para conferir, então
// apenas o modo de tempo fica disponível.
function applyPracticeModeAvailability() {
  const hasEvents = Boolean(state.currentEvents?.length);
  const teacherButton = byId("teacherModeButton");
  teacherButton.disabled = !hasEvents;
  teacherButton.title = hasEvents
    ? "Espera você tocar a nota certa para avançar."
    : "Disponível apenas com MusicXML ou exercícios (o PDF não traz as notas).";
  if (!hasEvents) state.practiceMode = "tempo";
  reflectPracticeMode();
}

// Mostra apenas os controles que fazem sentido para a peça aberta, evitando
// que a barra transborde e polua a tela.
function applyPieceControls() {
  const structured = Boolean(state.currentScore);
  byId("loopControls").hidden = !structured;   // laço A–B só na partitura estruturada
  byId("modeToggle").hidden = !structured;      // Professor/Tempo só quando há notas
  byId("zoomOutButton").hidden = structured;    // zoom só no PDF
  byId("zoomInButton").hidden = structured;
}

function reflectPracticeMode() {
  byId("teacherModeButton").classList.toggle("active", state.practiceMode === "teacher");
  byId("tempoModeButton").classList.toggle("active", state.practiceMode === "tempo");
  byId("startPracticeButton").textContent = state.practiceMode === "teacher" ? "▶ Seguir" : "▶ Contar";
}

function selectPracticeMode(mode) {
  if (state.practiceActive || state.countInActive) return;
  if (mode === "teacher" && !state.currentEvents?.length) {
    toast("Modo professor precisa de MusicXML ou exercício com notas.");
    return;
  }
  state.practiceMode = mode;
  reflectPracticeMode();
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
  if (state.practiceMode === "teacher" && state.currentEvents?.length) {
    await startTeacherPractice();
  } else {
    await startTempoPractice();
  }
}

async function startInput() {
  if (state.inputMode === "microphone") await onsetEngine.start();
  else if (!midiInput.access) await midiInput.connect();
}

async function startTeacherPractice() {
  state.schedule = [];
  state.attempts = [];
  state.missed = 0;
  state.lastMidiAttempt = null;
  state.follow = createFollowState(state.currentEvents);
  state.followStats = { correct: 0, wrong: 0 };
  resetPracticeUi();
  byId("startPracticeButton").disabled = true;
  byId("stopPracticeButton").disabled = false;
  await wakeLock.setEnabled(true);

  try {
    await startInput();
  } catch (error) {
    byId("startPracticeButton").disabled = false;
    byId("stopPracticeButton").disabled = true;
    toast(readableError(error));
    return;
  }

  state.practiceActive = true;
  showFollowCursor();
  const micHint = state.inputMode === "microphone"
    ? "No microfone, cada ataque avança um passo — o piano MIDI confere as notas."
    : "Toque a nota certa para avançar. Se errar, o cursor espera.";
  setFeedback("neutral", "SIGA A PARTITURA", "Toque a primeira nota", micHint);
  updateFollowStats();
}

async function startTempoPractice() {
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

  if (state.practiceMode === "teacher" && state.follow) {
    handleFollowOnset(midi);
    return;
  }

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

function expectedNoteLabel(midis = []) {
  const list = (midis || []).filter((value) => Number.isFinite(value));
  if (!list.length) return "próxima nota";
  return list.map((midi) => midiToPortuguese(midi)).join(" + ");
}

function handleFollowOnset(midi) {
  const result = midi === null
    ? forceFollowAdvance(state.follow)
    : registerFollowNote(state.follow, midi);

  if (result.type === "idle") return;

  if (result.type === "wrong") {
    state.followStats.wrong += 1;
    const wanted = result.remaining?.length ? result.remaining : result.expected;
    setFeedback("late", "NOTA ERRADA", "Ainda não é essa", `Toque: ${expectedNoteLabel(wanted)}`);
    appendAttemptDot("late");
    updateFollowStats();
    return;
  }

  if (result.type === "progress") {
    setFeedback("early", "QUASE", "Complete o acorde", `Falta: ${expectedNoteLabel(result.remaining)}`);
    return;
  }

  // advance ou complete
  state.followStats.correct += 1;
  appendAttemptDot("on-time");

  // Laço A–B: ao concluir a nota B, volta para A e conta a repetição.
  if (state.loop.active && state.loop.a != null && state.loop.b != null
    && result.completedIndex === state.loop.b) {
    state.loop.count += 1;
    seekFollow(state.follow, state.loop.a);
    renderStructured(state.loop.a);
    const target = expectedNoteLabel(currentFollowEvent(state.follow)?.midis);
    setFeedback("on-time", `↻ REPETINDO ${state.loop.count}×`, "Voltando ao A", `Toque: ${target}`);
    updateFollowStats();
    return;
  }

  moveFollowCursorTo(result.index);
  if (result.type === "complete") {
    setFeedback("on-time", "FIM", "Peça concluída", "Muito bem — você seguiu até o fim.");
    updateFollowStats();
    stopPractice({ showResult: true });
    return;
  }
  const next = currentFollowEvent(state.follow);
  setFeedback("on-time", "CERTO", "Nota correta", next?.midis?.length
    ? `Próxima: ${expectedNoteLabel(next.midis)}`
    : "Siga para a próxima.");
  updateFollowStats();
}

function showFollowCursor() {
  renderStructured(0);
}

function moveFollowCursorTo(index) {
  renderStructured(index);
}

function updateFollowStats() {
  const { done, total } = followProgress(state.follow);
  byId("onTimeStat").textContent = String(state.followStats.correct);
  byId("earlyStat").textContent = String(done);
  byId("lateStat").textContent = String(state.followStats.wrong);
  const attempts = state.followStats.correct + state.followStats.wrong;
  const accuracy = attempts ? Math.round((state.followStats.correct / attempts) * 100) : 0;
  byId("accuracyStat").textContent = `${accuracy}%`;
  byId("pageLabel").textContent = total ? `Nota ${Math.min(done + 1, total)} / ${total}` : "Partitura";
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
  if (state.currentScore) renderStructured(index);
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
  if (state.practiceMode === "teacher" && state.follow) {
    const { done, total } = followProgress(state.follow);
    const attempts = state.followStats.correct + state.followStats.wrong;
    const accuracy = attempts ? Math.round((state.followStats.correct / attempts) * 100) : 0;
    byId("resultContent").innerHTML = `
      <p class="eyebrow">RESUMO DO ESTUDO</p>
      <h2>${escapeHtml(state.currentItem?.title || "Estudo concluído")}</h2>
      <p>${done >= total && total
        ? "Você seguiu a peça até o fim. Aumente o trecho ou o andamento aos poucos."
        : "Você parou no meio — retome do trecho onde ficou e siga nota a nota."}</p>
      <div class="result-grid">
        <div><span>Notas seguidas</span><strong>${done}/${total}</strong></div>
        <div><span>Acertos de primeira</span><strong>${state.followStats.correct}</strong></div>
        <div><span>Notas erradas</span><strong>${state.followStats.wrong}</strong></div>
        <div><span>Precisão</span><strong>${accuracy}%</strong></div>
      </div>
    `;
    byId("resultDialog").showModal();
    return;
  }
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
byId("omrApiKey").value = loadOmrApiKey();
byId("omrApiKey").addEventListener("change", (event) => saveOmrApiKey(event.target.value.trim()));
byId("omrConvertButton").addEventListener("click", convertPdfToMusicXml);
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
byId("teacherModeButton").addEventListener("click", () => selectPracticeMode("teacher"));
byId("tempoModeButton").addEventListener("click", () => selectPracticeMode("tempo"));
byId("startPracticeButton").addEventListener("click", startPractice);
byId("stopPracticeButton").addEventListener("click", () => stopPractice({ showResult: true }));
byId("tempoSlider").addEventListener("input", (event) => {
  byId("tempoOutput").value = event.target.value;
});
byId("previousPageButton").addEventListener("click", () => (state.currentScore ? stepStructured(-1) : viewer.previousPage()));
byId("nextPageButton").addEventListener("click", () => (state.currentScore ? stepStructured(1) : viewer.nextPage()));
byId("zoomOutButton").addEventListener("click", () => viewer.zoomBy(-0.12));
byId("zoomInButton").addEventListener("click", () => viewer.zoomBy(0.12));
byId("markAButton").addEventListener("click", () => markLoop("a"));
byId("markBButton").addEventListener("click", () => markLoop("b"));
byId("clearLoopButton").addEventListener("click", clearLoop);
byId("loopToggleButton").addEventListener("click", toggleLoop);
reflectLoopButtons();
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
