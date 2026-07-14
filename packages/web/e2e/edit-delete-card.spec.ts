import { expect, test } from "@playwright/test";
import { deleteCardIfExists, uniqueSuffix } from "./helpers.js";

// TESTING.md scenario 4: Edit existing card. Selecting a term that already has
// a card opens edit mode pre-populated; saving bumps `updated` and replaces
// the body; Delete on a later open removes the file and the indicator stops
// firing for that term.
test("editing and deleting an existing card via selection", async ({
  page,
  request,
  baseURL
}) => {
  const term = `engine-${uniqueSuffix()}`;
  const createRes = await request.post(`${baseURL}/api/cards`, {
    data: { term, aliases: [], body: "original body", source: { span: term, message: "seed" } }
  });
  const original = await createRes.json();

  await page.goto("/");

  // Select the term in a fresh draft message — matching span resolves via
  // POST /api/match and opens the existing card in edit mode.
  const draft = page.getByTestId("draft-input");
  const prompt = `investigate the ${term} now`;
  await draft.fill(prompt);
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
  await page.getByTestId("gloss-affordance").click();

  const panel = page.getByTestId("gloss-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("panel-term")).toHaveValue(term);
  await expect(page.getByTestId("panel-body")).toHaveValue("original body");

  await page.getByTestId("panel-body").fill("updated body content");
  await page.getByTestId("panel-save").click();
  await expect(panel).toBeHidden();

  await expect(async () => {
    const res = await request.get(`${baseURL}/api/cards/${term}`);
    const card = await res.json();
    expect(card.body).toBe("updated body content");
    expect(new Date(card.updated).getTime()).toBeGreaterThanOrEqual(
      new Date(original.updated).getTime()
    );
    expect(card.created).toBe(original.created);
  }).toPass();

  // Re-open (via the API match + a fresh panel open) and delete.
  await draft.fill("");
  await draft.fill(prompt);
  await draft.evaluate(
    (el: HTMLTextAreaElement, [s, e]: [number, number]) => {
      el.focus();
      el.setSelectionRange(s, e);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    },
    [start, end]
  );
  await page.getByTestId("gloss-affordance").click();
  await expect(panel).toBeVisible();
  await page.getByTestId("panel-delete").click();
  await expect(panel).toBeHidden();

  await expect(async () => {
    const res = await request.get(`${baseURL}/api/cards/${term}`);
    expect(res.status()).toBe(404);
  }).toPass();

  // The indicator no longer fires for the deleted term.
  await draft.fill(`what about ${term}`);
  await page.getByTestId("send-button").click();
  await expect(page.getByTestId(`injection-chip-${term}`)).toHaveCount(0);

  await deleteCardIfExists(request, baseURL!, term);
});
