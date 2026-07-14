// `prompt-gloss companion` (TERMINAL.md §8) — the OS companion daemon wiring.
// Integrator-owned: selects the per-OS capture adapter, embeds the panel server
// (with the standalone /panel + picker routes) on an ephemeral port, builds the
// capture flow, and binds the global hotkey. Every failure mode degrades
// honestly to the CLI rung (§9.3) — it never crashes, and never silently writes
// cards under `process.cwd()`.
//
// Project targeting (§8.2): an explicit `--project` binds the server to that
// project immediately. With no `--project`, the companion starts a *picker*
// server (bound to a private throwaway dir, and picker-only so it never serves
// the card form); the first hotkey opens the picker page, and selecting a
// project rebinds the companion to a project-bound server (`onProjectSelected`)
// for that capture and every subsequent one. The flow reads the active server's
// base URL and the current project through a mutable `session`, so the rebind
// needs no flow reconstruction.
//
// Lifecycle safety (break-it 2026-07-14): server startup that races `stop()`
// self-closes; a superseded project server is retired to bound accumulation; a
// failed autostart write never orphans the daemon; and `stop()` waits for an
// in-flight capture while a stop-guard prevents opening a panel against an
// already-closed server.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const rawOpener = opts.opener ?? createAppModeOpener(log);
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

  // --- Server lifecycle (stop-safe) -----------------------------------------
  let stopped = false;
  const openServers = new Set<PanelServer>();
  // A private, per-process throwaway dir hosts the picker server. It is never a
  // real project (the picker server is picker-only, so its /api/cards is never
  // reached by the UI); using a private mkdtemp — not shared /tmp — keeps any
  // stray write off a world-readable path (break-it F1).
  let pickerPlaceholder: string | undefined;

  const flowRef: { flow?: CaptureFlow } = {};
  const session: { server: PanelServer; projectDir: string | null } = {
    server: undefined as unknown as PanelServer,
    projectDir: opts.projectDir ?? null
  };

  async function startBoundServer(projectDir: string, pickerOnly: boolean): Promise<PanelServer> {
    const server = await startServer({
      projectDir,
      hooks: { onCardSaved: (e) => flowRef.flow?.onCardSaved(e) },
      panelRoutes: {
        ...(opts.homeDir ? { homeDir: opts.homeDir } : {}),
        pickerOnly,
        onProjectSelected
      },
      log
    });
    // If stop() already ran while this was starting, don't leak it (break-it F2).
    if (stopped) {
      await server.close().catch(() => undefined);
      return server;
    }
    openServers.add(server);
    return server;
  }

  // Project selection is serialized so concurrent picks can't tear the session.
  // Superseded servers are retired on stop() only — NOT eagerly — so we never
  // close a server that a concurrent capture, or the picker request itself, may
  // still be using (break-it round 2 F2/F4). A re-pick therefore leaves one
  // bounded idle localhost listener until shutdown; closeAll() reaps them all
  // exactly once.
  let selectLock: Promise<unknown> = Promise.resolve();
  const onProjectSelected = (selection: ProjectPickerSelection): Promise<ProjectPickerResult> => {
    const run = selectLock.then(async (): Promise<ProjectPickerResult> => {
      const server = await startBoundServer(selection.projectDir, false);
      if (stopped) throw new Error("companion is shutting down");
      session.server = server;
      session.projectDir = selection.projectDir;
      return { panelUrl: panelUrl(server.baseUrl, selection.span) };
    });
    selectLock = run.catch(() => undefined);
    return run;
  };

  // Initial server: the chosen project, or a picker-only server on a private dir.
  if (session.projectDir) {
    session.server = await startBoundServer(session.projectDir, false);
  } else {
    pickerPlaceholder = mkdtempSync(join(tmpdir(), "gloss-picker-"));
    session.server = await startBoundServer(pickerPlaceholder, true);
  }

  const endpoints: PanelEndpoints = {
    get baseUrl() {
      return session.server.baseUrl;
    },
    panelPath: "/panel",
    pickerPath: "/panel"
  };
  // Stop-guarded opener: after stop(), a late-resolving capture must not launch
  // a browser against an already-closed server (break-it F5).
  const opener: PanelOpener = { open: async (url) => (stopped ? undefined : rawOpener.open(url)) };
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

  const cleanupPlaceholder = (): void => {
    if (pickerPlaceholder) {
      try {
        rmSync(pickerPlaceholder, { recursive: true, force: true });
      } catch {
        // best-effort cleanup of the throwaway picker dir
      }
    }
  };
  const closeAll = async (): Promise<void> => {
    stopped = true;
    const servers = [...openServers];
    openServers.clear();
    await Promise.allSettled(servers.map((s) => s.close()));
    cleanupPlaceholder();
  };

  // Track EVERY hotkey promise so stop() awaits any genuinely-running capture
  // (break-it F5). The flow's reentrancy guard makes overlapping presses resolve
  // immediately, so a single reassigned reference could point at a dropped call
  // rather than the running one — a set avoids that.
  const outstanding = new Set<Promise<void>>();
  const accelerator = opts.accelerator ?? defaultAccelerator(env.platform);
  const reg = await adapter.hotkey.register(accelerator, () => {
    const p = flow.onHotkey().finally(() => outstanding.delete(p));
    outstanding.add(p);
    return p;
  });
  if (!reg.ok) {
    log(`Gloss companion: couldn't bind the hotkey (${accelerator}). ${reg.detail}`);
    log("  Falling back to the CLI rung: `prompt-gloss add`.");
    await reg.dispose();
    await closeAll();
    return degraded;
  }

  // Autostart is a nice-to-have: a failed write must never orphan the running
  // daemon (break-it F3).
  if (opts.installAutostart) {
    try {
      await installAutostart({
        platform: env.platform,
        ...(opts.projectDir ? { projectDir: opts.projectDir } : {}),
        log
      });
    } catch (err) {
      log(
        `Gloss companion: autostart setup failed (${err instanceof Error ? err.message : String(err)}). ` +
          "The companion is running; add it to login items manually."
      );
    }
  }

  const where = session.projectDir ? `project: ${session.projectDir}` : "pick a project on the first hotkey";
  log(`Gloss companion ready — hotkey ${accelerator}, panel ${session.server.baseUrl} (${where}).`);
  return {
    get baseUrl() {
      return session.server.baseUrl;
    },
    stop: async () => {
      stopped = true; // block new panel opens before we start tearing down
      await reg.dispose();
      await Promise.allSettled([...outstanding]);
      await closeAll();
    }
  };
}
