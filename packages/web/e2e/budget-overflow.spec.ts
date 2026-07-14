import { expect, test } from "@playwright/test";
import { deleteCardIfExists, uniqueSuffix } from "./helpers.js";

// TESTING.md scenario 7: Budget overflow. Three cards each sized under the
// per-card cap (800 tokens / ~3200 chars) but whose combined size exceeds the
// total budget (2000 tokens): only the most-recently-updated cards that fit
// are injected; the debug payload confirms updated-desc packing order
// (ARCHITECTURE.md §6).
test("overflowing cards are packed most-recently-updated-first and the rest skipped", async ({
  page,
  request,
  baseURL
}) => {
  const suffix = uniqueSuffix();
  const oldest = `alpha-${suffix}`;
  const middle = `bravo-${suffix}`;
  const newest = `charlie-${suffix}`;

  // ~700 tokens each (2800 chars) — under the 800-token per-card cap, so none
  // are truncated; two together (~1400) fit the 2000 budget, three (~2100) don't.
  const bigBody = (label: string): string => `${label} filler. `.repeat(180);

  // Create in order so `updated` strictly increases oldest -> newest.
  await request.post(`${baseURL}/api/cards`, {
    data: { term: oldest, aliases: [], body: bigBody("alpha"), source: { span: oldest, message: "seed" } }
  });
  await request.post(`${baseURL}/api/cards`, {
    data: { term: middle, aliases: [], body: bigBody("bravo"), source: { span: middle, message: "seed" } }
  });
  await request.post(`${baseURL}/api/cards`, {
    data: {
      term: newest,
      aliases: [],
      body: bigBody("charlie"),
      source: { span: newest, message: "seed" }
    }
  });

  await page.goto("/");
  await page
    .getByTestId("draft-input")
    .fill(`compare ${oldest} and ${middle} and ${newest} for me`);
  await page.getByTestId("send-button").click();

  // The two most-recently-updated cards are indicated; the oldest is skipped.
  await expect(page.getByTestId(`injection-chip-${newest}`)).toBeVisible();
  await expect(page.getByTestId(`injection-chip-${middle}`)).toBeVisible();
  await expect(page.getByTestId(`injection-chip-${oldest}`)).toHaveCount(0);

  await expect(async () => {
    const res = await request.get(`${baseURL}/api/debug/last-injection`);
    const debug = await res.json();
    expect(debug.slugs).toEqual([newest, middle]);
    expect(debug.payload).toContain(newest);
    expect(debug.payload).toContain(middle);
    expect(debug.payload).not.toContain(`term="${oldest}"`);
  }).toPass();

  await deleteCardIfExists(request, baseURL!, oldest);
  await deleteCardIfExists(request, baseURL!, middle);
  await deleteCardIfExists(request, baseURL!, newest);
});
