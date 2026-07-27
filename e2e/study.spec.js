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

  await page.locator("#tempoChip").click();
  await expect(page.locator("#tempoChip")).toHaveClass(/is-expanded/);
  const tempoBox = await page.locator("#tempoChip").boundingBox();
  expect(tempoBox.width).toBeGreaterThan(250);
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
