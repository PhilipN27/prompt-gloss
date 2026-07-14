import { expect, test } from "@playwright/test";
import { deleteCardIfExists, uniqueSuffix } from "./helpers.js";

// TESTING.md scenario 3: Injection + indicator. With a card saved, a message
// containing its term shows the injection chip, and the fake-agent debug
// endpoint exposes the exact <gloss-context> payload under budget.
test("saved card injects and shows the indicator chip", async ({ page, request, baseURL }) => {
  const term = `metric-${uniqueSuffix()}`;
  const body = "The metric-panel reads from the analytics rollup table.";

  const createRes = await request.post(`${baseURL}/api/cards`, {
    data: { term, aliases: [], body, source: { span: term, message: "seed" } }
  });
  expect(createRes.ok()).toBe(true);

  await page.goto("/");
  await page.getByTestId("draft-input").fill(`what does ${term} do`);
  await page.getByTestId("send-button").click();

  const chip = page.getByTestId(`injection-chip-${term}`);
  await expect(chip).toBeVisible();

  await expect(async () => {
    const res = await request.get(`${baseURL}/api/debug/last-injection`);
    expect(res.ok()).toBe(true);
    const debug = await res.json();
    expect(debug.slugs).toContain(term);
    expect(debug.payload).toContain("<gloss-context>");
    expect(debug.payload).toContain(body);
  }).toPass();

  // Clicking the chip opens the card in edit mode.
  await chip.click();
  const panel = page.getByTestId("gloss-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("panel-term")).toHaveValue(term);
  await expect(page.getByTestId("panel-delete")).toBeVisible();

  await deleteCardIfExists(request, baseURL!, term);
});
