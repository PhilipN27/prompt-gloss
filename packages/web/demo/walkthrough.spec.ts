import { expect, test } from "@playwright/test";
import { selectWordByDrag } from "../e2e/helpers.js";

// Scripted walkthrough for the README demo GIF (docs/demo.gif). Not a test —
// it runs under playwright.demo.config.ts only, paced for a human viewer:
// type a prompt → highlight "xyz" → save a context card → send → watch the
// injection chip appear → select "xyz" in the sent message to reopen the
// saved card. Target runtime: ~40s.

const beat = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("gloss demo walkthrough", async ({ page }) => {
  await page.goto("/");
  await beat(1200);

  // 1. Type the one-sentence prompt, naturally.
  const draft = page.getByTestId("draft-input");
  await draft.click();
  await draft.pressSequentially("I want a dashboard that helps me build xyz", {
    delay: 45
  });
  await beat(900);

  // 2. Highlight "xyz" in the draft (selectionStart/End path).
  const prompt = await draft.inputValue();
  const start = prompt.indexOf("xyz");
  await draft.evaluate(
    (el: HTMLTextAreaElement, [s, e]: [number, number]) => {
      el.focus();
      el.setSelectionRange(s, e);
      el.dispatchEvent(new Event("select", { bubbles: true }));
    },
    [start, start + 3]
  );
  const affordance = page.getByTestId("gloss-affordance");
  await expect(affordance).toBeVisible();
  await beat(1100);
  await affordance.click();

  // 3. Fill the card panel, naturally.
  const panel = page.getByTestId("gloss-panel");
  await expect(panel).toBeVisible();
  await beat(800);
  await page.getByTestId("panel-aliases").pressSequentially("metrics panel", { delay: 40 });
  await beat(400);
  await page
    .getByTestId("panel-body")
    .pressSequentially(
      "xyz is our internal name for the customer-facing metrics panel. " +
        "It reads from the analytics_rollup table, must stay under 200ms p95, " +
        "and is owned by the growth team.",
      { delay: 18 }
    );
  await beat(900);
  await page.getByTestId("panel-save").click();
  await expect(panel).toBeHidden();
  await beat(800);

  // 4. Send the message; the injection chip appears on it.
  await page.getByTestId("send-button").click();
  const chips = page.getByTestId("injection-chips").first();
  await expect(chips).toBeVisible();
  await beat(2200);

  // 5. Closing beat: select "xyz" in the sent message (DOM-range path) — the
  //    panel reopens in edit mode with the saved card.
  const sentMessage = page.locator(".gloss-message--user .gloss-message__text").first();
  await selectWordByDrag(page, sentMessage, "xyz");
  await expect(affordance).toBeVisible();
  await beat(900);
  await affordance.click();
  await expect(panel).toBeVisible();
  await beat(2500);
});
