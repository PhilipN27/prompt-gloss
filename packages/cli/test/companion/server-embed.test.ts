// The companion embeds the panel server in-process (TERMINAL.md §8.3). Unlike
// `runWeb` (which owns the process forever on the configured port), the
// companion needs a reusable seam that binds an EPHEMERAL port (so a running
// web server on 4319 can't collide) and returns a handle it can address and
// close. `onCardSaved` is threaded through so a save fires the OS notification.

import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPanelServer, type PanelServer } from "../../src/companion/server-embed.js";
import type { CardSavedEvent } from "@prompt-gloss/server";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "gloss-embed-"));
}

let server: PanelServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("startPanelServer", () => {
  it("binds an ephemeral localhost port and exposes a usable baseUrl", async () => {
    server = await startPanelServer({ projectDir: makeProject() });

    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const port = Number(new URL(server.baseUrl).port);
    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(4319); // not the fixed web port

    const res = await fetch(`${server.baseUrl}/api/cards`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("threads onCardSaved through to the POST /api/cards route", async () => {
    const events: CardSavedEvent[] = [];
    server = await startPanelServer({
      projectDir: makeProject(),
      hooks: { onCardSaved: (e) => events.push(e) }
    });

    const res = await fetch(`${server.baseUrl}/api/cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: "xyz", body: "b", source: { span: "xyz", message: "m", origin: "companion" } })
    });

    expect(res.status).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]!.operation).toBe("created");
    expect(events[0]!.card.term).toBe("xyz");
  });

  it("close() stops the listener", async () => {
    const s = await startPanelServer({ projectDir: makeProject() });
    const { baseUrl } = s;
    await s.close();
    await expect(fetch(`${baseUrl}/api/cards`)).rejects.toThrow();
  });
});
