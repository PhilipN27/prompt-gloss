// Shared static web-UI serving, used by both `prompt-gloss web` and the OS
// companion's embedded panel server (TERMINAL.md §8.3). The built web UI ships
// next to the CLI dist (published layout) or comes from the monorepo build in
// dev. Kept in one place so the two surfaces can never drift on asset discovery
// or the SPA fallback.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "@prompt-gloss/server";

/** The built web UI: shipped next to the CLI dist, or the monorepo build. */
export function webDistPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "web"), // dist/commands → dist/web (published layout)
    join(here, "..", "..", "web"), // src/commands in dev after copy
    join(here, "..", "..", "..", "web", "dist"), // monorepo packages/web/dist
    join(here, "..", "..", "web", "dist") // src/ (server-embed) → monorepo build
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  return null;
}

/**
 * Register the static web UI + SPA fallback on `app`. Returns true if assets
 * were found. When absent, logs a warning and serves the API only — a missing
 * build must degrade, not crash (the API + panel routes still work for tests).
 */
export async function registerWebUi(
  app: FastifyInstance,
  log: (line: string) => void = () => undefined
): Promise<boolean> {
  const webDist = webDistPath();
  if (!webDist) {
    log("warning: web UI assets not found — serving the API only (build @prompt-gloss/web)");
    return false;
  }
  await app.register(fastifyStatic, { root: webDist });
  // SPA fallback: unknown non-API routes get index.html.
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api/")) return reply.code(404).send();
    return reply.sendFile("index.html");
  });
  return true;
}
