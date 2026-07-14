// `prompt-gloss companion` (TERMINAL.md §8) — the OS companion daemon wiring.
// Integrator-owned: selects the per-OS capture adapter, embeds the panel
// server on an ephemeral port, builds the capture flow, and binds the global
// hotkey. Every failure mode degrades honestly to the CLI rung (§9.3) — it
// never crashes, and never silently writes cards under `process.cwd()`.
//
// Real dependencies (adapter, opener, notifier, server) are all injectable so
// the wiring — including hotkey registration + disposal — is testable without
// loading uiohook-napi or opening a real window (TESTING.md boundary rule).

import { CaptureFlow } from "./flow.js";
import { selectAdapter, currentEnv, type AdapterEnv, type CaptureAdapter } from "./select.js";
import { startPanelServer } from "./server-embed.js";
import { createProjectResolver } from "./project-resolver.js";
import { createAppModeOpener } from "./opener.js";
import { createOsNotifier } from "./notifier.js";
import { installAutostart } from "./autostart.js";
import type { Notifier, PanelEndpoints, PanelOpener } from "./types.js";

export interface CompanionOptions {
  /** Explicit `--project <dir>` (absolute). Undefined → the first-hotkey picker
   *  (panel slice); the companion never defaults to cwd. */
  projectDir?: string;
  /** Global hotkey; defaults per-OS (§8.2: ctrl+alt+j / cmd+alt+j). */
  accelerator?: string;
  installAutostart?: boolean;
  log?: (line: string) => void;
  // --- test seams (default to the real implementations) ---
  env?: AdapterEnv;
  /** Pass `null` to force the no-OS-adapter path; omit for the real registry. */
  adapter?: CaptureAdapter | null;
  opener?: PanelOpener;
  notifier?: Notifier;
  startServer?: typeof startPanelServer;
}

export interface CompanionHandle {
  /** The embedded panel server's base URL, or null when the companion could not
   *  start capture (degraded to the CLI rung). */
  readonly baseUrl: string | null;
  stop(): Promise<void>;
}

function defaultAccelerator(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "cmd+alt+j" : "ctrl+alt+j";
}

export async function runCompanion(opts: CompanionOptions = {}): Promise<CompanionHandle> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const env = opts.env ?? currentEnv();
  const opener = opts.opener ?? createAppModeOpener(log);
  const notifier = opts.notifier ?? createOsNotifier(log);
  const startServer = opts.startServer ?? startPanelServer;
  const degraded: CompanionHandle = { baseUrl: null, stop: async () => undefined };

  const adapter = opts.adapter !== undefined ? opts.adapter : selectAdapter(env);
  if (!adapter) {
    log(`Gloss companion: no OS capture surface on ${env.platform}. Use \`prompt-gloss add\` (the CLI rung).`);
    return degraded;
  }

  // Non-prompting capability check up front (doctor-grade). Unsupported → CLI
  // rung; blocked → warn but proceed (a per-capture `blocked` result will re-toast
  // the remediation, and the daemon can recover after the grant).
  const cap = await adapter.selection.probe();
  if (cap.support === "unsupported") {
    log(`Gloss companion: ${cap.detail}`);
    if (cap.remediation) log(`  fix: ${cap.remediation}`);
    log("  Falling back to the CLI rung: `prompt-gloss add`.");
    return degraded;
  }
  if (cap.support === "blocked" && cap.remediation) {
    log(`Gloss companion: permission needed — ${cap.remediation}`);
  }

  // The companion targets ONE project. Require an explicit --project until the
  // panel slice ships the first-hotkey picker — never default to cwd.
  if (!opts.projectDir) {
    log("Gloss companion needs a project: run `prompt-gloss companion --project <dir>`.");
    log("  (the first-hotkey project picker ships in the panel slice)");
    return degraded;
  }
  const projectDir = opts.projectDir;

  // Embedded panel server on an ephemeral port; a save fires the notification.
  // `flowRef` breaks the flow↔server cycle: the server's onCardSaved dispatches
  // to the flow once it exists.
  const flowRef: { flow?: CaptureFlow } = {};
  const server = await startServer({
    projectDir,
    hooks: { onCardSaved: (e) => flowRef.flow?.onCardSaved(e) },
    log
  });

  const endpoints: PanelEndpoints = {
    baseUrl: server.baseUrl,
    panelPath: "/panel",
    pickerPath: "/panel"
  };
  const flow = new CaptureFlow({
    selection: adapter.selection,
    projects: createProjectResolver({ explicitProjectDir: projectDir }),
    opener,
    notifier,
    endpoints,
    log
  });
  flowRef.flow = flow;

  const accelerator = opts.accelerator ?? defaultAccelerator(env.platform);
  const reg = await adapter.hotkey.register(accelerator, () => flow.onHotkey());
  if (!reg.ok) {
    log(`Gloss companion: couldn't bind the hotkey (${accelerator}). ${reg.detail}`);
    log("  Falling back to the CLI rung: `prompt-gloss add`.");
    await reg.dispose();
    await server.close();
    return degraded;
  }

  if (opts.installAutostart) {
    await installAutostart({ platform: env.platform, projectDir, log });
  }

  log(`Gloss companion ready — hotkey ${accelerator}, panel ${server.baseUrl} (project: ${projectDir}).`);
  return {
    baseUrl: server.baseUrl,
    stop: async () => {
      await reg.dispose();
      await server.close();
    }
  };
}
