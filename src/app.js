import { catalog as t, lessons as e, getSong as n } from "./data/catalog.js";
import { AudioPitchEngine as o, DemoSynth as a } from "./core/audio-engine.js";
import {
  categoryLabel as c,
  centsFromMidi as i,
  isBlackKey as r,
  midiToFrequency as s,
  midiToNote as l,
  midiToPortuguese as d,
  noteToMidi as u,
} from "./core/music.js";
import { renderScore as m } from "./ui/score-renderer.js";
const p = "aula-piano-progress-v1",
  g = "aula-piano-settings-v1",
  v = {
    correct: 0,
    attempts: 0,
    completedLessons: [],
    bestBySong: {},
    activities: [],
    practiceDays: [],
  };
let h = ot(p, v),
  f = ot(g, { concertPitch: 440, centsTolerance: 40, showNoteNames: !0, vibration: !0 }),
  y = n(e[0].songId),
  b = e[0],
  C = 0,
  $ = 0,
  w = 0,
  L = f.showNoteNames,
  S = !1,
  x = !1,
  N = null,
  M = "",
  E = 0,
  D = 0,
  T = null,
  B = 0,
  P = 0,
  suppressUntil = 0, // até quando o microfone deve ignorar sons emitidos pelo app
  heldMidi = null; // última nota confirmada pelo microfone, ainda sustentada
const onMetronomeBeat = () => {
  suppressUntil = Math.max(suppressUntil, Date.now() + 160);
};
// Avaliação polifônica: notas MIDI que ainda faltam no evento atual.
// Recalculada quando o índice do evento (ou a música) muda.
let pendingMidis = [];
let pendingKey = "";
function eventMidis(event) {
  return (event.pitches || [event]).map((p) => u(p.pitch));
}
function syncPending() {
  const key = `${y.id}:${C}`;
  if (key === pendingKey) return;
  pendingKey = key;
  const event = y.notes[C];
  pendingMidis = event ? eventMidis(event) : [];
}
function targetLabel(event) {
  return eventMidis(event)
    .slice()
    .sort((a, b) => a - b)
    .map((midi) => d(midi))
    .join(" + ");
}
function highlightPending() {
  document
    .querySelectorAll(".piano-key")
    .forEach((t) => t.classList.toggle("target", pendingMidis.includes(Number(t.dataset.midi))));
}
const k = (t) => document.getElementById(t),
  I = new a(),
  A = new o({
    concertPitch: f.concertPitch,
    onPitch: function (t) {
      if (!S) return;
      // Ignora o intervalo em que o próprio app emite som (demonstração,
      // teclado virtual, metrônomo) para o microfone não "ouvir" o app.
      if (Date.now() < suppressUntil) return;
      if (!t || t.clarity < 0.72)
        return (
          (heldMidi = null), // silêncio detectado: libera a próxima tentativa
          (T = null),
          (B = 0),
          (k("detectedNote").textContent = "—"),
          void (k("tuningStatus").textContent = "Aguardando nota estável")
        );
      ((k("detectedNote").textContent = d(t.midi)),
        (k("tuningStatus").textContent = at(t.cents)),
        R(t.midi),
        T === t.midi ? (B += 1) : ((T = t.midi), (B = 1)));
      // Nota ainda sustentada desde a última tentativa: mostra, mas não conta.
      if (t.midi === heldMidi) return;
      B >= 4 &&
        Date.now() - D > 420 &&
        (J(t.midi, t.cents, "microphone"), (heldMidi = t.midi), (B = 0));
    },
    onError: (t) => it(ct(t)),
  });
function q(t) {
  (document.querySelectorAll(".view").forEach((e) => e.classList.toggle("active", e.id === t)),
    document
      .querySelectorAll(".nav-button")
      .forEach((e) => e.classList.toggle("active", e.dataset.view === t)),
    "progressView" === t && Y(),
    window.scrollTo({ top: 0, behavior: "smooth" }));
}
function V() {
  const t = h.attempts ? Math.round((h.correct / h.attempts) * 100) : 0,
    n = new Set(h.completedLessons),
    o = Math.round((n.size / e.length) * 100);
  ((k("levelStat").textContent = String(Math.min(e.length, n.size + 1))),
    (k("accuracyStat").textContent = `${t}%`),
    (k("correctStat").textContent = String(h.correct)),
    (k("streakStat").textContent = `${_(h.practiceDays)} dias`),
    (k("lessonProgressLabel").textContent = `${o}% concluído`));
  const a = k("lessonList");
  a.replaceChildren();
  const c = Z();
  e.forEach((t, o) => {
    const i = n.has(t.id),
      r = 0 === o || n.has(e[o - 1].id) || i,
      s = document.createElement("article");
    ((s.className = "lesson-card" + (i ? " completed" : "")),
      (s.innerHTML = `
      <div class="lesson-index">${i ? "✓" : o + 1}</div>
      <div class="lesson-copy">
        <h3>${st(t.title)}</h3>
        <p>${st(t.description)}</p>
      </div>
      <div class="lesson-meta">
        <span>Meta</span><strong>${t.minAccuracy}%</strong>
      </div>
      <button class="${t.id === c.id ? "primary-button" : "secondary-button"}" ${r ? "" : "disabled"}>
        ${i ? "Repetir" : r ? (t.id === c.id ? "Começar" : "Abrir") : "Bloqueada"}
      </button>
    `),
      s.querySelector("button").addEventListener("click", () => r && H(t)),
      a.append(s));
  });
}
function H(t) {
  ((b = t), j(n(t.songId), t, !0));
}
function j(t, e = null, n = !0) {
  ((y = t), (b = e), F(!1), n && q("practiceView"));
  if (x) I.startMetronome(y.bpm, onMetronomeBeat); // atualiza o andamento do metrônomo
}
function F(t = !0) {
  ((C = 0),
    ($ = 0),
    (w = 0),
    (T = null),
    (B = 0),
    (heldMidi = null),
    (suppressUntil = 0),
    (pendingKey = ""),
    (M = ""),
    (E = 0),
    (D = 0),
    (P += 1),
    W(
      "neutral",
      "Pronto para começar",
      "Observe a primeira nota",
      "Toque uma nota por vez. O aplicativo avançará quando reconhecer a altura correta.",
    ),
    O(),
    t && it("Exercício reiniciado."));
}
function O() {
  const t = y.notes[C] || y.notes.at(-1);
  ((k("practiceCategory").textContent = c(y.category).toUpperCase()),
    (k("practiceTitle").textContent = y.title),
    (k("tempoValue").textContent = String(y.bpm)),
    (k("scoreProgress").textContent =
      `Nota ${Math.min(C + 1, y.notes.length)} de ${y.notes.length}`),
    (k("scoreProgressBar").style.width = (C / y.notes.length) * 100 + "%"),
    (k("targetNote").textContent = targetLabel(t)),
    (k("toggleNoteNames").textContent = "Nomes: " + (L ? "ligados" : "desligados")),
    m(k("scoreCanvas"), y, C, L),
    syncPending(),
    highlightPending());
}
function z() {
  const e = k("catalogSearch")?.value.trim().toLocaleLowerCase("pt-BR") || "",
    n = k("catalogFilter")?.value || "all",
    o = t.filter((t) => {
      const o = "all" === n || t.category === n,
        a = `${t.title} ${t.originalTitle} ${t.composer}`.toLocaleLowerCase("pt-BR");
      return o && a.includes(e);
    }),
    a = k("catalogGrid");
  a &&
    (a.replaceChildren(),
    o.forEach((t) => {
      const e = h.bestBySong[t.id],
        n = document.createElement("article");
      ((n.className = "catalog-card"),
        (n.innerHTML = `
      <div class="catalog-card-top">
        <div>
          <h3>${st(t.title)}</h3>
          <p>${st(t.originalTitle)}<br>${st(t.composer)}</p>
        </div>
        <span class="difficulty" title="Dificuldade">${t.difficulty}</span>
      </div>
      <div class="tags">
        <span class="tag">${c(t.category)}</span>
        <span class="tag">${t.bpm} bpm</span>
        <span class="tag">Tom: ${st(t.key)}</span>
        ${e ? `<span class="tag">Melhor: ${e}%</span>` : ""}
      </div>
      <button class="secondary-button">Praticar trecho</button>
    `),
        n.querySelector("button").addEventListener("click", () =>
          (function (t) {
            ((b = null), j(t, null, !0));
          })(t),
        ),
        a.append(n));
    }),
    o.length || (a.innerHTML = '<div class="empty-state">Nenhuma música encontrada.</div>'));
}
function R(t) {
  const e = document.querySelector(`.piano-key[data-midi="${t}"]`);
  e && (e.classList.add("active"), window.setTimeout(() => e.classList.remove("active"), 180));
}
async function U() {
  if (S)
    return (
      await A.stop(),
      (S = !1),
      (k("listenButton").textContent = "Ativar microfone"),
      (k("detectedNote").textContent = "—"),
      (k("tuningStatus").textContent = "Microfone desligado"),
      void W(
        "neutral",
        "Microfone pausado",
        "Continue pelo teclado virtual",
        "Você pode testar as notas usando as teclas na parte inferior.",
      )
    );
  try {
    (await A.start(),
      (S = !0),
      (k("listenButton").textContent = "Desativar microfone"),
      (k("inputModeLabel").textContent = "Microfone"),
      (k("tuningStatus").textContent = "Escutando…"),
      W(
        "neutral",
        "Escutando o piano",
        "Toque a nota indicada",
        "Mantenha a nota por um instante para confirmar a leitura.",
      ));
  } catch (t) {
    ((S = !1), (k("listenButton").textContent = "Ativar microfone"), it(ct(t)));
  }
}
function J(t, e = 0, n = "unknown") {
  if (C >= y.notes.length) return;
  syncPending();
  const c = Date.now();
  const a = pendingMidis.includes(t) && Math.abs(e) <= f.centsTolerance;
  if (a && pendingMidis.length > 1) {
    // Nota correta de um acorde ainda incompleto: registra e aguarda as demais.
    pendingMidis = pendingMidis.filter((midi) => midi !== t);
    highlightPending();
    D = c;
    W(
      "correct",
      "Nota do acorde",
      `Falta${pendingMidis.length > 1 ? "m" : ""} ${pendingMidis.length}`,
      `Toque também: ${pendingMidis
        .slice()
        .sort((x, z) => x - z)
        .map((midi) => d(midi))
        .join(" + ")}.`,
    );
    return;
  }
  if (a)
    return (
      ($ += 1),
      (w += 1),
      (h.attempts += 1),
      (h.correct += 1),
      (D = c),
      W(
        "correct",
        "Nota correta",
        "Muito bem!",
        "microphone" === n
          ? "A altura foi reconhecida. Prepare a próxima nota."
          : "Entrada confirmada pelo teclado virtual.",
      ),
      f.vibration && navigator.vibrate && navigator.vibrate(35),
      (C += 1),
      et(),
      void (C >= y.notes.length
        ? (function () {
            const t = $ ? Math.round((w / $) * 100) : 100;
            ((h.bestBySong[y.id] = Math.max(h.bestBySong[y.id] || 0, t)),
              b &&
                t >= b.minAccuracy &&
                !h.completedLessons.includes(b.id) &&
                h.completedLessons.push(b.id));
            (h.activities.unshift({
              id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
              date: new Date().toISOString(),
              songId: y.id,
              songTitle: y.title,
              accuracy: t,
              correct: w,
              attempts: $,
            }),
              (h.activities = h.activities.slice(0, 40)),
              (function () {
                const t = tt(new Date());
                h.practiceDays.includes(t) ||
                  (h.practiceDays.push(t), (h.practiceDays = h.practiceDays.slice(-90)), et());
              })(),
              et(),
              O(),
              (k("scoreProgressBar").style.width = "100%"),
              (k("scoreProgress").textContent = `Concluído · ${t}% de precisão`),
              W(
                t >= (b?.minAccuracy || 75) ? "correct" : "neutral",
                "Exercício concluído",
                t >= (b?.minAccuracy || 75) ? "Meta atingida!" : "Vale repetir mais uma vez",
                `Você acertou ${w} notas em ${$} tentativas. Precisão final: ${t}%.`,
              ),
              it(
                t >= (b?.minAccuracy || 75)
                  ? "Nova etapa liberada."
                  : "Repita para aumentar a precisão.",
              ),
              V(),
              z());
          })()
        : O())
    );
  const i = `${C}:${t}`;
  if (i === M && c - E < 700) return;
  ((M = i), (E = c), ($ += 1), (h.attempts += 1), et());
  const o = pendingMidis
    .slice()
    .sort((x, z) => Math.abs(x - t) - Math.abs(z - t))[0];
  const r = t < o ? "um pouco mais à direita/agudo" : "um pouco mais à esquerda/grave";
  W("incorrect", "Quase", `Você tocou ${d(t)}`, `Procure ${d(o)}: vá ${r}.`);
}
function W(t, e, n, o) {
  const a = k("feedbackBadge");
  ((a.className = `feedback-badge ${t}`),
    (a.textContent = e),
    (k("coachTitle").textContent = n),
    (k("coachMessage").textContent = o));
}
async function G() {
  const t = ++P;
  ((k("demoButton").disabled = !0), (k("demoButton").textContent = "Tocando…"));
  const e = Math.max(0, C),
    n = Math.min(y.notes.length, e + 8);
  for (let o = e; o < n && t === P; o += 1) {
    const t = y.notes[o],
      e = (6e4 / y.bpm) * t.duration,
      midis = eventMidis(t);
    suppressUntil = Date.now() + e + 300;
    midis.forEach((midi) => {
      R(midi);
      I.playFrequency(s(midi, f.concertPitch), Math.max(0.18, (e / 1e3) * 0.82));
    });
    await rt(e);
  }
  ((k("demoButton").disabled = !1), (k("demoButton").textContent = "Ouvir exemplo"));
}
async function K() {
  ((x = !x),
    x
      ? (await I.startMetronome(y.bpm, onMetronomeBeat),
        (k("metronomeButton").textContent = "Metrônomo: ligado"))
      : (I.stopMetronome(), (k("metronomeButton").textContent = "Metrônomo: desligado")));
}
async function Q() {
  if (navigator.requestMIDIAccess)
    try {
      const access = await navigator.requestMIDIAccess();
      const bindInputs = () => {
        const t = [...access.inputs.values()];
        if (!t.length) {
          k("inputModeLabel").textContent = "Teclado virtual";
          return 0;
        }
        t.forEach((t) => {
          t.onmidimessage = (t) => {
            const [e, n, o] = t.data;
            144 === (240 & e) &&
              o > 0 &&
              ((k("detectedNote").textContent = d(n)),
              (k("tuningStatus").textContent = "Entrada MIDI precisa"),
              R(n),
              J(n, 0, "midi"));
          };
        });
        k("inputModeLabel").textContent = `MIDI · ${t[0].name || "teclado"}`;
        return t.length;
      };
      const count = bindInputs();
      access.onstatechange = () => {
        const total = bindInputs();
        it(total ? `${total} entrada(s) MIDI conectada(s).` : "Teclado MIDI desconectado.");
      };
      if (!count)
        return void it(
          "Nenhum teclado MIDI foi encontrado. Conecte-o por USB: ele será reconhecido automaticamente.",
        );
      it(`${count} entrada(s) MIDI conectada(s).`);
    } catch (t) {
      it(`Não foi possível acessar o MIDI: ${t.message}`);
    }
  else it("Web MIDI não está disponível neste navegador. Use o microfone ou o teclado virtual.");
}
function Y() {
  const t = h.attempts ? Math.round((h.correct / h.attempts) * 100) : 0;
  k("progressSummary").innerHTML = `
    <article class="progress-card"><span>Precisão geral</span><strong>${t}%</strong></article>
    <article class="progress-card"><span>Aulas concluídas</span><strong>${h.completedLessons.length}/${e.length}</strong></article>
    <article class="progress-card"><span>Dias consecutivos</span><strong>${_(h.practiceDays)}</strong></article>
  `;
  const n = k("activityList");
  (n.replaceChildren(),
    h.activities.length
      ? h.activities.forEach((t) => {
          const e = document.createElement("article");
          var o;
          ((e.className = "activity-item"),
            (e.innerHTML = `
      <div><h3>${st(t.songTitle)}</h3><p>${((o = t.date), new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(o)))} · ${t.correct}/${t.attempts} notas</p></div>
      <strong>${t.accuracy}%</strong>
    `),
            n.append(e));
        })
      : (n.innerHTML =
          '<div class="empty-state">Conclua um exercício para iniciar o histórico.</div>'));
}
function X() {
  window.confirm("Apagar todo o progresso salvo neste dispositivo?") &&
    ((h = structuredClone(v)), et(), V(), z(), Y(), it("Progresso apagado."));
}
function Z() {
  return e.find((t) => !h.completedLessons.includes(t.id)) || e.at(-1);
}
function _(t) {
  if (!t.length) return 0;
  const e = new Set(t);
  let n = new Date(),
    o = 0;
  for (e.has(tt(n)) || n.setDate(n.getDate() - 1); e.has(tt(n));)
    ((o += 1), n.setDate(n.getDate() - 1));
  return o;
}
function tt(t) {
  return [
    t.getFullYear(),
    String(t.getMonth() + 1).padStart(2, "0"),
    String(t.getDate()).padStart(2, "0"),
  ].join("-");
}
function et() {
  localStorage.setItem(p, JSON.stringify(h));
}
function nt() {
  localStorage.setItem(g, JSON.stringify(f));
}
function ot(t, e) {
  try {
    const n = JSON.parse(localStorage.getItem(t));
    return n && "object" == typeof n ? { ...structuredClone(e), ...n } : structuredClone(e);
  } catch {
    return structuredClone(e);
  }
}
function at(t) {
  return Math.abs(t) <= 8
    ? "Afinada"
    : t < 0
      ? `${Math.abs(Math.round(t))} cents abaixo`
      : `${Math.round(t)} cents acima`;
}
function ct(t) {
  return "NotAllowedError" === t?.name
    ? "Permissão do microfone negada. Libere o acesso nas configurações do navegador."
    : "NotFoundError" === t?.name
      ? "Nenhum microfone foi encontrado neste dispositivo."
      : t?.message || "Não foi possível ativar o microfone.";
}
function it(t) {
  const e = k("toast");
  ((e.textContent = t),
    e.classList.add("visible"),
    clearTimeout(it.timer),
    (it.timer = window.setTimeout(() => e.classList.remove("visible"), 3200)));
}
function rt(t) {
  return new Promise((e) => window.setTimeout(e, t));
}
function st(t) {
  return String(t).replace(
    /[&<>'"]/g,
    (t) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[t],
  );
}
(document.querySelectorAll(".nav-button").forEach((t) => {
  t.addEventListener("click", () => q(t.dataset.view));
}),
  k("backToHome").addEventListener("click", () => q("homeView")),
  k("resumeButton").addEventListener("click", () => {
    H(Z());
  }),
  k("listenButton").addEventListener("click", U),
  k("demoButton").addEventListener("click", G),
  k("metronomeButton").addEventListener("click", K),
  k("resetPracticeButton").addEventListener("click", F),
  k("toggleNoteNames").addEventListener("click", () => {
    ((L = !L),
      (k("toggleNoteNames").textContent = "Nomes: " + (L ? "ligados" : "desligados")),
      O());
  }),
  k("midiButton").addEventListener("click", Q),
  k("catalogSearch").addEventListener("input", z),
  k("catalogFilter").addEventListener("change", z),
  k("resetProgressButton").addEventListener("click", X),
  k("concertPitch").addEventListener("input", (t) => {
    ((f.concertPitch = Number(t.target.value)),
      (k("concertPitchValue").textContent = `${f.concertPitch} Hz`),
      A.setConcertPitch(f.concertPitch),
      nt());
  }),
  k("centsTolerance").addEventListener("input", (t) => {
    ((f.centsTolerance = Number(t.target.value)),
      (k("centsToleranceValue").textContent = `±${f.centsTolerance} cents`),
      nt());
  }),
  k("showNoteNamesSetting").addEventListener("change", (t) => {
    ((f.showNoteNames = t.target.checked),
      (L = t.target.checked),
      (k("toggleNoteNames").textContent = "Nomes: " + (L ? "ligados" : "desligados")),
      nt(),
      O());
  }),
  k("vibrationSetting").addEventListener("change", (t) => {
    ((f.vibration = t.target.checked), nt());
  }),
  (function () {
    const t = k("pianoKeyboard");
    t.replaceChildren();
    for (let e = 48; e <= 84; e += 1) {
      const n = document.createElement("button");
      ((n.className = "piano-key" + (r(e) ? " black" : "")),
        (n.dataset.midi = String(e)),
        n.setAttribute("aria-label", d(e)),
        (n.innerHTML = `<span>${r(e) ? "" : d(e, !1)}</span>`));
      const o = () => {
        ((suppressUntil = Date.now() + 650),
          I.playFrequency(s(e, f.concertPitch), 0.4),
          R(e),
          J(e, 0, "virtual"));
      };
      (n.addEventListener("pointerdown", (t) => {
        (t.preventDefault(), o());
      }),
        t.append(n));
    }
  })(),
  V(),
  z(),
  Y(),
  (k("concertPitch").value = String(f.concertPitch)),
  (k("concertPitchValue").textContent = `${f.concertPitch} Hz`),
  (k("centsTolerance").value = String(f.centsTolerance)),
  (k("centsToleranceValue").textContent = `±${f.centsTolerance} cents`),
  (k("showNoteNamesSetting").checked = f.showNoteNames),
  (k("vibrationSetting").checked = f.vibration),
  j(y, b, !1),
  "serviceWorker" in navigator &&
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("./sw.js").catch(() => {}),
    ),
  window.addEventListener("beforeinstallprompt", (t) => {
    (t.preventDefault(), (N = t), (k("installButton").hidden = !1));
  }),
  k("installButton").addEventListener("click", async () => {
    N && (N.prompt(), await N.userChoice, (N = null), (k("installButton").hidden = !0));
  }));
