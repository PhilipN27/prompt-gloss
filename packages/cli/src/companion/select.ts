// Adapter registry (TERMINAL.md §8, capture ladder §3). Routes by OS to the
// per-OS capture adapter; each adapter reports its own fine-grained capability
// via `selection.probe()` (X11 vs Wayland, permission state, etc.). This file
// is INTEGRATOR-OWNED: the parallel adapter slices replace their own
// `adapters/<os>.ts` file and never touch this registry, so they can't
// merge-conflict here (council 2026-07-14).

import type { HotkeyRegistrar, SelectionSource } from "./types.js";
import { createWindowsAdapter } from "./adapters/windows.js";
import { createMacosAdapter } from "./adapters/macos.js";
import { createLinuxAdapter } from "./adapters/linux.js";

/** A per-OS capture adapter: a selection source paired with its hotkey trigger.
 *  They are one unit — a selection mechanism with no bindable hotkey is not a
 *  usable companion rung (council-pinned; Wayland especially, §8.2). */
export interface CaptureAdapter {
  readonly selection: SelectionSource;
  readonly hotkey: HotkeyRegistrar;
}

/** The bits of the process environment adapters need to detect their session
 *  (X11 vs Wayland, etc.). Injected so tests never touch real `process`. */
export interface AdapterEnv {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}

/** The current process environment as an `AdapterEnv`. */
export function currentEnv(): AdapterEnv {
  return { platform: process.platform, env: process.env };
}

/** Select the capture adapter for this OS, or `null` when no OS adapter applies
 *  (→ the caller degrades to the CLI rung, §9.3). Per-session capability
 *  (missing tools, denied permissions) is the adapter's own `probe()`/`capture`
 *  concern, not this router's. */
export function selectAdapter(env: AdapterEnv = currentEnv()): CaptureAdapter | null {
  switch (env.platform) {
    case "win32":
      return createWindowsAdapter(env);
    case "darwin":
      return createMacosAdapter(env);
    case "linux":
      return createLinuxAdapter(env);
    default:
      return null;
  }
}
