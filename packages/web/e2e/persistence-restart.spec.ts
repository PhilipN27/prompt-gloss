import { expect, test } from "@playwright/test";
import { spawnStandaloneServer, uniqueSuffix } from "./helpers.js";

// TESTING.md scenario 5: Persistence across restart — the "restart entirely,
// knowledge survives" acceptance test from the v1 definition of done. Cards
// are file-backed (ARCHITECTURE.md §3.7): a fresh server process re-reads the
// same .gloss/ dir and the matcher/injection pipeline behaves identically,
// independent of SDK session continuity.
//
// This scenario needs a real second server process to stop/start against a
// single project dir it fully controls — the shared webServer instance (one
// process for the whole run, see playwright.config.ts) can't do that mid-run
// without disturbing the other 6 scenarios. It exercises the server's real
// HTTP API directly (no browser UI) since the persistence guarantee under
// test lives entirely in that API, not in DOM rendering.
test("a saved card still injects after the server process restarts", async ({ request }) => {
  const term = `restart-${uniqueSuffix()}`;
  const server = await spawnStandaloneServer(4720);

  try {
    const createRes = await request.post(`${server.baseURL}/api/cards`, {
      data: {
        term,
        aliases: [],
        body: "Survives a restart because cards are files, not session state.",
        source: { span: term, message: "seed" }
      }
    });
    expect(createRes.ok()).toBe(true);

    await server.restart();

    const sendRes = await request.post(`${server.baseURL}/api/messages`, {
      data: { text: `tell me about ${term}` }
    });
    expect(sendRes.ok()).toBe(true);
    const sent = await sendRes.json();
    expect(sent.slugs).toContain(term);

    const debugRes = await request.get(`${server.baseURL}/api/debug/last-injection`);
    const debug = await debugRes.json();
    expect(debug.slugs).toContain(term);
    expect(debug.payload).toContain("Survives a restart");
  } finally {
    await server.stop();
  }
});
