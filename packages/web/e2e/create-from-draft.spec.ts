import { expect, test } from "@playwright/test";
import { deleteCardIfExists, uniqueSuffix } from "./helpers.js";

// TESTING.md scenario 1: Create card from draft input. Draft-input selection
// uses selectionStart/selectionEnd (not DOM ranges) — a distinct code path
// from create-from-message.spec.ts.
test("create card from draft input selection", async ({ page, request, baseURL }) => {
  const term = `xyz-${uniqueSuffix()}`;
  const prompt = `I want a dashboard that helps me build ${term} today`;

  await page.goto("/");

  const draft = page.getByTestId("draft-input");
  await draft.click();
  await draft.fill(prompt);

  // Select just the term via selectionStart/selectionEnd, then fire the
  // "select" event the app listens on (setSelectionRange alone doesn't).
  const start = prompt.indexOf(term);
  const end = start + term.length;
  await draft.evaluate(
    (el: HTMLTextAreaElement, [s, e]: [number, number]) => {
      el.focus();
      el.setSelectionRange(s, e);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    },
    [start, end]
  );

  const affordance = page.getByTestId("gloss-affordance");
  await expect(affordance).toBeVisible();
  await affordance.click();

  const panel = page.getByTestId("gloss-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("panel-term")).toHaveValue(term);

  // Focus is not stolen from the draft input by the affordance click: typing
  // into the draft still works after clicking back into it.
  await draft.click();
  await draft.press("End");
  await draft.type(" more");
  await expect(draft).toHaveValue(`${prompt} more`);

  await page.getByTestId("panel-term").fill(term);
  await page.getByTestId("panel-aliases").fill("xyz alias");
  await page.getByTestId("panel-body").fill("xyz is the internal codename for the widget.");
  await page.getByTestId("panel-save").click();

  await expect(panel).toBeHidden();

  await expect(async () => {
    const res = await request.get(`${baseURL}/api/cards/${term}`);
    expect(res.ok()).toBe(true);
    const card = await res.json();
    expect(card.term).toBe(term);
    expect(card.aliases).toContain("xyz alias");
    expect(card.source.span).toBe(term);
    expect(card.source.message).toContain(term);
  }).toPass();

  await deleteCardIfExists(request, baseURL!, term);
});
