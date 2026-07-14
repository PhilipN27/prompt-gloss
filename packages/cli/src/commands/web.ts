// `prompt-gloss web` (TERMINAL.md §10): run the v1 web app against a project
// dir — the npx-runnable quick start. buildServer provides the REST/SSE API;
// the built web UI is served statically from the assets shipped with the CLI
// (falling back to the monorepo's packages/web/dist in dev).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { buildServer, resolveConfig } from "@prompt-gloss/server";

export interface WebOptions {
  projectDir: string;
  port?: number;
  log?: (line: string) => void;
}

/** The built web UI: shipped next to the CLI dist, or the monorepo build. */
function webDistPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "web"), // dist/commands → dist/web (published layout)
    join(here, "..", "..", "web"), // src/commands in dev after copy
    join(here, "..", "..", "..", "web", "dist") // monorepo packages/web/dist
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  return null;
}

export async function runWeb(opts: WebOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);
  const config = resolveConfig({
    projectDir: opts.projectDir,
    ...(opts.port !== undefined ? { port: opts.port } : {})
  });
  const app = await buildServer(config);

  const webDist = webDistPath();
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: unknown non-API routes get index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/")) return reply.code(404).send();
      return reply.sendFile("index.html");
    });
  } else {
    log("warning: web UI assets not found — serving the API only (build @prompt-gloss/web)");
  }

  await app.listen({ host: config.host, port: config.port });
  log(`Gloss web running at http://${config.host}:${config.port} (project: ${config.projectDir})`);
}
