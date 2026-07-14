// The Fastify app: REST + SSE routes (ARCHITECTURE.md §7) wired to the card
// store and the Injector boundary. Binds 127.0.0.1 only (§7); no auth in v1.

import Fastify, { type FastifyInstance } from "fastify";
import {
  CardStore,
  matchMessage,
  type NewCardInput,
  type UpdateCardInput
} from "@prompt-gloss/core";
import { resolveConfig, type GlossServerConfig } from "./config.js";
import { FakeInjector } from "./fake-injector.js";
import { SdkInjector } from "./sdk-injector.js";
import type { AgentEvent, Injector } from "./injector.js";
import { SessionState } from "./session-state.js";

interface CreateCardRequest {
  term: string;
  aliases?: string[];
  body: string;
  scope?: "project" | "global";
  source: { span: string; message: string };
}

function isCreateRequest(v: unknown): v is CreateCardRequest {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.term === "string" &&
    typeof o.body === "string" &&
    !!o.source &&
    typeof o.source === "object"
  );
}

export async function buildServer(
  overrides: Partial<GlossServerConfig> = {}
): Promise<FastifyInstance> {
  const config = resolveConfig(overrides);
  const app = Fastify({ logger: false });

  const store = new CardStore(config.projectDir);
  const state = new SessionState(config.projectDir);

  // Resume a persisted session id if one exists (real mode uses it; fake mode
  // ignores it but we still report resumed=false because the fake id is fresh).
  const priorSessionId = await state.read();

  const injector: Injector = config.fakeAgent
    ? new FakeInjector({ projectDir: config.projectDir, budget: config.budget })
    : new SdkInjector({
        projectDir: config.projectDir,
        budget: config.budget,
        resumeSessionId: priorSessionId,
        onSessionId: (id) => {
          void state.write(id);
        }
      });

  app.addHook("onClose", async () => {
    await injector.close();
  });

  // --- Session -------------------------------------------------------------
  app.get("/api/session", () => {
    const info = injector.session();
    return { id: info.id, projectDir: info.projectDir, resumed: info.resumed };
  });

  // --- Cards (CRUD) --------------------------------------------------------
  app.get("/api/cards", async () => {
    return store.list();
  });

  app.get<{ Params: { slug: string } }>("/api/cards/:slug", async (req, reply) => {
    const card = await store.get(req.params.slug);
    if (!card) return reply.code(404).send({ error: "card not found" });
    return card;
  });

  app.post("/api/cards", async (req, reply) => {
    if (!isCreateRequest(req.body)) {
      return reply.code(400).send({ error: "term, body and source are required" });
    }
    const input: NewCardInput = {
      term: req.body.term,
      body: req.body.body,
      source: req.body.source,
      ...(req.body.aliases !== undefined ? { aliases: req.body.aliases } : {}),
      ...(req.body.scope !== undefined ? { scope: req.body.scope } : {})
    };
    const card = await store.create(input);
    return reply.code(201).send(card);
  });

  app.put<{ Params: { slug: string }; Body: UpdateCardInput }>(
    "/api/cards/:slug",
    async (req, reply) => {
      const updated = await store.update(req.params.slug, req.body ?? {});
      if (!updated) return reply.code(404).send({ error: "card not found" });
      return updated;
    }
  );

  app.delete<{ Params: { slug: string } }>("/api/cards/:slug", async (req, reply) => {
    const ok = await store.delete(req.params.slug);
    if (!ok) return reply.code(404).send({ error: "card not found" });
    return reply.code(204).send();
  });

  // --- Match (UI opens edit mode on a selection) ---------------------------
  app.post<{ Body: { text?: string } }>("/api/match", async (req) => {
    const text = req.body?.text ?? "";
    const index = await store.buildIndex();
    return { slugs: matchMessage(text, index) };
  });

  // --- Messages ------------------------------------------------------------
  app.post<{ Body: { text?: string } }>("/api/messages", async (req, reply) => {
    const text = req.body?.text ?? "";
    if (text.trim().length === 0) {
      return reply.code(400).send({ error: "text is required" });
    }
    const result = await injector.send(text);
    return reply.code(202).send({ messageId: result.messageId, slugs: result.slugs });
  });

  // --- Events (SSE) --------------------------------------------------------
  app.get("/api/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    reply.raw.write(": connected\n\n");

    const stream = injector.events();
    let closed = false;
    const pump = async () => {
      for await (const event of stream as AsyncIterable<AgentEvent>) {
        if (closed) break;
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };
    void pump();

    req.raw.on("close", () => {
      closed = true;
    });
    // Keep the request open (SSE); do not return a body.
    return reply;
  });

  // --- Debug (fake mode only) ---------------------------------------------
  if (config.fakeAgent) {
    app.get("/api/debug/last-injection", () => {
      return injector.lastInjection();
    });
  }

  return app;
}
