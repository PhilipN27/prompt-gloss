import { expect, test } from "@playwright/test";
import { deleteCardIfExists, selectWordByDrag, uniqueSuffix } from "./helpers.js";

// TESTING.md scenario 2: Create card from an assistant message. Rendered-
// message selection uses window.getSelection() DOM ranges — a distinct code
// path from create-from-draft.spec.ts's selectionStart/selectionEnd.
test("create card from a rendered assistant message selection", async ({
  page,
  request,
  baseURL
}) => {
  const term = `widget-${uniqueSuffix()}`;

  await page.goto("/");

  const draft = page.getByTestId("draft-input");
  await draft.fill(`tell me about the ${term} please`);
  await page.getByTestId("send-button").click();

  // Fake agent echoes back a reply that includes the injected/matched slugs
  // string, or a generic ack; either way an assistant row renders. We only
  // need *a* rendered assistant message container to select inside.
  const assistantMessage = page.locator(".gloss-message--assistant").last();
  await expect(assistantMessage).toBeVisible();

  // Select a word inside the assistant message via a real DOM range (mouse
  // drag over "agent", not triple-click: triple-click on a block element can
  // select across into an adjacent message's boundary, which the app
  // correctly treats as a cross-message selection and ignores — v1 policy is
  // single-message selections only, ARCHITECTURE.md §9).
  const textEl = assistantMessage.locator(".gloss-message__text");
  await selectWordByDrag(page, textEl, "agent");

  const affordance = page.getByTestId("gloss-affordance");
  await expect(affordance).toBeVisible();
  await affordance.click();

  const panel = page.getByTestId("gloss-panel");
  await expect(panel).toBeVisible();

  await page.getByTestId("panel-term").fill(term);
  await page.getByTestId("panel-aliases").fill("");
  await page.getByTestId("panel-body").fill("Context saved from an assistant message.");
  await page.getByTestId("panel-save").click();

  await expect(panel).toBeHidden();

  await expect(async () => {
    const res = await request.get(`${baseURL}/api/cards/${term}`);
    expect(res.ok()).toBe(true);
    const card = await res.json();
    expect(card.term).toBe(term);
    // Pin the captured span to the exact word selected via the DOM-range path,
    // so a selection that grabbed the wrong text (or nothing) fails here rather
    // than passing on a length>0 check.
    expect(card.source.span).toBe("agent");
    expect(card.source.message.length).toBeGreaterThan(0);
  }).toPass();

  await deleteCardIfExists(request, baseURL!, term);
});
