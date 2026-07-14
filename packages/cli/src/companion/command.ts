// `prompt-gloss companion` (TERMINAL.md §8) — the OS companion daemon wiring.
// Integrator-owned: selects the per-OS capture adapter, embeds the panel server
// (with the standalone /panel + picker routes) on an ephemeral port, builds the
// capture flow, and binds the global hotkey. Every failure mode degrades
// honestly to the CLI rung (§9.3) — it never crashes, and never silently writes
// cards under `process.cwd()`.
//
// Project targeting (§8.2): an explicit `--project` binds the server to that
// project immediately. With no `--project`, the companion starts a *picker*
// server; the first hotkey opens the picker page, and selecting a project
// rebinds the companion to a project-bound server (`onProjectSelected`) for that
// capture and every subsequent one. The flow reads the active server's base URL
// and the current project through a mutable `session`, so the rebind needs no
// flow reconstruction.
//
// Real dependencies (adapter, opener, notifier, server) are injectable so the
// wiring — including hotkey registration/disposal and the picker rebind — is
// testable without loading uiohook-napi or opening a real window (TESTING.md).

import { tmpdir } from "node:os";
import { CaptureFlow } from "./flow.js";
import { selectAdapter, currentEnv, type AdapterEnv, type CaptureAdapter } from "./select.js";
import { startPanelServer, type PanelServer } from "./server-embed.js";
import { createAppModeOpener } from "./opener.js";
import { createOsNotifier } from "./notifier.js";
import { installAutostart } from "./autostart.js";
import { COMPANION_ORIGIN } from "./types.js";
import type { Notifier, PanelEndpoints, PanelOpener, ProjectResolution } from "./types.js";
import type { ProjectPickerSelection, ProjectPickerResult } from "./picker.js";

export interface CompanionOptions {
  /** Explicit `--project <dir>` (absolute). Undefined → the first-hotkey picker;
   *  the companion never defaults to cwd. */
  projectDir?: string;
  /** Global hotkey; defaults per-OS (§8.2: ctrl+alt+j / cmd+alt+j). */
  accelerator?: string;
  installAutostart?: boolean;
  /** Home dir backing the picker's ~/.gloss/projects.json (test seam). */
  homeDir?: string;
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
  /** The active panel server's base URL, or null when the companion could not
   *  start capture (degraded to the CLI rung). */
  readonly baseUrl: string | null;
  stop(): Promise<void>;
}

function defaultAccelerator(platform: NodeJS.Platform): string {
  return platform === "darwin" ? "cmd+alt+j" : "ctrl+alt+j";
}

function panelUrl(baseUrl: string, span: string): string {
  const params = new URLSearchParams({ span, origin: COMPANION_ORIGIN });
  return `${baseUrl}/panel?${params.toString()}`;
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
  // rung; blocked → warn but proceed (a per-capture `blocked` result re-toasts
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

  // --- Mutable session + server lifecycle -----------------------------------
  // `session.projectDir` null means "no project chosen yet" → the flow opens the
  // picker. The picker server is bound to a throwaway dir purely to host the
  // picker page; its /api/cards is never exercised before a project is chosen.
  const flowRef: { flow?: CaptureFlow } = {};
  const openServers = new Set<PanelServer>();
  const session: { server: PanelServer; projectDir: string | null } = {
    server: undefined as unknown as PanelServer,
    projectDir: opts.projectDir ?? null
  };

  const onProjectSelected = async (
    selection: ProjectPickerSelection
  ): Promise<ProjectPickerResult> => {
    // Bind a fresh server to the chosen project and make it the active target.
    // The former picker server is retired on stop() (not here — it is currently
    // handling this very request).
    const server = await startBoundServer(selection.projectDir);
    session.server = server;
    session.projectDir = selection.projectDir;
    return { panelUrl: panelUrl(server.baseUrl, selection.span) };
  };

  async function startBoundServer(projectDir: string): Promise<PanelServer> {
    const server = await startServer({
      projectDir,
      hooks: { onCardSaved: (e) => flowRef.flow?.onCardSaved(e) },
      panelRoutes: {
        ...(opts.homeDir ? { homeDir: opts.homeDir } : {}),
        onProjectSelected
      },
      log
    });
    openServers.add(server);
    return server;
  }

  // Initial server: the chosen project, or a throwaway host for the picker.
  session.server = await startBoundServer(session.projectDir ?? tmpdir());

  const endpoints: PanelEndpoints = {
    get baseUrl() {
      return session.server.baseUrl;
    },
    panelPath: "/panel",
    pickerPath: "/panel"
  };
  const flow = new CaptureFlow({
    selection: adapter.selection,
    projects: {
      resolve: async (): Promise<ProjectResolution> =>
        session.projectDir ? { kind: "project", dir: session.projectDir } : { kind: "picker" }
    },
    opener,
    notifier,
    endpoints,
    log
  });
  flowRef.flow = flow;

  const closeAll = async (): Promise<void> => {
    await Promise.allSettled([...openServers].map((s) => s.close()));
    openServers.clear();
  };

  const accelerator = opts.accelerator ?? defaultAccelerator(env.platform);
  const reg = await adapter.hotkey.register(accelerator, () => flow.onHotkey());
  if (!reg.ok) {
    log(`Gloss companion: couldn't bind the hotkey (${accelerator}). ${reg.detail}`);
    log("  Falling back to the CLI rung: `prompt-gloss add`.");
    await reg.dispose();
    await closeAll();
    return degraded;
  }

  if (opts.installAutostart) {
    await installAutostart({
      platform: env.platform,
      ...(opts.projectDir ? { projectDir: opts.projectDir } : {}),
      log
    });
  }

  const where = session.projectDir ? `project: ${session.projectDir}` : "pick a project on the first hotkey";
  log(`Gloss companion ready — hotkey ${accelerator}, panel ${session.server.baseUrl} (${where}).`);
  return {
    get baseUrl() {
      return session.server.baseUrl;
    },
    stop: async () => {
      await reg.dispose();
      await closeAll();
    }
  };
}
