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
