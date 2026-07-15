// The OS companion embeds this server in-process and needs a signal when a
// card is saved so it can fire an OS notification (TERMINAL.md §8.3/§6). That
// signal is an optional `onCardSaved` hook passed to buildServer as a SECOND
// argument — a callback, not a config field (GlossServerConfig is pure data).
//
// Council-pinned contract (Codex, 2026-07-14):
//  - fires on BOTH create (POST) and edit (PUT); the panel opens matched cards
//    in edit mode and saves them with PUT, so POST-only would miss saves.
//  - carries an { operation, card } event so the notification can distinguish
//    created vs updated.
//  - a THROWING hook must never convert a committed save into HTTP 500 — that
//    would make the UI retry and create a duplicate `<slug>-2.md`.
//  - fully optional: the v1 web app passes no hooks and is unaffected.

import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./app.js";
import type { CardSavedEvent } from "./app.js";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "gloss-server-"));
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("buildServer onCardSaved hook", () => {
  it("fires operation:created with the created card on POST /api/cards", async () => {
    const events: CardSavedEvent[] = [];
    app = await buildServer(
      { projectDir: makeProject(), fakeAgent: true },
      { onCardSaved: (e) => events.push(e) }
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/cards",
      payload: { term: "xyz", body: "the metrics panel", source: { span: "xyz", message: "m" } }
    });

    expect(res.statusCode).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]!.operation).toBe("created");
    expect(events[0]!.card.term).toBe("xyz");
    expect(events[0]!.card.slug).toBe("xyz");
  });

  it("fires operation:updated on PUT /api/cards/:slug (edit is also a save)", async () => {
    const events: CardSavedEvent[] = [];
    app = await buildServer(
      { projectDir: makeProject(), fakeAgent: true },
      { onCardSaved: (e) => events.push(e) }
    );

    const created = await app.inject({
      method: "POST",
      url: "/api/cards",
      payload: { term: "xyz", body: "v1", source: { span: "xyz", message: "m" } }
    });
    const slug = created.json().slug as string;

    const updated = await app.inject({
      method: "PUT",
      url: `/api/cards/${slug}`,
      payload: { body: "v2" }
    });

    expect(updated.statusCode).toBe(200);
    expect(events.map((e) => e.operation)).toEqual(["created", "updated"]);
    expect(events[1]!.card.body).toBe("v2");
  });

  it("does not fire for a PUT to a missing card", async () => {
    const events: CardSavedEvent[] = [];
    app = await buildServer(
      { projectDir: makeProject(), fakeAgent: true },
      { onCardSaved: (e) => events.push(e) }
    );

    const res = await app.inject({ method: "PUT", url: "/api/cards/nope", payload: { body: "x" } });

    expect(res.statusCode).toBe(404);
    expect(events).toEqual([]);
  });

  it("still returns 201 when the hook throws — a notification failure must not fail the save", async () => {
    app = await buildServer(
      { projectDir: makeProject(), fakeAgent: true },
      {
        onCardSaved: () => {
          throw new Error("notifier exploded");
        }
      }
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/cards",
      payload: { term: "xyz", body: "b", source: { span: "xyz", message: "m" } }
    });

    // The card was committed; the response must reflect that, not the hook error.
    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe("xyz");
  });

  it("is optional — buildServer with no hooks still serves POST /api/cards", async () => {
    app = await buildServer({ projectDir: makeProject(), fakeAgent: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/cards",
      payload: { term: "xyz", body: "b", source: { span: "xyz", message: "m" } }
    });
    expect(res.statusCode).toBe(201);
  });
});
