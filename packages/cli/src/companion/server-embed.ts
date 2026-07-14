// The companion's embedded panel server (TERMINAL.md §8.3). A thin, reusable
// seam over `buildServer` + the shared web UI: binds an EPHEMERAL port (0) on
// localhost so it can never collide with a running `prompt-gloss web` on 4319,
// wires the `onCardSaved` hook the flow needs, and returns a handle the
// companion can address (`baseUrl`) and shut down (`close`).

import type { AddressInfo } from "node:net";
import { buildServer, resolveConfig, type ServerHooks } from "@prompt-gloss/server";
import { registerWebUi } from "../web-assets.js";

export interface PanelServerOptions {
  /** The resolved target project; cards are written under its `.gloss/`. */
  readonly projectDir: string;
  /** Bind port; defaults to 0 (OS-assigned ephemeral). */
  readonly port?: number;
  /** Card-saved hook → the companion's OS notification (§6). */
  readonly hooks?: ServerHooks;
  readonly log?: (line: string) => void;
}

export interface PanelServer {
  /** e.g. "http://127.0.0.1:53187" — the ephemeral bound address, no trailing slash. */
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startPanelServer(opts: PanelServerOptions): Promise<PanelServer> {
  const log = opts.log ?? (() => undefined);
  const config = resolveConfig({ projectDir: opts.projectDir, port: opts.port ?? 0 });
  const app = await buildServer(config, opts.hooks ?? {});
  await registerWebUi(app, log);

  await app.listen({ host: config.host, port: config.port });
  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://${config.host}:${address.port}`;

  return {
    baseUrl,
    close: () => app.close()
  };
}
