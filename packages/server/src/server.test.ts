import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./app.js";

let projectDir: string;
let app: FastifyInstance;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "gloss-server-"));
  // fakeAgent: true so no API key / network is needed (the LLM is not under test).
  app = await buildServer({ projectDir, fakeAgent: true });
});

afterEach(async () => {
  await app.close();
  await rm(projectDir, { recursive: true, force: true });
});

const cardBody = {
  term: "xyz",
  aliases: ["metrics panel"],
  body: "xyz is the metrics panel.",
  source: { span: "xyz", message: "build xyz" }
};

describe("card CRUD routes", () => {
  it("POST /api/cards creates a card and writes the file", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cards",
      payload: cardBody
    });
    expect(res.statusCode).toBe(201);
    const card = res.json();
    expect(card.slug).toBe("xyz");
    expect(existsSync(join(projectDir, ".gloss", "cards", "xyz.md"))).toBe(true);
  });

  it("GET /api/cards lists cards", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    const res = await app.inject({ method: "GET", url: "/api/cards" });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { slug: string }) => c.slug)).toEqual(["xyz"]);
  });

  it("GET /api/cards/:slug reads one card", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    const res = await app.inject({ method: "GET", url: "/api/cards/xyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json().term).toBe("xyz");
  });

  it("GET /api/cards/:slug 404s for a missing card", async () => {
    const res = await app.inject({ method: "GET", url: "/api/cards/nope" });
    expect(res.statusCode).toBe(404);
  });

  it("PUT /api/cards/:slug updates a card", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    const res = await app.inject({
      method: "PUT",
      url: "/api/cards/xyz",
      payload: { body: "updated body" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().body).toBe("updated body");
  });

  it("DELETE /api/cards/:slug removes a card", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    const del = await app.inject({ method: "DELETE", url: "/api/cards/xyz" });
    expect(del.statusCode).toBe(204);
    expect(existsSync(join(projectDir, ".gloss", "cards", "xyz.md"))).toBe(false);
  });
});

describe("POST /api/match", () => {
  it("returns matching slugs for a span of text", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    const res = await app.inject({
      method: "POST",
      url: "/api/match",
      payload: { text: "the metrics panel is slow" }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slugs).toEqual(["xyz"]);
  });
});

describe("message pipeline + injection indicator data", () => {
  it("POST /api/messages returns the injected slugs for the indicator", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    const res = await app.inject({
      method: "POST",
      url: "/api/messages",
      payload: { text: "please open xyz now" }
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(typeof body.messageId).toBe("string");
    expect(body.slugs).toEqual(["xyz"]);
  });

  it("returns no slugs when nothing matches", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    const res = await app.inject({
      method: "POST",
      url: "/api/messages",
      payload: { text: "completely unrelated prose" }
    });
    expect(res.json().slugs).toEqual([]);
  });
});

describe("Injector boundary: injected context reaches the fake agent (§9)", () => {
  it("the debug endpoint exposes the exact <gloss-context> payload sent through the boundary", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    const msg = await app.inject({
      method: "POST",
      url: "/api/messages",
      payload: { text: "open xyz" }
    });
    const { messageId } = msg.json();

    const debug = await app.inject({ method: "GET", url: "/api/debug/last-injection" });
    expect(debug.statusCode).toBe(200);
    const recorded = debug.json();
    expect(recorded.messageId).toBe(messageId);
    expect(recorded.slugs).toEqual(["xyz"]);
    // The payload that reached the (fake) agent is the real budget output.
    expect(recorded.payload).toContain("<gloss-context>");
    expect(recorded.payload).toContain('<card term="xyz"');
    expect(recorded.payload).toContain("xyz is the metrics panel.");
  });

  it("records no injection payload when the message matches nothing (no noise)", async () => {
    await app.inject({ method: "POST", url: "/api/cards", payload: cardBody });
    await app.inject({
      method: "POST",
      url: "/api/messages",
      payload: { text: "nothing to see here" }
    });
    const debug = await app.inject({ method: "GET", url: "/api/debug/last-injection" });
    // Either null or an empty-payload record with no slugs — never a phantom card.
    const recorded = debug.json();
    if (recorded !== null) {
      expect(recorded.slugs).toEqual([]);
      expect(recorded.payload).toBe("");
    }
  });
});

describe("GET /api/session", () => {
  it("reports the project dir and session info", async () => {
    const res = await app.inject({ method: "GET", url: "/api/session" });
    expect(res.statusCode).toBe(200);
    const info = res.json();
    expect(info.projectDir).toBe(projectDir);
    expect("id" in info).toBe(true);
    expect(info.resumed).toBe(false);
  });
});
