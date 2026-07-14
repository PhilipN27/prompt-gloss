// CLI entry point: build the server from env/cwd config and listen on
// 127.0.0.1 only (ARCHITECTURE.md §7).

import { buildServer } from "./app.js";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();
  const app = await buildServer(config);
  await app.listen({ host: config.host, port: config.port });
  console.log(
    `[gloss] server on http://${config.host}:${config.port} ` +
      `(project: ${config.projectDir}${config.fakeAgent ? ", fake-agent" : ""})`
  );
}

main().catch((err: unknown) => {
  console.error("[gloss] failed to start:", err);
  process.exitCode = 1;
});
