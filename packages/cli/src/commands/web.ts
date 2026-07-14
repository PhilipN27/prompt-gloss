// `prompt-gloss web` (TERMINAL.md §10): run the v1 web app against a project
// dir — the npx-runnable quick start. buildServer provides the REST/SSE API;
// the built web UI is served statically via the shared `registerWebUi` helper
// (also used by the companion's embedded panel server, §8.3).

import { buildServer, resolveConfig } from "@prompt-gloss/server";
import { registerWebUi } from "../web-assets.js";

export interface WebOptions {
  projectDir: string;
  port?: number;
  log?: (line: string) => void;
}

export async function runWeb(opts: WebOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);
  const config = resolveConfig({
    projectDir: opts.projectDir,
    ...(opts.port !== undefined ? { port: opts.port } : {})
  });
  const app = await buildServer(config);

  await registerWebUi(app, log);

  await app.listen({ host: config.host, port: config.port });
  log(`Gloss web running at http://${config.host}:${config.port} (project: ${config.projectDir})`);
}
