import { rhythmExercises } from "./data/rhythm-exercises.js";
import {
  clearSessionLogs,
  deletePiece,
  fileToStoredAsset,
  listPieces,
  listSessionLogs,
  savePiece,
  saveSessionLog,
} from "./core/library-store.js";
import {
  describeDevice,
  serializeSessionLog,
  SessionLog,
  sessionLogFilename,
} from "./core/session-log.js";
import { beatsPerBarFromSignature, midiToPortuguese, noteToMidi } from "./core/music.js";
import { parseMusicXml } from "./core/musicxml.js";
import { isMusicXmlFilename, readMusicXmlFile } from "./core/musicxml-file.js";
import { musicXmlBlob, musicXmlFilename } from "./core/musicxml-export.js";
import { MidiInput, OnsetEngine } from "./core/onset-engine.js";
import {
  evaluateNeuralFollowResult,
  NeuralPianoShadowEngine,
} from "./core/neural-piano-shadow-engine.js";
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
import {
  clampTempo,
  tempoFromPercent,
  tempoPercent,
} from "./core/tempo-control.js";
import {
  availablePracticeHands,
  normalizeMeasureRange,
  notesForPracticeHand,
  selectedPracticeEvents,
} from "./core/practice-selection.js";
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
  pendingImport: null,
  editingPieceId: null,
  currentItem: null,
  currentEvents: null,
  currentMusicMetadata: null,
  currentView: "libraryView",
  inputMode: "microphone",
  practiceMode: "teacher",
  practiceHand: "both",
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
  keyboardVisible: true,
  lastSessionLog: null,
  sessionLogs: [],
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
    setFeedback("on-time", "FIM", "Audição concluída", "Ouça novamente ou selecione outro trecho.");
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

const neuralUiState = {
  modelStatus: "disabled",
  advanceEnabled: false,
  lastAdvanceToken: null,
  activationPromise: null,
  activationGeneration: 0,
};

const neuralShadowEngine = new NeuralPianoShadowEngine({
  onStatus: (status, detail) => reflectNeuralStatus(status, detail),
  onResult: (result) => maybeAdvanceWithNeural(result),
});

const onsetEngine = new OnsetEngine({
  onOnset: (timestamp) => handleOnset(timestamp, null),
  onSamples: (samples, sampleRate, timestamp) =>
    handlePitchSamples(samples, sampleRate, timestamp),
  onPcmChunk: (samples, sampleRate) =>
    neuralShadowEngine.pushPcm(samples, sampleRate),
  onPcmStatus: (status, error) => reflectNeuralCaptureStatus(status, error),
  onLevel: (level) => {
    byId("levelBar").style.width = `${Math.round(level * 100)}%`;
  },
  onError: (error) => {
    sessionLog.addError(error, { origem: "microfone" });
    toast(readableError(error));
  },
  onStatus: (status) => {
    sessionLog.add("microfone", { estado: status });
    reflectInputStatus(status);
  },
});

const pianoRecognition = new PianoRecognitionEngine();

// Diário da sessão. Só números e rótulos — nunca áudio. Serve para investigar
// depois o que não dá para ver na hora: por que o cursor andou ou por que ficou
// parado enquanto o aluno tocava.
const sessionLog = new SessionLog();
// Qual build o aparelho está realmente executando. Vem do nome do cache do
// service worker em vez de uma constante repetida no código, porque o problema
// pode ser justamente um service worker antigo servindo a versão de ontem.
async function runningBuild() {
  try {
    const names = await caches?.keys?.();
    return names?.find((name) => name.startsWith("partitura-viva")) || "sem cache";
  } catch {
    return "indisponível";
  }
}

const midiInput = new MidiInput({
  onNote: ({ midi, timestamp }) => handleOnset(timestamp, midi),
  onStatus: (status, count) => {
    if (status === "connected") toast(`${count} entrada MIDI conectada${count > 1 ? "s" : ""}.`);
    if (status === "empty") toast("Nenhum piano MIDI foi encontrado.");
    // Conectar e desconectar o instrumento no meio do estudo precisa aparecer:
    // sem isso o indicador continuava dizendo "Microfone em espera".
    if (state.inputMode === "midi" && status !== "disconnected") {
      reflectInputStatus(status === "connected" ? "midi" : "stopped");
    }
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
  const panel = byId("repertoirePanel");
  const total = state.pieces.length;
  const count = byId("repertoireCount");
  count.textContent = query
    ? `${pieces.length} de ${total} ${total === 1 ? "música" : "músicas"}`
    : `${total} ${total === 1 ? "música salva" : "músicas salvas"}`;
  // Na primeira visita, uma biblioteca vazia fica aberta para não esconder o
  // caminho de adicionar a primeira partitura. Quem já tem músicas vê a pasta
  // recolhida e escolhe quando abrir, que é justamente o ganho de organização.
  if (!panel.dataset.initialized) {
    panel.open = total === 0;
    panel.dataset.initialized = "true";
  }
  if (total === 0) panel.open = true;
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
            <button class="edit-piece-button" type="button">Editar dados</button>
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
    card.querySelector(".edit-piece-button").addEventListener("click", () => {
      card.querySelector(".card-menu").open = false;
      openPieceEditor(piece);
    });
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

async function acceptFiles(files) {
  const accepted = [...files].filter((file) => isMusicXmlFilename(file.name));
  state.selectedFiles = accepted.slice(0, 1);
  state.pendingImport = null;
  renderSelectedFiles();
  if (!accepted.length && files.length) {
    toast("Nesta versão, selecione um arquivo MusicXML (.musicxml, .mxl ou .xml).");
    return;
  }
  if (accepted.length > 1) toast("Selecione uma partitura por vez.");
  await prefillImportForm(state.selectedFiles[0]);
}

// O próprio arquivo já sabe título, compositor, compasso e andamento. Ler esses
// valores na hora da escolha evita que a peça seja salva com o 4/4 e os 72 BPM
// padrão do formulário, que depois contradiziam a partitura na tela de estudo.
async function prefillImportForm(file) {
  if (!file) return;
  let parsed = null;
  try {
    parsed = parseMusicXml(await readMusicXmlFile(file));
  } catch (error) {
    toast(readableError(error));
    return;
  }
  state.pendingImport = { name: file.name, parsed };

  if (parsed.title && !byId("pieceTitle").value.trim()) byId("pieceTitle").value = parsed.title;
  if (parsed.composer && !byId("pieceComposer").value.trim()) {
    byId("pieceComposer").value = parsed.composer;
  }
  if (parsed.timeSignature) selectTimeSignatureOption(parsed.timeSignature);
  if (parsed.tempo) byId("pieceBpm").value = String(clampTempo(parsed.tempo));
  if (!parsed.events?.length) {
    toast("Este arquivo não traz notas tocáveis. Escolha outra partitura.");
  }
}

// Compassos fora da lista curta do formulário (7/8, 9/8…) existem no repertório
// real; recusá-los em silêncio salvaria a peça com a fórmula errada.
function selectTimeSignatureOption(timeSignature) {
  const select = byId("pieceTimeSignature");
  if (![...select.options].some((option) => option.value === timeSignature)) {
    const option = document.createElement("option");
    option.value = timeSignature;
    option.textContent = timeSignature;
    select.append(option);
  }
  select.value = timeSignature;
}

async function importPiece(event) {
  event.preventDefault();
  const xmlFile = state.selectedFiles.find((file) => isMusicXmlFilename(file.name));
  if (!xmlFile) {
    toast("Escolha um arquivo MusicXML (.musicxml, .mxl ou .xml).");
    return;
  }

  let parsed = state.pendingImport?.name === xmlFile.name ? state.pendingImport.parsed : null;
  if (!parsed) {
    try {
      parsed = parseMusicXml(await readMusicXmlFile(xmlFile));
    } catch (error) {
      toast(readableError(error));
      return;
    }
  }
  // Sem ataques não há o que estudar, ouvir ou desenhar: a peça abriria numa
  // tela de estudo permanentemente vazia.
  if (!parsed.events?.length) {
    toast("Esta partitura não contém notas para estudar.");
    return;
  }

  const title = byId("pieceTitle").value.trim() || parsed?.title || "Peça importada";
  const musicXmlAsset = await fileToStoredAsset(xmlFile);
  const piece = {
    id: globalThis.crypto?.randomUUID?.() || `piece-${Date.now()}`,
    type: "piece",
    title,
    composer: byId("pieceComposer").value.trim() || parsed?.composer || "",
    bpm: clampTempo(byId("pieceBpm").value || parsed?.tempo || 72),
    // A fórmula lida no arquivo vence a do formulário: é ela que a tela de
    // estudo usa, e o cartão do repertório precisa dizer a mesma coisa.
    timeSignature: parsed?.timeSignature || byId("pieceTimeSignature").value,
    beatsPerBar: Number(parsed?.beatsPerBar) > 0 ? Number(parsed.beatsPerBar) : null,
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
    state.pendingImport = null;
    renderSelectedFiles();
    byId("repertoirePanel").open = true;
    renderLibrary();
    showView("libraryView");
    toast("Peça salva neste aparelho.");
  } catch (error) {
    toast(`Não foi possível salvar: ${readableError(error)}`);
  }
}

// Depois de importada, uma peça só podia ser corrigida excluindo e importando
// de novo. O arquivo em si continua intocado: aqui muda apenas como a peça se
// apresenta no repertório e com que andamento ela abre.
function openPieceEditor(piece) {
  state.editingPieceId = piece.id;
  byId("editPieceTitle").value = piece.title || "";
  byId("editPieceComposer").value = piece.composer || "";
  byId("editPieceBpm").value = String(clampTempo(piece.bpm || 72));
  byId("editPieceTimeSignature").value = piece.timeSignature || "";
  byId("editPieceDialog").showModal();
}

// O formulário usa `method="dialog"`: o próprio navegador fecha o diálogo no
// envio, então aqui basta persistir. A peça vem por parâmetro porque o
// fechamento limpa o estado e não há ordem garantida entre os dois eventos.
async function savePieceEdits(pieceId) {
  const piece = state.pieces.find((item) => item.id === pieceId);
  if (!piece) return;

  const timeSignature = byId("editPieceTimeSignature").value.trim();
  const updated = {
    ...piece,
    title: byId("editPieceTitle").value.trim() || piece.title,
    composer: byId("editPieceComposer").value.trim(),
    bpm: clampTempo(byId("editPieceBpm").value, piece.bpm),
    timeSignature: timeSignature || piece.timeSignature,
    // A fórmula digitada manda também nos tempos por compasso; deixar o valor
    // antigo faria a contagem de entrada discordar do que o cartão mostra.
    beatsPerBar: timeSignature ? beatsPerBarFromSignature(timeSignature) : piece.beatsPerBar ?? null,
  };

  try {
    await savePiece(updated);
  } catch (error) {
    toast(`Não foi possível salvar: ${readableError(error)}`);
    return;
  }
  state.pieces = state.pieces.map((item) => (item.id === updated.id ? updated : item));
  if (state.currentItem?.id === updated.id) state.currentItem = updated;
  renderLibrary();
  toast("Dados da peça atualizados.");
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

// Lista as sessões gravadas no repertório. O diálogo de resultado sozinho não
// bastava: quem sai da tela de estudo pela seta nunca chega a vê-lo, e o aluno
// que quer relatar um problema costuma procurar o arquivo depois, com a cabeça
// fria, e não no instante em que fechou a prática.
async function renderSessionLogs() {
  const list = byId("sessionLogList");
  let stored = [];
  try {
    stored = await listSessionLogs();
  } catch (error) {
    list.replaceChildren();
    list.append(Object.assign(document.createElement("p"), {
      className: "session-log-empty",
      textContent: `Diários indisponíveis: ${readableError(error)}`,
    }));
    return;
  }

  state.sessionLogs = stored;
  list.replaceChildren();
  byId("clearSessionLogsButton").disabled = !stored.length;
  if (!stored.length) {
    list.append(Object.assign(document.createElement("p"), {
      className: "session-log-empty",
      textContent: "Nenhuma sessão gravada ainda. Estude uma vez e o diário aparece aqui.",
    }));
    return;
  }

  for (const record of stored) {
    const started = new Date(record.inicio);
    const minutes = record.duracaoMs ? Math.max(1, Math.round(record.duracaoMs / 60_000)) : null;
    const item = document.createElement("article");
    item.className = "session-log-item";
    item.innerHTML = `
      <div class="session-log-info">
        <strong>${escapeHtml(record.contexto?.peca || "Exercício de ritmo")}</strong>
        <small>${escapeHtml(started.toLocaleString("pt-BR"))}${minutes ? ` · ${minutes} min` : ""}${
      record.resumo?.notasSeguidas ? ` · ${escapeHtml(record.resumo.notasSeguidas)} notas` : ""
    }</small>
      </div>
      <div class="session-log-buttons">
        <button class="ghost-button share" type="button" hidden>Compartilhar</button>
        <button class="ghost-button download" type="button">Baixar</button>
      </div>
    `;
    const file = sessionLogFile(record);
    const shareButton = item.querySelector(".share");
    shareButton.hidden = !navigator.canShare?.({ files: [file] });
    shareButton.addEventListener("click", () => void shareSessionLog(record));
    item.querySelector(".download").addEventListener("click", () => downloadSessionLog(record));
    list.append(item);
  }
}

function sessionLogFile(record = state.lastSessionLog) {
  if (!record) return null;
  // `text/plain` e extensão `.log`: é o que o GitHub aceita como anexo de
  // issue. O conteúdo é JSON, que o navegador salvaria como `.json` — e essa
  // seria justamente a extensão recusada na hora de anexar.
  return new File([serializeSessionLog(record)], sessionLogFilename(record), {
    type: "text/plain",
  });
}

function downloadSessionLog(record = state.lastSessionLog) {
  const file = sessionLogFile(record);
  if (!file) {
    toast("Nenhuma sessão gravada ainda.");
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  toast(`Diário salvo como “${file.name}”.`);
}

async function shareSessionLog(record = state.lastSessionLog) {
  const file = sessionLogFile(record);
  if (!file) {
    toast("Nenhuma sessão gravada ainda.");
    return;
  }
  try {
    await navigator.share({
      files: [file],
      title: "Diário de estudo — Partitura Viva",
      text: `Sessão de ${record?.contexto?.peca || "estudo"}.`,
    });
  } catch (error) {
    // Cancelar o menu de compartilhamento é uma escolha do usuário, não uma
    // falha que mereça aviso na tela.
    if (error?.name === "AbortError") return;
    sessionLog.addError(error, { origem: "compartilhamento" });
    downloadSessionLog(record);
  }
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

const PRACTICE_HAND_LABELS = {
  both: "Duas mãos",
  right: "Mão direita",
  left: "Mão esquerda",
};

function currentPracticeEvents({ relative = false } = {}) {
  const selected = selectedPracticeEvents(
    state.currentEvents,
    state.practiceHand,
    state.loop,
  );
  if (!relative || !selected.length) return selected;
  const originBeat = Number(selected[0].beat) || 0;
  return selected.map((event) => ({
    ...event,
    beat: Math.max(0, (Number(event.beat) || 0) - originBeat),
  }));
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
  const groups = [];
  for (let eventIndex = index;
    eventIndex < state.currentScore.notes.length && groups.length < count;
    eventIndex += 1) {
    const event = state.currentScore.notes[eventIndex];
    const midis = notesForPracticeHand(event.pitches, state.practiceHand)
      .map(({ pitch }) => {
        try {
          return noteToMidi(pitch);
        } catch {
          return null;
        }
      })
      .filter(Number.isFinite);
    if (midis.length) groups.push(midis);
  }
  return groups;
}

function syncPianoKeyboard() {
  if (!state.currentScore) {
    pianoKeyboard.setUnavailable("MusicXML necessário para indicar as notas");
    return;
  }
  pianoKeyboard.showNoteGroups(pianoGroupsFromScore());
}

// "Nota 37 / 412" não diz nada a quem estuda por compassos, que é como a peça é
// ensaiada e como o professor pede o trecho. O número do compasso vem do
// MusicXML e passa a liderar o rótulo.
function progressLabel(index, total) {
  if (!total) return "Partitura";
  const position = Math.min(Math.max(index, 0), total - 1);
  const measure = state.currentScore?.notes?.[position]?.measureNumber;
  const note = `${position + 1}/${total}`;
  return measure ? `Comp. ${measure} · ${note}` : `Nota ${note}`;
}

function setStructuredPageLabel() {
  const total = state.currentScore?.notes?.length || 0;
  byId("pageLabel").textContent = progressLabel(state.viewIndex, total);
}

function stepStructured(delta) {
  if (!state.currentScore || state.practiceActive || state.countInActive) return;
  // Durante a audição os botões ‹ › não podiam ficar mudos: o gesto de arrastar
  // a pauta já interrompe a reprodução, e aqui a regra passa a ser a mesma.
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
  const range = normalizeMeasureRange(state.currentScore.notes, anchor, focus);
  state.loop.a = range.a;
  state.loop.b = range.b;
  state.loop.count = 0;
  refreshLoop();
}

function updateLoopHandle(point, index) {
  const anchor = point === "a" ? index : state.loop.a ?? index;
  const focus = point === "b" ? index : state.loop.b ?? index;
  const range = normalizeMeasureRange(state.currentScore?.notes || [], anchor, focus);
  state.loop.a = range.a;
  state.loop.b = range.b;
  state.loop.count = 0;
  refreshLoop();
}

function selectedMeasureLabel() {
  if (!state.currentScore || (state.loop.a == null && state.loop.b == null)) return "trecho";
  const startIndex = state.loop.a ?? state.loop.b;
  const endIndex = state.loop.b ?? state.loop.a;
  const start = state.currentScore.notes[startIndex];
  const end = state.currentScore.notes[endIndex];
  const first = start?.measureNumber || (Number.isInteger(start?.measureIndex) ? start.measureIndex + 1 : null);
  const last = end?.measureNumber || (Number.isInteger(end?.measureIndex) ? end.measureIndex + 1 : null);
  if (!first || !last) return startIndex === endIndex
    ? `nota ${startIndex + 1}`
    : `notas ${startIndex + 1}–${endIndex + 1}`;
  return String(first) === String(last)
    ? `compasso ${first}`
    : `compassos ${first}–${last}`;
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
    byId("scoreGestureHint").textContent = "Arraste e solte para selecionar o trecho";
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
  byId("scoreGestureHint").textContent = "Arraste a pauta · segure para selecionar um trecho";

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
    toast(`Trecho selecionado: ${selectedMeasureLabel()}.`);
  }
  scoreGesture = null;
}

function markLoop(point) {
  if (!state.currentScore) {
    toast("Disponível na partitura estruturada (MusicXML ou exercício).");
    return;
  }
  const singleMeasure = normalizeMeasureRange(
    state.currentScore.notes,
    state.viewIndex,
    state.viewIndex,
  );
  state.loop[point] = point === "a" ? singleMeasure.a : singleMeasure.b;
  state.loop.count = 0;
  normalizeLoop();
  if (state.loop.a != null && state.loop.b != null) {
    const range = normalizeMeasureRange(state.currentScore.notes, state.loop.a, state.loop.b);
    state.loop.a = range.a;
    state.loop.b = range.b;
  }
  if (playbackEngine.isActive) {
    playbackEngine.stop({ preserveCursor: true });
  }
  refreshLoop();
  toast(point === "a"
    ? `Início selecionado: ${selectedMeasureLabel()}.`
    : `Fim selecionado: ${selectedMeasureLabel()}.`);
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
    toast("Defina o início e o fim do trecho primeiro.");
    return;
  }
  state.loop.active = !state.loop.active;
  if (playbackEngine.isActive) {
    playbackEngine.stop({ preserveCursor: true });
    setFeedback("neutral", "REPETIÇÃO ALTERADA", state.loop.active ? "O trecho será repetido" : "O trecho será tocado uma vez", "Inicie com a nova configuração.");
  }
  reflectLoopButtons();
  toast(state.loop.active ? "Repetição do trecho ligada." : "Repetição do trecho desligada.");
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
  state.practiceHand = "both";
  state.loop = { a: null, b: null, active: false, count: 0 };
  resetNeuralSession();
  reflectLoopButtons();
  state.practiceMode = "teacher"; // cada peça abre no modo professor; PDF cai para tempo abaixo
  state.exactMode = item.type === "rhythm" || Boolean(item.musicXmlAsset);

  byId("practiceTitle").textContent = item.title;
  byId("practiceComposer").textContent = (item.composer || item.style || "EXERCÍCIO").toUpperCase();
  reflectTempo(item.bpm || 72);
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
      // exercícios e MusicXML, com destaque, rolagem fina e trecho repetível.
      state.currentScore = structuredScore(item, state.currentEvents, state.currentMusicMetadata);
      renderStructured(0, { fresh: true });
      setStructuredPageLabel();
      setAnalysisMode(
        item.type === "rhythm" ? "Exercício estruturado" : "Partitura estruturada",
        "O app conhece cada nota. Em Aguardar notas, o cursor só avança após a nota certa; selecione um trecho para estudá-lo.",
      );
      byId("pdfOnlyOptions").hidden = true;
    } else if (item.pdfAsset) {
      await viewer.showPdf(item.pdfAsset);
      pianoKeyboard.setUnavailable("A partitura PDF não contém notas estruturadas");
      setAnalysisMode("Avaliar ritmo no PDF", "Esta é uma partitura PDF salva anteriormente. O microfone pode acompanhar o ritmo, mas não identificar as notas escritas.");
      byId("pdfOnlyOptions").hidden = false;
    } else {
      // Sem ataques e sem PDF não há nada para desenhar. Antes desta saída o
      // palco ficava parado no "Carregando partitura…" para sempre.
      byId("documentStage").replaceChildren();
      byId("documentStage").append(Object.assign(document.createElement("div"), {
        className: "loading-state",
        textContent: "Esta peça não contém notas para estudar. Importe a partitura novamente.",
      }));
      pianoKeyboard.setUnavailable("A peça não trouxe notas");
      setAnalysisMode(
        "Partitura vazia",
        "O arquivo salvo não traz ataques legíveis. Reimporte a peça a partir do MusicXML original.",
      );
      byId("pdfOnlyOptions").hidden = true;
    }
    applyPracticeModeAvailability();
    applyPracticeHandAvailability();
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
  byId("tempoChipButton").disabled = running;
  for (const button of document.querySelectorAll("#handToggle .choice-button")) {
    button.disabled = running || button.dataset.available === "false";
  }
  if (running) setTempoExpanded(false);
}

function setAnalysisMode(label, explanation) {
  byId("analysisModeBadge").dataset.baseLabel = label;
  byId("analysisExplanation").textContent = explanation;
  updateAnalysisModeBadge();
}

function updateAnalysisModeBadge() {
  const badge = byId("analysisModeBadge");
  const base = badge.dataset.baseLabel || "Partitura";
  badge.textContent = state.currentScore
    ? `${base} · ${PRACTICE_HAND_LABELS[state.practiceHand]}`
    : base;
}

function reflectPracticeHand() {
  const buttons = {
    both: byId("bothHandsButton"),
    right: byId("rightHandButton"),
    left: byId("leftHandButton"),
  };
  for (const [hand, button] of Object.entries(buttons)) {
    const active = state.practiceHand === hand;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateAnalysisModeBadge();
  syncPianoKeyboard();
}

function applyPracticeHandAvailability() {
  const structured = Boolean(state.currentScore);
  const available = availablePracticeHands(state.currentEvents);
  byId("handToggle").hidden = !structured;
  for (const [hand, id] of [["right", "rightHandButton"], ["left", "leftHandButton"]]) {
    const button = byId(id);
    button.dataset.available = String(available[hand]);
    button.disabled = !available[hand];
    button.title = available[hand]
      ? `Estudar somente a mão ${hand === "right" ? "direita" : "esquerda"}.`
      : `A partitura não possui uma mão ${hand === "right" ? "direita" : "esquerda"} identificável.`;
  }
  byId("bothHandsButton").dataset.available = String(structured);
  byId("bothHandsButton").disabled = !structured;
  if (!available[state.practiceHand] && state.practiceHand !== "both") {
    state.practiceHand = "both";
  }
  reflectPracticeHand();
}

function selectPracticeHand(hand) {
  if (state.practiceActive || state.countInActive || !state.currentScore) return;
  const button = {
    both: byId("bothHandsButton"),
    right: byId("rightHandButton"),
    left: byId("leftHandButton"),
  }[hand];
  if (!button || button.disabled) return;
  if (playbackEngine.isActive) playbackEngine.stop({ preserveCursor: true });
  state.practiceHand = hand;
  reflectPracticeHand();
  resetPracticeUi();
  toast(`${PRACTICE_HAND_LABELS[hand]} selecionada para o estudo.`);
}

// Aguardar notas só faz sentido quando o app conhece as notas escritas
// (MusicXML ou exercício). Com PDF puro não há altura para conferir, então
// apenas o modo de tempo fica disponível.
function applyPracticeModeAvailability() {
  const hasEvents = Boolean(state.currentEvents?.length);
  const teacherButton = byId("teacherModeButton");
  teacherButton.disabled = !hasEvents;
  teacherButton.title = hasEvents
    ? "Aguarda você tocar a nota certa para avançar."
    : "Disponível apenas com MusicXML ou exercícios (o PDF não traz as notas).";
  if (!hasEvents) state.practiceMode = "tempo";
  reflectPracticeMode();
}

// Mostra apenas os controles que fazem sentido para a peça aberta, evitando
// que a barra transborde e polua a tela.
function applyPieceControls() {
  const structured = Boolean(state.currentScore);
  const playable = Boolean(state.currentEvents?.length);
  byId("loopControls").hidden = !structured;   // seleção de trecho só na partitura estruturada
  byId("modeToggle").hidden = !structured;
  byId("handToggle").hidden = !structured;
  byId("scoreGestureHint").hidden = !structured;
  byId("playbackControls").hidden = false;
  byId("playbackToggleButton").disabled = !playable;
  byId("playbackToggleButton").title = playable
    ? "Ouvir a partitura ou o trecho selecionado (barra de espaço)."
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
    stopped: "♫ Ouvir partitura",
  };
  button.textContent = labels[status] || labels.stopped;
  button.disabled = status === "loading" || !state.currentEvents?.length;
  stop.hidden = status === "stopped";
  stop.disabled = status === "loading";
  byId("startPracticeButton").disabled = status !== "stopped";
}

const PANEL_PREFS_KEY = "partitura-viva-study-side-panels";
const KEYBOARD_PREF_KEY = "partitura-viva-keyboard-visible";

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

function loadKeyboardVisibility() {
  try {
    return localStorage.getItem(KEYBOARD_PREF_KEY) !== "false";
  } catch {
    return true;
  }
}

function setKeyboardVisible(visible, { persist = true } = {}) {
  const expanded = Boolean(visible);
  const panel = byId("pianoPanel");
  const button = byId("keyboardVisibilityButton");
  const label = expanded ? "Ocultar teclado" : "Mostrar teclado";

  state.keyboardVisible = expanded;
  document.querySelector(".practice-workspace").classList.toggle("keyboard-hidden", !expanded);
  panel.classList.toggle("is-collapsed", !expanded);
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = label;

  if (persist) {
    try {
      localStorage.setItem(KEYBOARD_PREF_KEY, String(expanded));
    } catch {
      // O recolhimento continua funcionando quando o armazenamento é bloqueado.
    }
  }
}

function toggleKeyboardVisibility() {
  setKeyboardVisible(!state.keyboardVisible);
}

function setTempoExpanded(expanded) {
  const chip = byId("tempoChip");
  chip.classList.toggle("is-expanded", expanded);
  byId("tempoChipButton").setAttribute("aria-expanded", String(expanded));
  byId("tempoPanel").hidden = !expanded;
  byId("practiceView").classList.toggle("tempo-open", expanded);
  if (expanded) byId("tempoSlider").focus({ preventScroll: true });
}

function originalTempo() {
  return clampTempo(state.currentItem?.bpm || 72);
}

function reflectTempo(value) {
  const bpm = clampTempo(value, originalTempo());
  const percent = tempoPercent(bpm, originalTempo());
  byId("tempoSlider").value = String(bpm);
  byId("tempoOutput").value = String(bpm);
  byId("tempoChipOutput").value = String(bpm);
  byId("tempoPercentOutput").value = `${percent}%`;
  byId("tempoOriginalOutput").value = String(originalTempo());
  byId("tempoSlider").setAttribute(
    "aria-valuetext",
    `${bpm} BPM, ${percent}% do andamento original`,
  );
  byId("tempoChipButton").setAttribute("aria-label", `Ajustar andamento: ${bpm} BPM`);
  for (const button of document.querySelectorAll("[data-tempo-percent]")) {
    const presetBpm = tempoFromPercent(originalTempo(), button.dataset.tempoPercent);
    const active = presetBpm === bpm;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  return bpm;
}

function applyTempo(value) {
  const bpm = reflectTempo(value);
  if (playbackEngine.isPlaying || playbackEngine.isPaused) {
    playbackEngine.setTempo(bpm);
    setFeedback(
      "neutral",
      "ANDAMENTO ALTERADO",
      `${bpm} BPM · ${tempoPercent(bpm, originalTempo())}%`,
      playbackEngine.isPlaying
        ? "A reprodução continua do mesmo ponto."
        : "O novo andamento será usado ao continuar.",
    );
  }
  return bpm;
}

function changeTempoBy(delta) {
  return applyTempo(Number(byId("tempoSlider").value) + delta);
}

function selectTempoPercent(percent) {
  return applyTempo(tempoFromPercent(originalTempo(), percent));
}

const STAT_LABELS = {
  // Aguardar notas conta acertos e erros; Avaliar ritmo mede o desvio temporal.
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
    toast("Aguardar notas precisa de MusicXML ou exercício com notas.");
    return;
  }
  if (mode !== "teacher" && neuralUiState.modelStatus !== "disabled") {
    void setNeuralEnabled(false);
  }
  state.practiceMode = mode;
  reflectPracticeMode();
}

async function selectInputMode(mode) {
  if (state.practiceActive || state.countInActive) return;
  if (mode !== "microphone" && neuralUiState.modelStatus !== "disabled") {
    await setNeuralEnabled(false);
  }
  state.inputMode = mode;
  byId("microphoneModeButton").classList.toggle("active", mode === "microphone");
  byId("midiModeButton").classList.toggle("active", mode === "midi");
  byId("levelBar").style.width = "0";

  if (mode === "midi") {
    await onsetEngine.stop();
    try {
      const count = await midiInput.connect();
      if (!count) toast("Conecte e ligue o piano MIDI, depois tente novamente.");
      reflectInputStatus(count ? "midi" : "stopped");
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
    midi: "● MIDI conectado",
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

// Tudo o que é preciso saber para reproduzir a sessão sem ter estado nela: a
// peça, o trecho, como o aluno estava ouvindo e o que o aparelho oferece.
function beginSessionLog(events = []) {
  sessionLog.start({
    build: "apurando",
    peca: state.currentItem?.title,
    compositor: state.currentItem?.composer,
    formato: state.currentItem?.musicXmlAsset ? "musicxml" : "pdf",
    formula: state.currentItem?.timeSignature,
    modo: state.practiceMode,
    mao: state.practiceHand,
    entrada: state.inputMode,
    eventos: events.length,
    trecho: state.loop.active && state.loop.a !== null
      ? `notas ${state.loop.a}–${state.loop.b}`
      : "peça inteira",
    repeticoes: state.loop.count || 0,
    bpm: Number(byId("tempoSlider")?.value) || null,
    taxaDeAmostragem: onsetEngine.context?.sampleRate || null,
    aparelho: describeDevice(),
  });
  void runningBuild().then((build) => { sessionLog.context.build = build; });
}

async function startTeacherPractice() {
  const events = currentPracticeEvents();
  if (!events.length) {
    toast("O trecho selecionado não possui notas da mão escolhida.");
    return;
  }
  beginSessionLog(events);
  state.schedule = [];
  state.attempts = [];
  state.missed = 0;
  state.lastMidiAttempt = null;
  state.follow = createFollowState(events);
  state.followStats = { correct: 0, wrong: 0 };
  neuralUiState.lastAdvanceToken = null;
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
  if (state.inputMode === "microphone") {
    void startOfficialNeuralRecognition();
  }
  const micHint = state.inputMode === "microphone"
    ? "O motor acústico já está ouvindo enquanto o neural é preparado."
    : "Toque a nota certa para avançar. Se errar, o cursor espera.";
  setFeedback("neutral", "SIGA A PARTITURA", "Toque a primeira nota", micHint);
  updateFollowStats();
}

async function startTempoPractice() {
  const practiceEvents = state.currentEvents?.length
    ? currentPracticeEvents({ relative: true })
    : [];
  if (state.currentEvents?.length && !practiceEvents.length) {
    toast("O trecho selecionado não possui ataques da mão escolhida.");
    return;
  }
  const bpm = Number(byId("tempoSlider").value);
  const beatMs = 60_000 / bpm;
  const barBeats = currentBeatsPerBar();
  const countBeats = Math.max(2, Math.round(barBeats));

  beginSessionLog(practiceEvents);
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
  if (practiceEvents.length) {
    state.schedule = eventsToSchedule(practiceEvents, bpm, startAt);
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

  const diagnostic = onsetEngine.lastDiagnostic;
  sessionLog.add("ataque", {
    origem: midi === null ? "microfone" : "midi",
    midi,
    esperado: currentFollowEvent(state.follow)?.midis,
    rms: diagnostic?.rms,
    piso: diagnostic?.floor,
    limiar: diagnostic?.threshold,
    subida: diagnostic?.rise,
    subidaRelativa: diagnostic?.relativeRise,
    suficiente: diagnostic?.workable,
  });

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
  advanceScheduledScore(attempt.event.index);
}

function expectedNoteLabel(midis = []) {
  const list = (midis || []).filter((value) => Number.isFinite(value));
  if (!list.length) return "próxima nota";
  return list.map((midi) => midiToPortuguese(midi)).join(" + ");
}

function handleFollowOnset(midi) {
  handleFollowResult(registerFollowNote(state.follow, midi));
}

// O retrato de um quadro do motor acústico. `analysis` traz as amostras e o
// mapa de amplitudes junto com as medidas; nada disso entra — o log leva a
// conclusão e os números que a sustentam.
function logAcousticFrame(type, analysis, { throttleMs = 0 } = {}) {
  const data = {
    desfecho: analysis.outcome,
    status: analysis.status,
    esperado: analysis.expected,
    ouvido: analysis.detected,
    faltando: analysis.missing?.length ? analysis.missing : undefined,
    extra: analysis.extra?.length ? analysis.extra : undefined,
    proeminencia: analysis.prominence,
    confianca: analysis.confidence,
    rms: analysis.rms,
    esperandoAtaque: analysis.waitingForAttack || undefined,
    esperandoSoltura: analysis.waitingForRelease || undefined,
  };
  return throttleMs
    ? sessionLog.addThrottled(type, data, throttleMs)
    : sessionLog.add(type, data);
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
  neuralShadowEngine.setExpected(expected, timestamp);
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
    logAcousticFrame("acustico", analysis);
    handleFollowResult(registerFollowChord(state.follow, analysis.detected));
    return;
  }
  // Os quadros pendentes chegam a 28 por segundo. Registrar todos afogaria o
  // arquivo; registrar nenhum esconderia justamente o caso de quem toca e não
  // é reconhecido — é aqui que se vê a nota chegando perto e não passando.
  logAcousticFrame("espera", analysis, { throttleMs: 500 });

  if (analysis.status === "incomplete") {
    setFeedback("early", "QUASE", "Complete o acorde", `Falta: ${expectedNoteLabel(analysis.missing)}`);
  } else if (analysis.status === "extra") {
    setFeedback("late", "NOTA EXTRA", "Confira o acorde", `Extra: ${expectedNoteLabel(analysis.extra)}`);
  } else if (analysis.status === "wrong" && analysis.detected.length) {
    setFeedback("late", "NOTA DIFERENTE", "O cursor vai esperar", `Ouvi: ${expectedNoteLabel(analysis.detected)}`);
  } else if (analysis.waitingForRelease && analysis.status === "match") {
    setFeedback(
      "neutral",
      "SOLTE A TECLA",
      "A próxima nota é igual",
      "Solte a nota anterior antes de tocar novamente.",
    );
  } else if (
    analysis.waitingForAttack
    && analysis.waitingForAttackMs >= 1200
    && !onsetEngine.hasRecentWorkableLevel()
  ) {
    // Um nível insuficiente é indistinguível, na tela, de um aluno que não
    // tocou. Dizer qual dos dois é evita procurar defeito na execução quando o
    // problema é a distância até o piano.
    setFeedback(
      "early",
      "SOM MUITO BAIXO",
      "Aproxime o celular do piano",
      "O microfone está captando pouco sinal para reconhecer as notas.",
    );
  } else if (
    analysis.waitingForAttack
    && analysis.waitingForAttackMs >= 300
    && analysis.status === "match"
    && !onsetEngine.lastDiagnostic?.isAttack
  ) {
    setFeedback(
      "early",
      "ATAQUE SUAVE",
      "A nota foi ouvida",
      "Toque novamente com um ataque mais definido para avançar.",
    );
  }
}

function handleFollowResult(result) {

  if (result.type === "idle") return;

  // Uma linha por movimento do cursor. Lida junto com o ataque e a decisão que
  // vieram antes, é ela que conta a história de um avanço que não devia ter
  // acontecido — ou de um que devia e não aconteceu.
  sessionLog.add("cursor", {
    resultado: result.type,
    indice: result.index,
    esperado: result.expected,
    faltando: result.remaining?.length ? result.remaining : undefined,
    extra: result.extra?.length ? result.extra : undefined,
  });

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

  // A lista do acompanhamento já contém somente o trecho e a mão escolhidos.
  // Quando a repetição está ligada, concluir essa lista volta ao seu início.
  if (
    state.loop.active
    && state.loop.a != null
    && state.loop.b != null
    && result.type === "complete"
  ) {
    state.loop.count += 1;
    seekFollow(state.follow, 0);
    showFollowCursor();
    armCurrentMicrophoneEvent();
    const target = expectedNoteLabel(currentFollowEvent(state.follow)?.midis);
    setFeedback("on-time", `↻ REPETINDO ${state.loop.count}×`, "Voltando ao início do trecho", `Toque: ${target}`);
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
  renderStructured(followScoreIndex(0));
}

function moveFollowCursorTo(index) {
  renderStructured(followScoreIndex(index));
}

function followScoreIndex(followIndex) {
  const events = state.follow?.events || [];
  if (!events.length) return 0;
  const event = events[followIndex];
  if (event) return event.originalIndex;
  const last = events.at(-1);
  return Math.min(
    state.currentScore?.notes?.length || last.originalIndex + 1,
    last.originalIndex + 1,
  );
}

function updateFollowStats() {
  const { done, total } = followProgress(state.follow);
  byId("onTimeStat").textContent = String(state.followStats.correct);
  byId("earlyStat").textContent = String(done);
  byId("lateStat").textContent = String(state.followStats.wrong);
  const attempts = state.followStats.correct + state.followStats.wrong;
  const accuracy = attempts ? Math.round((state.followStats.correct / attempts) * 100) : 0;
  byId("accuracyStat").textContent = `${accuracy}%`;
  byId("pageLabel").textContent = progressLabel(
    followScoreIndex(done),
    state.currentScore?.notes?.length || total,
  );
}

function updateFeedbackForAttempt(attempt) {
  const signed = attempt.offsetMs > 0 ? `+${attempt.offsetMs}` : String(attempt.offsetMs);
  let detail = `${signed} ms do tempo esperado.`;
  if (attempt.noteCorrect === true) detail += " Notas corretas.";
  if (attempt.noteCorrect === false) detail += " Confira as notas tocadas.";
  setFeedback(attempt.grade, attempt.label.toUpperCase(), attempt.label, detail);
}

// Só a grade exata (MusicXML ou exercício) tem ataques a vencer. Fora dela o
// laço rodava a cada quadro sem nada a fazer — com o aparelho apoiado no piano,
// gastando bateria a troco de nada.
function practiceTick() {
  if (!state.practiceActive || !state.exactMode) return;

  const missed = markMissed(state.schedule, performance.now(), 430);
  if (missed.length) {
    state.missed += missed.length;
    for (const event of missed) {
      appendAttemptDot("missed");
      advanceScheduledScore(event.index);
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

  state.animationFrame = requestAnimationFrame(practiceTick);
}

function advanceScheduledScore(scheduleIndex) {
  if (!state.currentScore) return;
  const next = state.schedule[scheduleIndex + 1];
  if (next) {
    renderStructured(next.originalIndex);
    return;
  }
  const current = state.schedule[scheduleIndex];
  renderStructured(Math.min(
    state.currentScore.notes.length,
    (current?.originalIndex ?? scheduleIndex) + 1,
  ));
}

async function stopPractice({ showResult = true, keepInput = true } = {}) {
  const hadActivity = state.practiceActive || state.countInActive || state.attempts.length;
  state.practiceActive = false;
  state.countInActive = false;
  setNeuralAdvanceEnabled(false);
  await setNeuralEnabled(false);
  for (const timer of state.countTimers) window.clearTimeout(timer);
  state.countTimers = [];
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame = null;
  byId("countInDisplay")?.classList.remove("visible");
  reflectPracticeRunning(false);
  pianoRecognition.reset();
  if (!keepInput) await onsetEngine.stop();
  else void preparePracticeInput();

  await closeSessionLog();
  if (showResult && hadActivity) showPracticeResult();
}

// Fecha o diário e o guarda no aparelho. Uma sessão que não foi salva não pode
// ser enviada depois, e o aluno só percebe que precisava dela quando o problema
// já aconteceu — por isso salva sempre, sem perguntar.
async function closeSessionLog() {
  if (!sessionLog.active) return null;
  const { done, total } = state.follow ? followProgress(state.follow) : { done: 0, total: 0 };
  const rhythm = summarizeAttempts(state.attempts, state.exactMode ? state.missed : 0);
  sessionLog.finish({
    notasSeguidas: `${done}/${total}`,
    acertos: state.followStats.correct,
    erros: state.followStats.wrong,
    ataquesCaptados: rhythm.played,
    naoDetectados: rhythm.missed,
    precisaoRitmica: rhythm.accuracy,
    repeticoes: state.loop.count || 0,
  });

  const record = { id: sessionLog.toJSON().inicio, ...sessionLog.toJSON() };
  state.lastSessionLog = record;
  try {
    await saveSessionLog(record);
  } catch (error) {
    // Não poder guardar o diário não pode derrubar o fim do estudo. O da sessão
    // que acabou continua em memória e pode ser baixado na tela de resultado.
    console.warn("Não foi possível guardar o diário da sessão.", error);
  }
  void renderSessionLogs();
  return record;
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

// O botão de compartilhar só aparece onde o aparelho sabe compartilhar arquivo
// — no celular apoiado no piano, que é onde a sessão acontece. No computador
// sobra o download, que é o caminho natural ali.
function reflectSessionLogActions() {
  const file = sessionLogFile();
  byId("shareSessionLogButton").hidden = !file
    || !navigator.canShare?.({ files: [file] });
  byId("downloadSessionLogButton").disabled = !file;
}

function showPracticeResult() {
  reflectSessionLogActions();
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
  // `stopPractice` já desligou a captura e a inferência. O modelo continua
  // carregado de propósito: descartá-lo aqui obrigava cada peça seguinte a
  // recompilar os mesmos shaders antes de o aluno poder tocar.
  await stopPractice({ showResult: false, keepInput: false });
  await wakeLock.setEnabled(false);
  await leavePracticeFullscreen();
  midiInput.disconnect();
  viewer.clear();
  showView("libraryView");
}

function resetNeuralSession() {
  neuralUiState.advanceEnabled = false;
  neuralUiState.lastAdvanceToken = null;
  neuralUiState.activationPromise = null;
  neuralUiState.activationGeneration += 1;
}

function reflectNeuralStatus(status, detail = {}) {
  neuralUiState.modelStatus = status;
  // O aquecimento reporta progresso a cada bloco de áudio; só o que muda de
  // estado interessa ao diário.
  if (status !== "warming") sessionLog.add("neuralEstado", { estado: status });
  if (status === "error") {
    sessionLog.addError(detail, { origem: "neural" });
    setNeuralAdvanceEnabled(false);
    void onsetEngine.setPcmCaptureEnabled(false);
    if (state.practiceActive) {
      toast(`Motor neural indisponível; o acústico continua ativo. ${readableError(detail)}`);
    }
  }
}

function reflectNeuralCaptureStatus(status, error) {
  if (status === "unsupported") {
    reflectNeuralStatus("error", new Error("Este navegador não oferece captura neural contínua."));
  } else if (status === "error") {
    reflectNeuralStatus("error", error);
  }
}

function maybeAdvanceWithNeural(result) {
  const eligible = (
    neuralUiState.advanceEnabled
    && state.practiceActive
    && state.practiceMode === "teacher"
    && state.inputMode === "microphone"
    && state.follow
  );
  if (!eligible) return false;

  const currentExpected = currentFollowEvent(state.follow)?.midis || [];
  const eventIndex = state.follow?.index;
  // As alturas que o motor acústico já aceitou e ainda podem estar soando não
  // competem com a nota atual. Uma única lista serve aos dois motores.
  const gateOptions = {
    ignoreMidis: pianoRecognition.ringingMidis(currentExpected, performance.now()),
  };
  const decision = evaluateNeuralFollowResult(result, currentExpected, gateOptions);
  // O portão neural recusa muito mais do que aceita, e cada recusa tem um
  // motivo nomeado. Sem isso registrado, "o neural não avança neste aparelho"
  // não tem como ser investigado à distância.
  sessionLog.addThrottled("neural", {
    aceito: decision.accepted,
    motivo: decision.reason,
    esperado: decision.expected,
    confianca: decision.confidence,
    concorrente: decision.strongestUnexpected,
    abaixoDoLimiar: decision.belowThreshold,
    latenciaMs: result?.latencyMs,
    quadrosAnalisados: result?.analyzedFrames,
  }, decision.accepted ? 0 : 1000);
  if (!decision.accepted) return false;

  const token = `${state.loop.count}:${eventIndex}`;
  if (neuralUiState.lastAdvanceToken === token) return false;

  // O motor acústico tradicional pode ter avançado durante a inferência.
  // Revalidar imediatamente antes do registro impede um avanço duplo.
  const latestExpected = currentFollowEvent(state.follow)?.midis || [];
  const latestDecision = evaluateNeuralFollowResult(result, latestExpected, gateOptions);
  if (!latestDecision.accepted || state.follow.index !== eventIndex) return false;

  neuralUiState.lastAdvanceToken = token;
  const followResult = registerFollowChord(state.follow, latestExpected);
  handleFollowResult(followResult);
  if (followResult.type === "advance") {
    setFeedback(
      "on-time",
      "RECONHECIMENTO NEURAL",
      "Nota confirmada pelo motor neural",
      `Próxima: ${expectedNoteLabel(currentFollowEvent(state.follow)?.midis)}`,
    );
  }
  return true;
}

async function setNeuralEnabled(enabled) {
  if (!enabled) {
    neuralUiState.activationGeneration += 1;
    neuralUiState.activationPromise = null;
    setNeuralAdvanceEnabled(false);
    await onsetEngine.setPcmCaptureEnabled(false);
    await neuralShadowEngine.setEnabled(false);
    return true;
  }

  if (
    !state.currentEvents?.length
    || state.inputMode !== "microphone"
    || state.practiceMode !== "teacher"
  ) {
    return false;
  }

  if (neuralUiState.activationPromise) return neuralUiState.activationPromise;
  const generation = ++neuralUiState.activationGeneration;
  const activation = (async () => {
    const captureReady = await onsetEngine.setPcmCaptureEnabled(true);
    if (!captureReady || generation !== neuralUiState.activationGeneration) {
      if (captureReady) await onsetEngine.setPcmCaptureEnabled(false);
      return false;
    }
    const modelReady = await neuralShadowEngine.setEnabled(true);
    if (!modelReady || generation !== neuralUiState.activationGeneration) {
      if (modelReady) await neuralShadowEngine.setEnabled(false);
      await onsetEngine.setPcmCaptureEnabled(false);
      return false;
    }
    return true;
  })();
  neuralUiState.activationPromise = activation;
  try {
    return await activation;
  } finally {
    if (neuralUiState.activationPromise === activation) {
      neuralUiState.activationPromise = null;
    }
  }
}

async function startOfficialNeuralRecognition() {
  const ready = await setNeuralEnabled(true);
  if (!ready) return false;
  return setNeuralAdvanceEnabled(true);
}

function setNeuralAdvanceEnabled(enabled) {
  const allowed = Boolean(
    enabled
    && (neuralUiState.modelStatus === "warming" || neuralUiState.modelStatus === "active")
    && state.practiceActive
    && state.practiceMode === "teacher"
    && state.inputMode === "microphone"
    && state.follow,
  );
  neuralUiState.advanceEnabled = allowed;
  if (!allowed) neuralUiState.lastAdvanceToken = null;
  return allowed;
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
byId("pieceFiles").addEventListener("change", (event) => void acceptFiles(event.target.files));
byId("importForm").addEventListener("submit", importPiece);
byId("dropZone").addEventListener("dragover", (event) => {
  event.preventDefault();
  byId("dropZone").classList.add("dragging");
});
byId("dropZone").addEventListener("dragleave", () => byId("dropZone").classList.remove("dragging"));
byId("dropZone").addEventListener("drop", (event) => {
  event.preventDefault();
  byId("dropZone").classList.remove("dragging");
  void acceptFiles(event.dataTransfer.files);
});
byId("leavePracticeButton").addEventListener("click", leavePractice);
byId("documentStage").addEventListener("pointerdown", beginScoreGesture);
byId("documentStage").addEventListener("pointermove", moveScoreGesture);
byId("documentStage").addEventListener("pointerup", endScoreGesture);
byId("documentStage").addEventListener("pointercancel", (event) =>
  endScoreGesture(event, { cancelled: true }));
byId("topbarToggleButton").addEventListener("click", () => togglePanel("top"));
byId("bottombarToggleButton").addEventListener("click", () => togglePanel("bottom"));
byId("keyboardVisibilityButton").addEventListener("click", toggleKeyboardVisibility);
byId("microphoneModeButton").addEventListener("click", () => selectInputMode("microphone"));
byId("midiModeButton").addEventListener("click", () => selectInputMode("midi"));
byId("teacherModeButton").addEventListener("click", () => selectPracticeMode("teacher"));
byId("tempoModeButton").addEventListener("click", () => selectPracticeMode("tempo"));
byId("bothHandsButton").addEventListener("click", () => selectPracticeHand("both"));
byId("rightHandButton").addEventListener("click", () => selectPracticeHand("right"));
byId("leftHandButton").addEventListener("click", () => selectPracticeHand("left"));
byId("startPracticeButton").addEventListener("click", startPractice);
byId("stopPracticeButton").addEventListener("click", () => stopPractice({ showResult: true }));
byId("playbackToggleButton").addEventListener("click", togglePlayback);
byId("playbackStopButton").addEventListener("click", stopPlayback);
byId("tempoChipButton").addEventListener("click", () =>
  setTempoExpanded(!byId("tempoChip").classList.contains("is-expanded")));
byId("tempoSlider").addEventListener("input", (event) => {
  reflectTempo(event.target.value);
});
byId("tempoSlider").addEventListener("change", (event) => {
  applyTempo(event.target.value);
});
byId("tempoDecreaseButton").addEventListener("click", () => changeTempoBy(-5));
byId("tempoIncreaseButton").addEventListener("click", () => changeTempoBy(5));
byId("tempoResetButton").addEventListener("click", () => selectTempoPercent(100));
for (const button of document.querySelectorAll("[data-tempo-percent]")) {
  button.addEventListener("click", () => selectTempoPercent(button.dataset.tempoPercent));
}

function enableTempoHold(button, delta) {
  let delayTimer = null;
  let repeatTimer = null;
  const stop = () => {
    window.clearTimeout(delayTimer);
    window.clearInterval(repeatTimer);
    delayTimer = null;
    repeatTimer = null;
  };
  button.addEventListener("pointerdown", () => {
    stop();
    delayTimer = window.setTimeout(() => {
      repeatTimer = window.setInterval(() => changeTempoBy(delta), 120);
    }, 420);
  });
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("pointerleave", stop);
}

enableTempoHold(byId("tempoDecreaseButton"), -5);
enableTempoHold(byId("tempoIncreaseButton"), 5);
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
// Os menus dos cartões ficavam abertos ao rolar a biblioteca ou ao abrir outro
// cartão, empilhando popovers sobre o repertório.
document.addEventListener("pointerdown", (event) => {
  for (const menu of document.querySelectorAll("details.card-menu[open]")) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});

// Um teclado ligado ao aparelho (ou um Bluetooth no atril) é comum no estudo, e
// até aqui a tela só respondia a ponteiro. Campos de texto continuam com a tecla.
const PRACTICE_SHORTCUTS = {
  ArrowLeft: () => stepStructured(-1),
  ArrowRight: () => stepStructured(1),
  " ": () => void togglePlayback(),
  a: () => markLoop("a"),
  b: () => markLoop("b"),
  l: () => toggleLoop(),
};

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, select, textarea, [contenteditable='true']"));
}

function isActivatableTarget(target) {
  return Boolean(target?.closest?.("button, summary, a[href], [role='button']"));
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setTempoExpanded(false);
    return;
  }
  if (
    state.currentView !== "practiceView"
    || event.metaKey || event.ctrlKey || event.altKey
    || isTypingTarget(event.target)
  ) return;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  // Espaço aciona o elemento em foco. Roubar a tecla faria o botão que o aluno
  // acabou de usar parar de responder ao próprio teclado.
  if (key === " " && isActivatableTarget(event.target)) return;

  const shortcut = PRACTICE_SHORTCUTS[key];
  if (!shortcut) return;
  event.preventDefault();
  shortcut();
});
byId("editPieceForm").addEventListener("submit", () => void savePieceEdits(state.editingPieceId));
byId("cancelEditPieceButton").addEventListener("click", () => byId("editPieceDialog").close());
// Fechar pelo Escape não passa pelo envio; sem isto a peça em edição ficava
// pendurada no estado e a próxima abertura herdava o alvo errado.
byId("editPieceDialog").addEventListener("close", () => {
  state.editingPieceId = null;
});

// O distintivo dizia "Salvo neste aparelho" mesmo com a rede caída. Como o
// aplicativo se propõe a funcionar offline, o estado real importa: é ele que
// explica por que a importação de um arquivo novo pode falhar.
function reflectConnection() {
  const badge = byId("offlineBadge");
  const offline = navigator.onLine === false;
  badge.textContent = offline ? "Offline · repertório disponível" : "Salvo neste aparelho";
  badge.dataset.connection = offline ? "offline" : "online";
}

byId("downloadSessionLogButton").addEventListener("click", () => downloadSessionLog());
byId("clearSessionLogsButton").addEventListener("click", async () => {
  await clearSessionLogs();
  state.lastSessionLog = null;
  await renderSessionLogs();
  toast("Diários apagados.");
});
byId("shareSessionLogButton").addEventListener("click", () => void shareSessionLog());

// Uma exceção que ninguém tratou some sem deixar rastro: o aluno vê a tela
// travar e não tem o que contar. Registrada, ela viaja junto com a sessão.
window.addEventListener("error", (event) => {
  sessionLog.addError(event.error || event.message, {
    origem: "janela",
    arquivo: event.filename,
    linha: event.lineno,
  });
});
window.addEventListener("unhandledrejection", (event) => {
  sessionLog.addError(event.reason, { origem: "promessa" });
});

window.addEventListener("online", reflectConnection);
window.addEventListener("offline", reflectConnection);
reflectConnection();
reflectLoopButtons();
restorePanelPreferences();
setKeyboardVisible(loadKeyboardVisibility(), { persist: false });
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
void renderSessionLogs();
