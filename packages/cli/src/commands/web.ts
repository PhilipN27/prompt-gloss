// `prompt-gloss web` (TERMINAL.md §10): run the v1 web app against a project
// dir — the npx-runnable quick start. Thin wrapper over @prompt-gloss/server.

import { buildServer, resolveConfig } from "@prompt-gloss/server";

export interface WebOptions {
  projectDir: string;
  port?: number;
  log?: (line: string) => void;
}

export async function runWeb(opts: WebOptions): Promise<void> {
  const config = resolveConfig({
    projectDir: opts.projectDir,
    ...(opts.port !== undefined ? { port: opts.port } : {})
  });
  const app = await buildServer(config);
  await app.listen({ host: config.host, port: config.port });
  opts.log?.(`Gloss web running at http://${config.host}:${config.port} (project: ${config.projectDir})`);
}
