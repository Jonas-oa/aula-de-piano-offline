import { rhythmExercises } from "./data/rhythm-exercises.js";
import {
  deletePiece,
  fileToStoredAsset,
  listPieces,
  savePiece,
} from "./core/library-store.js";
import { beatsPerBarFromSignature, midiToPortuguese, noteToMidi } from "./core/music.js";
import { parseMusicXml } from "./core/musicxml.js";
import { isMusicXmlFilename, readMusicXmlFile } from "./core/musicxml-file.js";
import { musicXmlBlob, musicXmlFilename } from "./core/musicxml-export.js";
import { MidiInput, OnsetEngine } from "./core/onset-engine.js";
import { PianoPlaybackEngine } from "./core/piano-playback-engine.js";
import { PianoRecognitionEngine } from "./core/piano-recognition-engine.js";
import {
  createFollowState,
  currentEvent as currentFollowEvent,
  forceAdvance as forceFollowAdvance,
  progress as followProgress,
  registerChord as registerFollowChord,
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
import { PianoKeyboard } from "./ui/piano-keyboard.js";
import {
  renderScore,
  scoreIndexAtClientX,
  scoreIndexForDrag,
} from "./ui/score-renderer.js";

const byId = (id) => document.getElementById(id);
const state = {
  pieces: [],
  selectedFiles: [],
  currentItem: null,
  currentEvents: null,
  currentMusicMetadata: null,
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

const pianoKeyboard = new PianoKeyboard(byId("pianoKeyboard"), byId("pianoHint"));

const playbackEngine = new PianoPlaybackEngine({
  onCursor(index) {
    if (state.currentScore) renderStructured(index);
  },
  onStateChange(status) {
    reflectPlaybackState(status);
  },
  onLoadProgress({ loaded, total }) {
    if (!total) return;
    setFeedback(
      "neutral",
      "CARREGANDO PIANO",
      `${loaded} de ${total} amostras`,
      "Na primeira reprodução, o piano fica salvo para uso offline.",
    );
  },
  onEnded(region) {
    const restartIndex = region?.events?.[0]?.originalIndex ?? state.loop.a ?? 0;
    if (state.currentScore) renderStructured(restartIndex);
    setFeedback("on-time", "FIM", "Audição concluída", "Toque novamente ou escolha outro trecho A–B.");
    void preparePracticeInput();
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
  onSamples: (samples, sampleRate, timestamp) =>
    handlePitchSamples(samples, sampleRate, timestamp),
  onLevel: (level) => {
    byId("levelBar").style.width = `${Math.round(level * 100)}%`;
  },
  onError: (error) => toast(readableError(error)),
  onStatus: (status) => reflectInputStatus(status),
});

const pianoRecognition = new PianoRecognitionEngine();

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

// Uma única fonte para "tempos por compasso" da peça aberta. A fórmula lida no
// MusicXML vence o valor escolhido no formulário de importação, que costuma
// ficar no 4/4 padrão mesmo quando a partitura está em outro compasso.
function currentBeatsPerBar(item = state.currentItem, metadata = state.currentMusicMetadata) {
  const candidates = [metadata?.beatsPerBar, item?.beatsPerBar];
  for (const candidate of candidates) {
    if (Number.isFinite(Number(candidate)) && Number(candidate) > 0) return Number(candidate);
  }
  return beatsPerBarFromSignature(item?.timeSignature);
}

function renderLibrary() {
  const query = byId("librarySearch").value.trim().toLocaleLowerCase("pt-BR");
  const pieces = state.pieces
    .filter((piece) => `${piece.title} ${piece.composer}`.toLocaleLowerCase("pt-BR").includes(query))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const grid = byId("pieceGrid");
  grid.replaceChildren();

  if (!pieces.length) {
    const empty = document.createElement("div");
    empty.className = "empty-library";
    empty.innerHTML = `
      <span class="score-thumbnail" aria-hidden="true"></span>
      <strong>${query ? "Nenhuma peça encontrada" : "Seu repertório ainda está vazio"}</strong>
      <span>${query ? "Tente outro título ou compositor." : "Adicione um arquivo MusicXML para começar a estudar."}</span>
    `;
    grid.append(empty);
    return;
  }

  for (const piece of pieces) {
    const card = document.createElement("article");
    card.className = "piece-card";
    const format = piece.musicXmlAsset ? "MusicXML" : "PDF salvo";
    card.innerHTML = `
      <div class="piece-card-top">
        <span class="score-thumbnail" aria-hidden="true"></span>
        <details class="card-menu">
          <summary aria-label="Abrir opções de ${escapeHtml(piece.title)}">•••</summary>
          <div class="card-menu-popover">
            ${piece.musicXmlAsset ? '<button class="download-musicxml-button" type="button">Baixar MusicXML</button>' : ""}
            <button class="delete-piece-button" type="button">Excluir do aparelho</button>
          </div>
        </details>
      </div>
      <h3>${escapeHtml(piece.title)}</h3>
      <p>${escapeHtml(piece.composer || "Compositor não informado")}</p>
      <div class="card-tags">
        <span class="tag">${format}</span>
        <span class="tag">${piece.bpm} bpm</span>
        <span class="tag">${escapeHtml(piece.timeSignature)}</span>
      </div>
      <div class="card-actions">
        <button class="primary-button open-piece-button">Continuar estudo</button>
      </div>
    `;
    card.querySelector(".open-piece-button").addEventListener("click", () => openPractice(piece));
    card.querySelector(".download-musicxml-button")?.addEventListener("click", () => {
      downloadPieceMusicXml(piece);
      card.querySelector(".card-menu").open = false;
    });
    card.querySelector(".delete-piece-button").addEventListener("click", async () => {
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
  const accepted = [...files].filter((file) => isMusicXmlFilename(file.name));
  state.selectedFiles = accepted.slice(0, 1);
  renderSelectedFiles();
  if (!accepted.length && files.length) {
    toast("Nesta versão, selecione um arquivo MusicXML (.musicxml, .mxl ou .xml).");
  } else if (accepted.length > 1) {
    toast("Selecione uma partitura por vez.");
  }
}

async function importPiece(event) {
  event.preventDefault();
  const xmlFile = state.selectedFiles.find((file) => isMusicXmlFilename(file.name));
  if (!xmlFile) {
    toast("Escolha um arquivo MusicXML (.musicxml, .mxl ou .xml).");
    return;
  }

  let parsed = null;
  try {
    parsed = parseMusicXml(await readMusicXmlFile(xmlFile));
  } catch (error) {
    toast(readableError(error));
    return;
  }

  const title = byId("pieceTitle").value.trim() || parsed?.title || "Peça importada";
  const musicXmlAsset = await fileToStoredAsset(xmlFile);
  const piece = {
    id: globalThis.crypto?.randomUUID?.() || `piece-${Date.now()}`,
    type: "piece",
    title,
    composer: byId("pieceComposer").value.trim() || parsed?.composer || "",
    bpm: Number(byId("pieceBpm").value) || 72,
    timeSignature: byId("pieceTimeSignature").value,
    pdfAsset: null,
    musicXmlAsset,
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

async function downloadPieceMusicXml(piece = state.currentItem) {
  if (!piece?.musicXmlAsset) {
    toast("Esta peça não possui um arquivo MusicXML.");
    return;
  }
  const filename = musicXmlFilename({
    assetName: piece.musicXmlAsset.name,
    title: piece.title,
  });
  let xmlText;
  try {
    xmlText = await readMusicXmlFile(piece.musicXmlAsset);
  } catch (error) {
    toast(readableError(error));
    return;
  }
  const url = URL.createObjectURL(musicXmlBlob({
    bytes: new TextEncoder().encode(xmlText),
  }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  toast(`MusicXML salvo como “${filename}”.`);
}

// Converte uma peça estruturada (exercício ou MusicXML) no formato do
// renderizador SVG próprio — a mesma pauta interativa para tudo.
function structuredScore(item, events, metadata = null) {
  const timeSignature = metadata?.timeSignature || item.timeSignature;
  return {
    id: item.id,
    title: item.title,
    key: item.key || "",
    bpm: item.bpm,
    timeSignature,
    beatsPerBar: currentBeatsPerBar(item, metadata),
    pickupBeats: metadata?.pickupBeats || 0,
    keyFifths: metadata?.keyFifths ?? 0,
    keyMode: metadata?.keyMode || "",
    clef: "grand",
    rests: metadata?.rests || [],
    measures: metadata?.measures || [],
    notes: (events || []).map((event) => ({
      beat: event.beat,
      duration: event.duration,
      measureIndex: event.measureIndex,
      measureNumber: event.measureNumber,
      // `notes` traz altura, mão (staff) e dedilhado vindos do MusicXML.
      pitches: (event.notes || []).map((note) => ({
        pitch: note.pitch,
        duration: note.duration ?? event.duration,
        staff: note.staff,
        clef: note.clef,
        partIndex: note.partIndex,
        voice: note.voice,
        type: note.type || "",
        dotCount: Number(note.dotCount) || 0,
        stem: note.stem || "",
        beams: Array.isArray(note.beams) ? note.beams : [],
        timeModification: note.timeModification || null,
        finger: note.finger ?? null,
        tieStart: Boolean(note.tieStart),
      })),
    })),
  };
}

function activeLoop() {
  return { a: state.loop.a, b: state.loop.b, count: state.loop.count };
}

function renderStructured(index, { fresh = false, immediate = false } = {}) {
  if (!state.currentScore) return;
  state.viewIndex = index;
  if (fresh) {
    viewer.showRhythm((container) =>
      renderScore(container, state.currentScore, index, activeLoop(), { immediate }));
  } else {
    renderScore(
      byId("documentStage"),
      state.currentScore,
      index,
      activeLoop(),
      { immediate },
    );
  }
  syncPianoKeyboard();
  if (!state.practiceActive && !state.countInActive) setStructuredPageLabel();
}

function pianoGroupsFromScore(index = state.viewIndex, count = 4) {
  if (!state.currentScore?.notes?.length) return [];
  return state.currentScore.notes.slice(index, index + count).map((event) =>
    (event.pitches || [])
      .map(({ pitch }) => {
        try {
          return noteToMidi(pitch);
        } catch {
          return null;
        }
      })
      .filter(Number.isFinite));
}

function syncPianoKeyboard() {
  if (!state.currentScore) {
    pianoKeyboard.setUnavailable("MusicXML necessário para indicar as notas");
    return;
  }
  pianoKeyboard.showNoteGroups(pianoGroupsFromScore());
}

function setStructuredPageLabel() {
  const total = state.currentScore?.notes?.length || 0;
  byId("pageLabel").textContent = total ? `Nota ${Math.min(state.viewIndex + 1, total)} / ${total}` : "Partitura";
}

function stepStructured(delta) {
  if (!state.currentScore || state.practiceActive || state.countInActive || playbackEngine.isPlaying) return;
  if (playbackEngine.isActive) {
    playbackEngine.stop({ preserveCursor: true });
  }
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

const SCORE_LONG_PRESS_MS = 430;
const SCORE_DRAG_THRESHOLD_PX = 10;
let scoreGesture = null;

function currentScoreSvg() {
  return byId("documentStage").querySelector("svg[data-score-key]");
}

function setLoopFromGesture(anchor, focus) {
  const total = state.currentScore?.notes?.length || 0;
  if (!total) return;
  const safeAnchor = Math.max(0, Math.min(total - 1, anchor));
  const safeFocus = Math.max(0, Math.min(total - 1, focus));
  state.loop.a = Math.min(safeAnchor, safeFocus);
  state.loop.b = Math.max(safeAnchor, safeFocus);
  state.loop.count = 0;
  refreshLoop();
}

function updateLoopHandle(point, index) {
  if (point === "a") {
    state.loop.a = Math.min(index, state.loop.b ?? index);
  } else {
    state.loop.b = Math.max(index, state.loop.a ?? index);
  }
  state.loop.count = 0;
  refreshLoop();
}

function beginScoreGesture(event) {
  const svg = event.target.closest?.("svg[data-score-key]");
  if (!svg || !state.currentScore || event.button !== 0) return;

  if (state.practiceActive || state.countInActive) {
    void stopPractice({ showResult: false });
  }
  if (playbackEngine.isActive) playbackEngine.stop({ preserveCursor: true });

  const stage = byId("documentStage");
  stage.setPointerCapture?.(event.pointerId);
  const handle = event.target.closest?.("[data-loop-point]");
  scoreGesture = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startIndex: state.viewIndex,
    anchorIndex: scoreIndexAtClientX(svg, state.currentScore, event.clientX),
    svgWidth: svg.getBoundingClientRect().width,
    mode: handle ? "loop-handle" : "pending",
    point: handle?.dataset.loopPoint || null,
    lastIndex: null,
    timer: null,
  };

  if (handle) {
    stage.classList.add("is-selecting-loop");
    event.preventDefault();
    return;
  }

  scoreGesture.timer = window.setTimeout(() => {
    if (!scoreGesture || scoreGesture.mode !== "pending") return;
    scoreGesture.mode = "loop-range";
    stage.classList.add("is-selecting-loop");
    setLoopFromGesture(scoreGesture.anchorIndex, scoreGesture.anchorIndex);
    byId("scoreGestureHint").textContent = "Arraste e solte para definir o trecho A–B";
    navigator.vibrate?.(25);
  }, SCORE_LONG_PRESS_MS);
}

function moveScoreGesture(event) {
  const gesture = scoreGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const svg = currentScoreSvg();
  if (!svg) return;
  const stage = byId("documentStage");
  const deltaX = event.clientX - gesture.startX;

  if (
    gesture.mode === "pending"
    && Math.abs(deltaX) >= SCORE_DRAG_THRESHOLD_PX
  ) {
    window.clearTimeout(gesture.timer);
    gesture.mode = "score-pan";
    stage.classList.add("is-dragging-score");
  }

  if (gesture.mode === "score-pan") {
    const index = scoreIndexForDrag(
      gesture.startIndex,
      deltaX,
      gesture.svgWidth,
      state.currentScore.notes.length,
      state.currentScore,
    );
    if (index !== gesture.lastIndex) {
      gesture.lastIndex = index;
      renderStructured(index, { immediate: true });
    }
    event.preventDefault();
    return;
  }

  if (gesture.mode === "loop-range") {
    const index = scoreIndexAtClientX(svg, state.currentScore, event.clientX);
    if (index !== gesture.lastIndex) {
      gesture.lastIndex = index;
      setLoopFromGesture(gesture.anchorIndex, index);
    }
    event.preventDefault();
    return;
  }

  if (gesture.mode === "loop-handle") {
    const index = scoreIndexAtClientX(svg, state.currentScore, event.clientX);
    if (index !== gesture.lastIndex) {
      gesture.lastIndex = index;
      updateLoopHandle(gesture.point, index);
    }
    event.preventDefault();
  }
}

function endScoreGesture(event, { cancelled = false } = {}) {
  const gesture = scoreGesture;
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  window.clearTimeout(gesture.timer);
  const stage = byId("documentStage");
  stage.classList.remove("is-dragging-score", "is-selecting-loop");
  stage.releasePointerCapture?.(gesture.pointerId);
  byId("scoreGestureHint").textContent = "Arraste a pauta · segure para marcar A–B";

  if (!cancelled && gesture.mode === "pending") {
    const svg = currentScoreSvg();
    if (svg) {
      renderStructured(
        scoreIndexAtClientX(svg, state.currentScore, event.clientX),
        { immediate: true },
      );
    }
  }
  if (!cancelled && (gesture.mode === "loop-range" || gesture.mode === "loop-handle")) {
    reflectLoopButtons();
    toast(`Trecho A–B: notas ${(state.loop.a ?? 0) + 1} a ${(state.loop.b ?? 0) + 1}.`);
  }
  scoreGesture = null;
}

function markLoop(point) {
  if (!state.currentScore) {
    toast("Disponível na partitura estruturada (MusicXML ou exercício).");
    return;
  }
  state.loop[point] = state.viewIndex;
  state.loop.count = 0;
  normalizeLoop();
  if (playbackEngine.isActive) {
    playbackEngine.stop({ preserveCursor: true });
  }
  refreshLoop();
  toast(point === "a" ? `Início A na nota ${state.viewIndex + 1}.` : `Fim B na nota ${state.viewIndex + 1}.`);
}

function clearLoop() {
  if (playbackEngine.isActive) {
    playbackEngine.stop({ preserveCursor: true });
  }
  state.loop = { a: null, b: null, active: false, count: 0 };
  refreshLoop();
}

function toggleLoop() {
  if (state.loop.a == null || state.loop.b == null) {
    toast("Marque A e B primeiro.");
    return;
  }
  state.loop.active = !state.loop.active;
  if (playbackEngine.isActive) {
    playbackEngine.stop({ preserveCursor: true });
    setFeedback("neutral", "REPETIÇÃO ALTERADA", state.loop.active ? "A–B será repetido" : "A–B tocará uma vez", "Toque para iniciar com a nova configuração.");
  }
  reflectLoopButtons();
  toast(state.loop.active ? "Repetição A–B ligada." : "Repetição A–B desligada.");
}

function lockPracticeOrientation() {
  try {
    const lock = screen.orientation?.lock?.("landscape");
    lock?.catch?.(() => {});
  } catch {
    // O bloqueio de orientação depende do navegador e do modo de instalação.
  }
}

function enterPracticeFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    lockPracticeOrientation();
    return;
  }
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) return;
  try {
    const result = request.call(root, { navigationUI: "hide" });
    Promise.resolve(result).then(lockPracticeOrientation).catch(() => {});
  } catch {
    // A tela continua utilizável quando o navegador não oferece tela cheia.
  }
}

async function leavePracticeFullscreen() {
  try {
    screen.orientation?.unlock?.();
  } catch {
    // Alguns navegadores não expõem o desbloqueio de orientação.
  }
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if ((document.fullscreenElement || document.webkitFullscreenElement) && exit) {
    try {
      await exit.call(document);
    } catch {
      // O sistema também permite sair da tela cheia pelos próprios gestos.
    }
  }
}

async function openPractice(item) {
  enterPracticeFullscreen();
  await stopPractice({ showResult: false, keepInput: false });
  playbackEngine.stop({ preserveCursor: true });
  state.currentItem = item;
  state.currentEvents = null;
  state.currentMusicMetadata = null;
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
  // Prepara a entrada assim que a tela abre. A análise permanece bloqueada por
  // `practiceActive`, então nenhum ataque entra na estatística antes de Iniciar.
  void preparePracticeInput();

  try {
    if (item.type === "rhythm") {
      state.currentEvents = item.events;
    } else if (item.musicXmlAsset) {
      state.currentMusicMetadata = parseMusicXml(await readMusicXmlFile(item.musicXmlAsset));
      state.currentEvents = state.currentMusicMetadata.events;
    }

    if (state.currentEvents?.length) {
      // Partitura interativa unificada (SVG próprio): mesma pauta para
      // exercícios e MusicXML, com destaque, rolagem fina e laço A–B.
      state.currentScore = structuredScore(item, state.currentEvents, state.currentMusicMetadata);
      renderStructured(0, { fresh: true });
      setStructuredPageLabel();
      setAnalysisMode(
        item.type === "rhythm" ? "Exercício estruturado" : "Partitura estruturada",
        "O app conhece cada nota. No modo professor o cursor espera a nota certa; marque A–B para repetir um trecho.",
      );
      byId("pdfOnlyOptions").hidden = true;
    } else if (item.pdfAsset) {
      await viewer.showPdf(item.pdfAsset);
      pianoKeyboard.setUnavailable("A partitura PDF não contém notas estruturadas");
      setAnalysisMode("Tempo pelo PDF", "Esta é uma partitura PDF salva anteriormente. O microfone pode acompanhar o ritmo, mas não identificar as notas escritas.");
      byId("pdfOnlyOptions").hidden = false;
    }
    applyPracticeModeAvailability();
    applyPieceControls();
  } catch (error) {
    byId("documentStage").innerHTML = `<div class="loading-state">${escapeHtml(readableError(error))}</div>`;
    toast(readableError(error));
  }
}

// Estado dos botões de iniciar/encerrar, que antes era repetido em quatro
// pontos diferentes e saía de sincronia com facilidade.
function reflectPracticeRunning(running) {
  byId("startPracticeButton").disabled = running;
  byId("stopPracticeButton").hidden = !running;
  byId("stopPracticeButton").disabled = !running;
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
  const playable = Boolean(state.currentEvents?.length);
  byId("loopControls").hidden = !structured;   // laço A–B só na partitura estruturada
  byId("modeToggle").hidden = !structured;
  byId("scoreGestureHint").hidden = !structured;
  byId("playbackControls").hidden = false;
  byId("playbackToggleButton").disabled = !playable;
  byId("playbackToggleButton").title = playable
    ? "Ouvir a peça ou o trecho A–B."
    : "A audição precisa de uma partitura estruturada.";
  byId("inputToggle").hidden = false;
  byId("startPracticeButton").hidden = false;
  byId("stopPracticeButton").hidden = true;
  byId("practiceStats").hidden = false;
  byId("levelMeter").hidden = false;
  byId("zoomOutButton").hidden = structured;    // zoom só no PDF
  byId("zoomInButton").hidden = structured;
  reflectPlaybackState("stopped");
}

function selectedPlaybackBounds() {
  const total = state.currentEvents?.length || 0;
  const hasRegion = state.loop.a != null && state.loop.b != null;
  return {
    startIndex: hasRegion ? state.loop.a : state.viewIndex,
    endIndex: hasRegion ? state.loop.b : Math.max(0, total - 1),
  };
}

async function togglePlayback() {
  enterPracticeFullscreen();
  if (!state.currentEvents?.length) return;
  if (playbackEngine.isPlaying) {
    playbackEngine.pause();
    return;
  }
  try {
    if (playbackEngine.isPaused) {
      await playbackEngine.resume();
      return;
    }
    await stopPractice({ showResult: false, keepInput: false });
    await playbackEngine.play(state.currentEvents, {
      bpm: Number(byId("tempoSlider").value),
      ...selectedPlaybackBounds(),
      loop: state.loop.active,
    });
  } catch (error) {
    toast(readableError(error));
    void preparePracticeInput();
  }
}

function stopPlayback() {
  const bounds = selectedPlaybackBounds();
  playbackEngine.stop({ preserveCursor: true });
  if (state.currentScore) renderStructured(bounds.startIndex);
  setFeedback("neutral", "PRONTO PARA OUVIR", "Piano acústico", "Toque para começar.");
  void preparePracticeInput();
}

function reflectPlaybackState(status) {
  const button = byId("playbackToggleButton");
  const stop = byId("playbackStopButton");
  if (!button || !stop) return;
  const labels = {
    loading: "Carregando…",
    playing: "❚❚ Pausar",
    paused: "▶ Continuar",
    stopped: "♫ Tocar",
  };
  button.textContent = labels[status] || labels.stopped;
  button.disabled = status === "loading" || !state.currentEvents?.length;
  stop.hidden = status === "stopped";
  stop.disabled = status === "loading";
  byId("startPracticeButton").disabled = status !== "stopped";
}

const PANEL_PREFS_KEY = "partitura-viva-study-side-panels";

function hasSavedPanelPreferences() {
  try {
    return localStorage.getItem(PANEL_PREFS_KEY) !== null;
  } catch {
    return false;
  }
}

function loadPanelPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) || "{}");
    return {
      top: saved.top === true,
      bottom: saved.bottom === true,
    };
  } catch {
    return { top: false, bottom: false };
  }
}

function setPanelExpanded(panel, expanded, { persist = true } = {}) {
  const top = panel === "top";
  if (top && !expanded && byId("tempoChip")?.classList.contains("is-expanded")) {
    setTempoExpanded(false);
  }
  const bar = byId(top ? "practiceTopbar" : "practiceBottombar");
  const button = byId(top ? "topbarToggleButton" : "bottombarToggleButton");
  const label = expanded
    ? `Ocultar ferramentas à ${top ? "esquerda" : "direita"}`
    : `Mostrar ferramentas à ${top ? "esquerda" : "direita"}`;

  bar.classList.toggle("is-collapsed", !expanded);
  if (!top) {
    // A barra de ações precisa saber que o painel da direita ocupou o espaço.
    byId("practiceView").classList.toggle("right-panel-open", expanded);
  }
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = top
    ? (expanded ? "‹" : "›")
    : (expanded ? "›" : "‹");

  if (expanded) {
    const otherPanel = top ? "bottom" : "top";
    const otherButton = byId(top ? "bottombarToggleButton" : "topbarToggleButton");
    if (otherButton.getAttribute("aria-expanded") === "true") {
      setPanelExpanded(otherPanel, false, { persist });
    }
  }

  if (persist) {
    const preferences = loadPanelPreferences();
    preferences[panel] = expanded;
    try {
      localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify(preferences));
    } catch {
      // A interface continua funcionando mesmo quando o armazenamento é bloqueado.
    }
  }
}

function restorePanelPreferences() {
  const preferences = loadPanelPreferences();
  // Na primeira visita as ferramentas aparecem abertas: modo de prática,
  // entrada, andamento e navegação vivem nesse painel, e com ele recolhido o
  // aluno não tem como descobrir que existem. Depois vale a escolha dele.
  const firstVisit = !hasSavedPanelPreferences();
  setPanelExpanded("top", firstVisit || preferences.top, { persist: false });
  setPanelExpanded("bottom", !firstVisit && preferences.bottom, { persist: false });
}

function togglePanel(panel) {
  const button = byId(panel === "top" ? "topbarToggleButton" : "bottombarToggleButton");
  setPanelExpanded(panel, button.getAttribute("aria-expanded") !== "true");
}

function setTempoExpanded(expanded) {
  const chip = byId("tempoChip");
  chip.classList.toggle("is-expanded", expanded);
  chip.setAttribute("aria-expanded", String(expanded));
  byId("practiceView").classList.toggle("tempo-open", expanded);
  if (expanded) byId("tempoSlider").focus({ preventScroll: true });
}

const STAT_LABELS = {
  // O modo professor conta acertos e erros de nota; o modo tempo mede desvio.
  teacher: { first: "Acertos", second: "Notas", third: "Erros" },
  tempo: { first: "No tempo", second: "Adiantado", third: "Atrasado" },
};

function reflectPracticeMode() {
  const teacher = state.practiceMode === "teacher";
  byId("teacherModeButton").classList.toggle("active", teacher);
  byId("tempoModeButton").classList.toggle("active", !teacher);
  byId("startPracticeButton").textContent = teacher ? "▶ Iniciar" : "▶ Contar";

  const labels = STAT_LABELS[teacher ? "teacher" : "tempo"];
  for (const element of document.querySelectorAll("[data-stat-label]")) {
    element.textContent = labels[element.dataset.statLabel] || element.textContent;
  }
  resetPracticeUi();
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
    await onsetEngine.stop();
    try {
      const count = await midiInput.connect();
      if (!count) toast("Conecte e ligue o piano MIDI, depois tente novamente.");
    } catch (error) {
      state.inputMode = "microphone";
      byId("microphoneModeButton").classList.add("active");
      byId("midiModeButton").classList.remove("active");
      toast(readableError(error));
      void preparePracticeInput();
    }
  } else {
    midiInput.disconnect();
    void preparePracticeInput();
  }
}

function reflectInputStatus(status) {
  const label = byId("inputStatus");
  if (!label) return;
  const labels = {
    requesting: "Ativando microfone…",
    active: "● Microfone ativo",
    stopped: state.inputMode === "midi" ? "Entrada MIDI" : "Microfone em espera",
    error: "Microfone bloqueado",
  };
  label.dataset.status = status;
  label.textContent = labels[status] || labels.stopped;
}

async function preparePracticeInput() {
  if (
    state.currentView !== "practiceView"
    || state.inputMode !== "microphone"
    || playbackEngine.isActive
  ) return;
  try {
    await onsetEngine.start();
  } catch {
    // O motor já apresenta a causa. Iniciar continua disponível para uma nova
    // tentativa depois que o usuário liberar a permissão.
  }
}

async function startPractice() {
  enterPracticeFullscreen();
  if (!state.currentItem || state.practiceActive || state.countInActive) return;
  if (playbackEngine.isActive) playbackEngine.stop({ preserveCursor: true });
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
  pianoRecognition.reset();
  resetPracticeUi();
  reflectPracticeRunning(true);
  await wakeLock.setEnabled(true);

  try {
    await startInput();
  } catch (error) {
    reflectPracticeRunning(false);
    toast(readableError(error));
    return;
  }

  state.practiceActive = true;
  showFollowCursor();
  armCurrentMicrophoneEvent();
  const micHint = state.inputMode === "microphone"
    ? "O microfone já está ouvindo a nota ou o acorde escrito."
    : "Toque a nota certa para avançar. Se errar, o cursor espera.";
  setFeedback("neutral", "SIGA A PARTITURA", "Toque a primeira nota", micHint);
  updateFollowStats();
}

async function startTempoPractice() {
  const bpm = Number(byId("tempoSlider").value);
  const beatMs = 60_000 / bpm;
  const barBeats = currentBeatsPerBar();
  const countBeats = Math.max(2, Math.round(barBeats));

  state.schedule = [];
  state.attempts = [];
  state.missed = 0;
  state.lastMidiAttempt = null;
  state.countInActive = true;
  resetPracticeUi();
  reflectPracticeRunning(true);
  await wakeLock.setEnabled(true);

  try {
    await startInput();
  } catch (error) {
    state.countInActive = false;
    reflectPracticeRunning(false);
    toast(readableError(error));
    return;
  }

  const startAt = performance.now() + countBeats * beatMs + 120;
  if (state.currentEvents?.length) {
    state.schedule = eventsToSchedule(state.currentEvents, bpm, startAt);
  } else {
    state.schedule = createPulseGrid({
      bpm,
      startMs: startAt,
      subdivision: Number(byId("subdivisionSelect").value),
      beatsPerBar: barBeats,
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
    if (midi === null) {
      const expected = currentFollowEvent(state.follow)?.midis || [];
      if (!expected.length) {
        handleFollowResult(forceFollowAdvance(state.follow));
        return;
      }
      pianoRecognition.armForAttack(expected, timestamp);
      return;
    }
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
  handleFollowResult(registerFollowNote(state.follow, midi));
}

function armCurrentMicrophoneEvent(timestamp = performance.now()) {
  if (
    !state.practiceActive
    || state.practiceMode !== "teacher"
    || state.inputMode !== "microphone"
    || !state.follow
  ) return;
  const expected = currentFollowEvent(state.follow)?.midis || [];
  if (!expected.length) return;
  pianoRecognition.armExpected(expected, timestamp);
}

function handlePitchSamples(samples, sampleRate, timestamp) {
  if (
    !state.practiceActive
    || state.practiceMode !== "teacher"
    || state.inputMode !== "microphone"
    || !state.follow
  ) return;

  const analysis = pianoRecognition.process(samples, sampleRate, timestamp);
  if (!analysis) return;
  if (analysis.outcome === "match" || analysis.outcome === "wrong") {
    handleFollowResult(registerFollowChord(state.follow, analysis.detected));
    return;
  }

  if (analysis.status === "incomplete") {
    setFeedback("early", "QUASE", "Complete o acorde", `Falta: ${expectedNoteLabel(analysis.missing)}`);
  } else if (analysis.status === "extra") {
    setFeedback("late", "NOTA EXTRA", "Confira o acorde", `Extra: ${expectedNoteLabel(analysis.extra)}`);
  } else if (analysis.status === "wrong" && analysis.detected.length) {
    setFeedback("late", "NOTA DIFERENTE", "O cursor vai esperar", `Ouvi: ${expectedNoteLabel(analysis.detected)}`);
  }
}

function handleFollowResult(result) {

  if (result.type === "idle") return;

  if (result.type === "wrong") {
    state.followStats.wrong += 1;
    const wanted = result.remaining?.length ? result.remaining : result.expected;
    const detail = result.extra?.length
      ? `Extra: ${expectedNoteLabel(result.extra)} · Toque: ${expectedNoteLabel(wanted)}`
      : `Toque: ${expectedNoteLabel(wanted)}`;
    setFeedback("late", "NOTA ERRADA", "Ainda não é essa", detail);
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
    armCurrentMicrophoneEvent();
    const target = expectedNoteLabel(currentFollowEvent(state.follow)?.midis);
    setFeedback("on-time", `↻ REPETINDO ${state.loop.count}×`, "Voltando ao A", `Toque: ${target}`);
    updateFollowStats();
    return;
  }

  moveFollowCursorTo(result.index);
  armCurrentMicrophoneEvent();
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

async function stopPractice({ showResult = true, keepInput = true } = {}) {
  const hadActivity = state.practiceActive || state.countInActive || state.attempts.length;
  state.practiceActive = false;
  state.countInActive = false;
  for (const timer of state.countTimers) window.clearTimeout(timer);
  state.countTimers = [];
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  byId("countInDisplay")?.classList.remove("visible");
  reflectPracticeRunning(false);
  pianoRecognition.reset();
  if (!keepInput) await onsetEngine.stop();
  else void preparePracticeInput();

  if (showResult && hadActivity) showPracticeResult();
}

function resetPracticeUi() {
  byId("onTimeStat").textContent = "0";
  byId("earlyStat").textContent = "0";
  byId("lateStat").textContent = "0";
  byId("accuracyStat").textContent = "0%";
  byId("attemptTimeline").replaceChildren();
  setFeedback(
    "neutral",
    "PRONTO",
    "Observe a partitura",
    state.practiceMode === "teacher"
      ? "Toque a primeira nota quando quiser — o cursor espera por você."
      : "O aplicativo contará um compasso antes de começar.",
  );
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
  const messageKey = `${grade}\u0000${kicker}\u0000${title}\u0000${detail}`;
  if (panel.dataset.messageKey === messageKey) return;
  panel.dataset.messageKey = messageKey;
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
  setTempoExpanded(false);
  playbackEngine.stop({ preserveCursor: true });
  await stopPractice({ showResult: false, keepInput: false });
  await wakeLock.setEnabled(false);
  await leavePracticeFullscreen();
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
byId("documentStage").addEventListener("pointerdown", beginScoreGesture);
byId("documentStage").addEventListener("pointermove", moveScoreGesture);
byId("documentStage").addEventListener("pointerup", endScoreGesture);
byId("documentStage").addEventListener("pointercancel", (event) =>
  endScoreGesture(event, { cancelled: true }));
byId("topbarToggleButton").addEventListener("click", () => togglePanel("top"));
byId("bottombarToggleButton").addEventListener("click", () => togglePanel("bottom"));
byId("microphoneModeButton").addEventListener("click", () => selectInputMode("microphone"));
byId("midiModeButton").addEventListener("click", () => selectInputMode("midi"));
byId("teacherModeButton").addEventListener("click", () => selectPracticeMode("teacher"));
byId("tempoModeButton").addEventListener("click", () => selectPracticeMode("tempo"));
byId("startPracticeButton").addEventListener("click", startPractice);
byId("stopPracticeButton").addEventListener("click", () => stopPractice({ showResult: true }));
byId("playbackToggleButton").addEventListener("click", togglePlayback);
byId("playbackStopButton").addEventListener("click", stopPlayback);
byId("tempoChip").addEventListener("pointerdown", () => setTempoExpanded(true));
byId("tempoChip").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    setTempoExpanded(true);
  }
});
byId("tempoSlider").addEventListener("input", (event) => {
  byId("tempoOutput").value = event.target.value;
  if (playbackEngine.isActive) {
    playbackEngine.stop({ preserveCursor: true });
    setFeedback("neutral", "ANDAMENTO ALTERADO", `${event.target.value} bpm`, "Toque para continuar no novo andamento.");
  }
});
byId("previousPageButton").addEventListener("click", () => (state.currentScore ? stepStructured(-1) : viewer.previousPage()));
byId("nextPageButton").addEventListener("click", () => (state.currentScore ? stepStructured(1) : viewer.nextPage()));
byId("zoomOutButton").addEventListener("click", () => viewer.zoomBy(-0.12));
byId("zoomInButton").addEventListener("click", () => viewer.zoomBy(0.12));
byId("markAButton").addEventListener("click", () => markLoop("a"));
byId("markBButton").addEventListener("click", () => markLoop("b"));
byId("clearLoopButton").addEventListener("click", clearLoop);
byId("loopToggleButton").addEventListener("click", toggleLoop);
document.addEventListener("pointerdown", (event) => {
  if (
    byId("tempoChip").classList.contains("is-expanded")
    && !byId("tempoChip").contains(event.target)
  ) setTempoExpanded(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setTempoExpanded(false);
});
reflectLoopButtons();
restorePanelPreferences();
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
