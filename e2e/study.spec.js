import { expect, test } from "@playwright/test";

test("modo de estudo permanece legível e utilizável em celular horizontal", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "partitura-viva-study-side-panels",
      JSON.stringify({ top: true, bottom: false }),
    );
  });
  await page.goto("/");
  await page.locator("#rhythmPanel").evaluate((panel) => {
    panel.open = true;
  });
  await page.locator(".rhythm-card button").first().click();

  const practice = page.locator("#practiceView");
  await expect(practice).toHaveClass(/active/);
  await expect(page.locator("#documentStage svg[data-score-key]")).toBeVisible();
  await expect(page.locator("#startPracticeButton")).toBeVisible();
  await expect(page.locator("#playbackToggleButton")).toBeVisible();
  await expect(page.locator(".bass-clef-symbol")).toHaveText("𝄢");
  await expect(page.locator("#inputStatus")).toHaveAttribute("data-status", "active");
  await expect(page.locator("#teacherModeButton")).toHaveText("Aguardar notas");
  await expect(page.locator("#tempoModeButton")).toHaveText("Avaliar ritmo");
  await expect(page.locator("#playbackToggleButton")).toContainText("Ouvir partitura");
  await expect(page.locator("#handToggle")).toBeVisible();
  await page.locator("#rightHandButton").click();
  await expect(page.locator("#rightHandButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#analysisModeBadge")).toContainText("Mão direita");
  // Em paisagem o aviso de girar não pode aparecer sobre a partitura.
  await expect(page.locator("#rotateOverlay")).toBeHidden();

  const actionBoxes = await Promise.all([
    page.locator("#startPracticeButton").boundingBox(),
    page.locator("#playbackToggleButton").boundingBox(),
  ]);
  for (const box of actionBoxes) {
    expect(box).not.toBeNull();
    if (!box) throw new Error("Ação principal ficou fora da tela.");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(915);
    expect(box.y + box.height).toBeLessThanOrEqual(412);
  }

  await page.locator("#bottombarToggleButton").click();
  await expect(page.locator("#neuralDiagnostics")).toBeVisible();
  await expect(page.locator("#neuralDiagnostics summary")).toContainText("Reconhecimento neural");
  await expect(page.locator("#neuralAvailabilityHint")).toContainText(
    "ativado automaticamente",
  );
  await expect(page.locator("#neuralEngineToggle")).toHaveCount(0);
  await expect(page.locator("#neuralAdvanceToggle")).toHaveCount(0);
  const neuralPanelBox = await page.locator("#neuralDiagnostics").boundingBox();
  expect(neuralPanelBox).not.toBeNull();
  if (!neuralPanelBox) throw new Error("Diagnóstico neural ficou fora da tela.");
  expect(neuralPanelBox.x).toBeGreaterThanOrEqual(0);
  expect(neuralPanelBox.x + neuralPanelBox.width).toBeLessThanOrEqual(915);
  await page.locator("#bottombarToggleButton").click();
  await page.locator("#topbarToggleButton").click();
  await expect(page.locator("#tempoChipButton")).toBeVisible();

  const noteXs = await page.locator(".score-event").evaluateAll((events) =>
    events.slice(0, 10).map((event) => {
      const head = event.querySelector("ellipse");
      return Number(head?.getAttribute("cx"));
    }).filter(Number.isFinite));
  const distinctXs = [...new Set(noteXs)];
  const gaps = distinctXs.slice(1).map((x, index) => x - distinctXs[index]);
  expect(gaps.length).toBeGreaterThan(2);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(60);

  await page.locator("#tempoChipButton").click();
  await expect(page.locator("#tempoChip")).toHaveClass(/is-expanded/);
  await expect(page.locator("#tempoPanel")).toBeVisible();
  const tempoBox = await page.locator("#tempoPanel").boundingBox();
  expect(tempoBox).not.toBeNull();
  if (!tempoBox) throw new Error("Controle de andamento não abriu.");
  expect(tempoBox.width).toBeGreaterThanOrEqual(300);
  expect(tempoBox.x).toBeLessThan(80);
  expect(tempoBox.y).toBeGreaterThanOrEqual(0);
  expect(tempoBox.y + tempoBox.height).toBeLessThanOrEqual(412);

  await page.locator("[data-tempo-percent='75']").click();
  await expect(page.locator("#tempoOutput")).toHaveText("48");
  await expect(page.locator("#tempoPercentOutput")).toHaveText("75%");
  await expect(page.locator("#tempoChipOutput")).toHaveText("48");
  await expect(page.locator("[data-tempo-percent='75']")).toHaveAttribute("aria-pressed", "true");

  await page.locator("#tempoIncreaseButton").click();
  await expect(page.locator("#tempoOutput")).toHaveText("53");
  await expect(page.locator("#tempoPercentOutput")).toHaveText("83%");

  await page.locator("#tempoResetButton").click();
  await expect(page.locator("#tempoOutput")).toHaveText("64");
  await expect(page.locator("[data-tempo-percent='100']")).toHaveAttribute("aria-pressed", "true");
});

test("renderizador une colcheias e semicolcheias indicadas pelo MusicXML", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { renderScore } = await import("/src/ui/score-renderer.js");
    const container = document.createElement("div");
    container.id = "beamSimulation";
    document.body.replaceChildren(container);
    const pitch = (name, duration, beams) => ({
      pitch: name,
      duration,
      staff: 1,
      clef: "treble",
      partIndex: 0,
      voice: "0:1",
      type: duration === 0.5 ? "eighth" : "16th",
      dotCount: 0,
      stem: "up",
      beams,
    });
    renderScore(container, {
      id: "beam-explicit-simulation",
      title: "Simulação de beams explícitos",
      bpm: 80,
      timeSignature: "4/4",
      beatsPerBar: 4,
      keyFifths: 0,
      clef: "grand",
      rests: [],
      measures: [{ index: 0, number: "1", beat: 0, duration: 4, timeSignature: "4/4" }],
      notes: [
        { beat: 0, duration: 0.5, measureIndex: 0, pitches: [
          pitch("C5", 0.5, [{ number: 1, value: "begin" }]),
        ] },
        { beat: 0.5, duration: 0.5, measureIndex: 0, pitches: [
          pitch("D5", 0.5, [{ number: 1, value: "end" }]),
        ] },
        { beat: 1, duration: 0.25, measureIndex: 0, pitches: [
          pitch("E5", 0.25, [
            { number: 1, value: "begin" },
            { number: 2, value: "begin" },
          ]),
        ] },
        { beat: 1.25, duration: 0.25, measureIndex: 0, pitches: [
          pitch("F5", 0.25, [
            { number: 1, value: "end" },
            { number: 2, value: "end" },
          ]),
        ] },
      ],
    });
  });

  await expect(page.locator("#beamSimulation .score-beam[data-beam-level='1']")).toHaveCount(2);
  await expect(page.locator("#beamSimulation .score-beam[data-beam-level='2']")).toHaveCount(1);
  await expect(page.locator("#beamSimulation .score-event path")).toHaveCount(0);
  await expect(page.locator("#beamSimulation .score-stem")).toHaveCount(4);
});

// A tela abre já em retrato, e não girada no meio do teste: o estudo pede
// `requestFullscreen()` ao abrir, e um navegador que atende ao pedido recusa
// qualquer redimensionamento depois disso.
test.describe("aparelho em retrato", () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test("o estudo explica que falta girar o aparelho", async ({ page }) => {
    // O bloqueio de orientação depende do navegador e do modo de instalação;
    // quando ele não vale, o aluno cai em retrato. A tela de estudo já ficava
    // borrada nessa situação, mas o aviso nunca aparecia — e sem ele o app
    // parece simplesmente quebrado.
    await page.goto("/");
    await page.locator("#rhythmPanel").evaluate((panel) => {
      panel.open = true;
    });
    await page.locator(".rhythm-card button").first().click();
    await expect(page.locator("#practiceView")).toHaveClass(/active/);

    await expect(page.locator("#rotateOverlay")).toBeVisible();
    await expect(page.locator("#rotateOverlay")).toContainText("Gire o aparelho");
  });
});

// Partitura mínima em 3/4 com andamento declarado: serve para provar que a
// importação lê o arquivo em vez de aceitar os padrões do formulário.
const TEST_MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Estudo de Teste</work-title></work>
  <identification><creator type="composer">Autora Teste</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><direction-type/><sound tempo="96"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

async function importTestPiece(page) {
  await page.goto("/");
  await page.locator("[data-view-target='importView']").click();
  await page.locator("#pieceFiles").setInputFiles({
    name: "estudo-de-teste.musicxml",
    mimeType: "application/vnd.recordare.musicxml+xml",
    buffer: Buffer.from(TEST_MUSICXML, "utf8"),
  });
}

test("a importação obedece ao arquivo, e não aos padrões do formulário", async ({ page }) => {
  await importTestPiece(page);

  // Título, compositor, compasso e andamento vêm do próprio MusicXML.
  await expect(page.locator("#pieceTitle")).toHaveValue("Estudo de Teste");
  await expect(page.locator("#pieceComposer")).toHaveValue("Autora Teste");
  await expect(page.locator("#pieceTimeSignature")).toHaveValue("3/4");
  await expect(page.locator("#pieceBpm")).toHaveValue("96");

  await page.locator("#rightsConfirmation").check();
  await page.locator("#importForm button[type='submit']").click();

  const card = page.locator(".piece-card").first();
  await expect(card.locator("h3")).toHaveText("Estudo de Teste");
  // O cartão precisa dizer a mesma fórmula que a tela de estudo usa.
  await expect(card.locator(".card-tags")).toContainText("3/4");
  await expect(card.locator(".card-tags")).toContainText("96 bpm");
});

test("dados da peça podem ser corrigidos sem reimportar o arquivo", async ({ page }) => {
  await importTestPiece(page);
  await page.locator("#rightsConfirmation").check();
  await page.locator("#importForm button[type='submit']").click();

  const card = page.locator(".piece-card").first();
  await card.locator(".card-menu summary").click();
  await card.locator(".edit-piece-button").click();

  await expect(page.locator("#editPieceDialog")).toBeVisible();
  await expect(page.locator("#editPieceTitle")).toHaveValue("Estudo de Teste");
  await page.locator("#editPieceTitle").fill("Estudo Renomeado");
  await page.locator("#editPieceBpm").fill("120");
  await page.locator("#editPieceForm button[type='submit']").click();

  await expect(page.locator("#editPieceDialog")).toBeHidden();
  await expect(page.locator(".piece-card h3").first()).toHaveText("Estudo Renomeado");
  await expect(page.locator(".piece-card .card-tags").first()).toContainText("120 bpm");

  // E a correção sobrevive ao recarregamento: foi ao IndexedDB, não só à tela.
  await page.reload();
  await expect(page.locator(".piece-card h3").first()).toHaveText("Estudo Renomeado");
});

test("o estudo responde ao teclado e mostra o compasso atual", async ({ page }) => {
  await importTestPiece(page);
  await page.locator("#rightsConfirmation").check();
  await page.locator("#importForm button[type='submit']").click();
  await page.locator(".piece-card .open-piece-button").first().click();
  await expect(page.locator("#practiceView")).toHaveClass(/active/);

  // Com MusicXML o rótulo lidera pelo compasso, que é como a peça é ensaiada.
  const label = page.locator("#pageLabel");
  await expect(label).toContainText("Comp. 1");
  const first = await label.textContent();

  // O atalho vale na tela toda: o ouvinte está no documento, não na pauta.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(label).not.toHaveText(first ?? "");

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(label).toHaveText(first ?? "");

  // A pauta deixa de ser invisível para leitores de tela.
  const score = page.locator("#documentStage svg[data-score-key]");
  await expect(score).toHaveAttribute("role", "img");
  await expect(score).toHaveAttribute("aria-label", /Partitura de .+ataques/);

  // Exercícios de ritmo não têm compasso numerado: o rótulo cai para a contagem
  // de notas em vez de inventar um número.
  await page.locator("#leavePracticeButton").click();
  await page.locator("#rhythmPanel").evaluate((panel) => {
    panel.open = true;
  });
  await page.locator(".rhythm-card button").first().click();
  await expect(label).toContainText("Nota 1/");
});

test("seleção manual é encaixada do início ao fim dos compassos", async ({ page }) => {
  await importTestPiece(page);
  await page.locator("#rightsConfirmation").check();
  await page.locator("#importForm button[type='submit']").click();
  await page.locator(".piece-card .open-piece-button").first().click();
  await page.locator("#bottombarToggleButton").click();

  // A primeira marca é feita na segunda nota do compasso 1, mas deve voltar ao
  // início do compasso. A segunda é feita no meio do compasso 2 e deve avançar
  // até a última nota dele.
  await page.keyboard.press("ArrowRight");
  await page.locator("#markAButton").click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.locator("#markBButton").click();

  const region = page.locator("#documentStage .score-loop");
  await expect(region).toHaveAttribute("data-start-index", "0");
  await expect(region).toHaveAttribute("data-end-index", "5");
  await expect(page.locator("#toast")).toContainText("compassos 1–2");
});
