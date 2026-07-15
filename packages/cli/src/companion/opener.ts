// Opens the companion panel in a focused Chromium app-mode window when one is
// available, with the OS default browser as a best-effort fallback
// (TERMINAL.md §8.3). App-mode windows cannot be made always-on-top; that is a
// documented v-next native-shell upgrade.

import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { PanelOpener } from "./types.js";

interface SpawnedProcess {
  once(event: "spawn", listener: () => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  unref(): void;
}

export type BrowserSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => SpawnedProcess;

export interface AppModeOpenerDeps {
  /** Injectable platform and process boundary for headless command-selection tests. */
  readonly platform?: NodeJS.Platform;
  readonly spawn?: BrowserSpawn;
  /** Defaults to the two Phase-D-pinned Chromium command names. */
  readonly browserCommands?: readonly string[];
}

const realSpawn: BrowserSpawn = (command, args, options) =>
  nodeSpawn(command, [...args], options);

const detachedOptions: SpawnOptions = {
  detached: true,
  stdio: "ignore",
  windowsHide: true
};

function defaultBrowserCommand(
  platform: NodeJS.Platform,
  url: string
): { command: string; args: string[] } | null {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      // `explorer.exe <url>` opens the URL with the default handler and takes it
      // as a SINGLE argv — no cmd.exe reparse. So the `&` query separators and
      // the `%` percent-encoding pass through literally, unlike `cmd /c start`,
      // which splits on `&` and expands `%VAR%` (break-it F1 + round-2 %-edge).
      // explorer exits non-zero even on success, but we key off the "spawn"
      // event, not the exit code.
      return { command: "explorer.exe", args: [url] };
    case "linux":
      return { command: "xdg-open", args: [url] };
    default:
      return null;
  }
}

async function tryLaunch(
  spawn: BrowserSpawn,
  command: string,
  args: readonly string[],
  log: (line: string) => void
): Promise<boolean> {
  try {
    const child = spawn(command, args, detachedOptions);
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (launched: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(launched);
      };
      child.once("spawn", () => finish(true));
      child.once("error", (error) => {
        log(`[gloss companion] could not launch ${command}: ${error.message}`);
        finish(false);
      });
      child.unref();
    });
  } catch (error) {
    log(`[gloss companion] could not launch ${command}: ${String(error)}`);
    return false;
  }
}

/**
 * Create the panel OUTPUT boundary. `open()` resolves after a process is
 * successfully spawned (not after the browser exits), and never rejects when
 * browser commands are missing.
 */
export function createAppModeOpener(
  log: (line: string) => void = () => undefined,
  deps: AppModeOpenerDeps = {}
): PanelOpener {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? realSpawn;
  const browserCommands = deps.browserCommands ?? ["chrome", "msedge"];
  const safeLog = (line: string): void => {
    try {
      log(line);
    } catch {
      // Logging must not turn a missing optional browser into a daemon failure.
    }
  };

  return {
    open: async (url: string) => {
      for (const command of browserCommands) {
        if (await tryLaunch(spawn, command, [`--app=${url}`], safeLog)) {
          safeLog(`[gloss companion] opened app-mode panel with ${command}`);
          return;
        }
      }

      const fallback = defaultBrowserCommand(platform, url);
      if (!fallback) {
        safeLog(`[gloss companion] no browser launcher is available on ${platform}: ${url}`);
        return;
      }
      if (await tryLaunch(spawn, fallback.command, fallback.args, safeLog)) {
        safeLog("[gloss companion] opened panel in the default browser");
      } else {
        safeLog(`[gloss companion] no browser could be opened; panel URL: ${url}`);
      }
    }
  };
}
