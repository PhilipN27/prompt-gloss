import { expect, test } from "@playwright/test";
import { uniqueSuffix } from "./helpers.js";

// TESTING.md scenario 6: No match, no noise. A message matching no card shows
// no indicator, and the debug endpoint records no injected payload.
test("a message matching no card produces no indicator and no injection", async ({
  page,
  request,
  baseURL
}) => {
  const nonsense = `zzznomatch-${uniqueSuffix()} completely unrelated words here`;

  await page.goto("/");
  await page.getByTestId("draft-input").fill(nonsense);
  await page.getByTestId("send-button").click();

  // The message sends and gets an assistant reply, but no chip row appears.
  await expect(page.locator(".gloss-message--assistant").last()).toBeVisible();
  await expect(page.locator("[data-testid='injection-chips']")).toHaveCount(0);

  const debugRes = await request.get(`${baseURL}/api/debug/last-injection`);
  const debug = await debugRes.json();
  expect(debug.slugs).toEqual([]);
  expect(debug.payload).toBe("");
});
