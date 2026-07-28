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

test("em retrato o estudo explica que falta girar o aparelho", async ({ page }) => {
  // O bloqueio de orientação depende do navegador e do modo de instalação;
  // quando ele não vale, o aluno cai em retrato. A tela de estudo já ficava
  // borrada nessa situação, mas o aviso nunca aparecia — e sem ele o app parece
  // simplesmente quebrado.
  await page.goto("/");
  await page.locator("#rhythmPanel").evaluate((panel) => {
    panel.open = true;
  });
  await page.locator(".rhythm-card button").first().click();
  await expect(page.locator("#practiceView")).toHaveClass(/active/);
  await expect(page.locator("#rotateOverlay")).toBeHidden();

  await page.setViewportSize({ width: 412, height: 915 });
  await expect(page.locator("#rotateOverlay")).toBeVisible();
  await expect(page.locator("#rotateOverlay")).toContainText("Gire o aparelho");

  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.locator("#rotateOverlay")).toBeHidden();
});
