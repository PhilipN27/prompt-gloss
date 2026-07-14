// macOS capture adapter (TERMINAL.md §2.4/§8.2, docs/plans/v2-companion-plan.md
// "Slice 2 — @claude macOS adapter"). Phase D slice file — owned by this slice
// only; the foundation (types.ts, flow.ts, select.ts) stays untouched.
//
// Mechanism:
//  - Hotkey: uiohook-napi (CGEventTap) → the INPUT MONITORING pane (System
//    Settings › Privacy & Security › Input Monitoring) — NOT Accessibility
//    (§2.4). `uiohook-napi` is lazy-imported inside `register()`/`capture()`
//    in a try/catch, NEVER at module top-level, so CI and `doctor`'s
//    non-prompting `probe()` never require the native prebuild (council rule
//    5). Because "uiohook-napi" isn't a literal string at the `import(...)`
//    call site, `tsc` never attempts to resolve it as a module (no @types
//    dependency, no ambient `.d.ts` needed) — the loaded module is validated
//    defensively against the local `UiohookModule` shape instead.
//  - Capture: snapshot `NSPasteboard` (`pbpaste`) → synthesize ⌘C via uiohook
//    `keyTap` (safe on macOS — SIGINT is Ctrl+C, a different chord) → read →
//    RESTORE the original pasteboard (`pbcopy`), always, so the synthesized
//    copy is invisible to the user's real clipboard history.
//  - `blocked` (permission-denied) is DISTINCT from `unsupported`: a grant +
//    restart recovers it, so the flow must never route it permanently to the
//    CLI rung (flow.ts already renders `remediation` + "restart the
//    companion" for it).
//  - `probe()` is NON-PROMPTING: it must not start the CGEventTap (that is
//    what triggers the OS permission dialog) and must not import uiohook at
//    all. There is no public, non-prompting Node API for the macOS
//    `CGPreflightListenEventAccess` check, so the default probe
//    conservatively reports "unknown" (mapped to `blocked`) until live smoke
//    establishes a better technique — it never optimistically claims
//    "granted" without positive evidence.
//
// Testability: pasteboard read/write, the ⌘C-synth outcome, the Input
// Monitoring probe, and the uiohook loader are all injectable seams (second
// `deps` argument, defaulting to the real `pbpaste`/`pbcopy`/uiohook-napi), so
// `macos.test.ts` exercises the ok/retryable/blocked branches and the
// pasteboard-restore behavior with fakes, without a real Mac or uiohook.
// Real ⌘C synth, real permission prompts, and real hotkey delivery are
// live-smoke (TESTING.md).

import { spawn } from "node:child_process";
import type { AdapterEnv, CaptureAdapter } from "../select.js";
import type { CaptureCapability, CaptureResult, HotkeyRegistration } from "../types.js";

const INPUT_MONITORING_PANE = "System Settings › Privacy & Security › Input Monitoring";

/** Exact wording pinned by the slice spec — capture()'s blocked remediation. */
const CAPTURE_BLOCKED_REMEDIATION = `Grant Gloss access in ${INPUT_MONITORING_PANE}.`;

/** Exact wording pinned by the slice spec — register()'s failure detail. */
const REGISTER_FAILURE_DETAIL = `Grant Input Monitoring (${INPUT_MONITORING_PANE}) — NOT Accessibility`;

/** The module specifier is deliberately NOT a string literal at the `import()`
 *  call site: TypeScript only attempts to resolve dynamic-import specifiers
 *  when they are literal expressions, so routing through this `const` keeps
 *  "uiohook-napi" (an optionalDependency with no bundled types) out of the
 *  type-checker entirely — no ambient module declaration needed, and no risk
 *  of colliding with one a sibling adapter slice might add. */
const UIOHOOK_SPECIFIER: string = "uiohook-napi";

interface UiohookKeyboardEvent {
  readonly keycode: number;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

/** The slice's own minimal view of uiohook-napi's surface — validated
 *  defensively at call sites rather than trusted structurally, since the real
 *  shape is unverified in this environment (live-smoke item). */
export interface UiohookModule {
  readonly uIOhook: {
    start(): void;
    stop(): void;
    on(event: "keydown", listener: (e: UiohookKeyboardEvent) => void): void;
    off?(event: "keydown", listener: (e: UiohookKeyboardEvent) => void): void;
    keyTap?(key: string, modifiers?: readonly string[]): void;
  };
  readonly UiohookKey?: Readonly<Record<string, number>>;
}

export type InputMonitoringStatus = "granted" | "denied" | "unknown";

export type KeySynthOutcome = { readonly ok: true } | { readonly ok: false; readonly detail: string };

/** Injectable seams for the macOS adapter. All default to the real OS
 *  mechanisms; `macos.test.ts` overrides them with fakes. */
export interface MacosAdapterDeps {
  readPasteboard(): Promise<string>;
  writePasteboard(text: string): Promise<void>;
  /** Synthesize ⌘C. Resolves `{ ok:false }` (never throws) on any failure —
   *  missing prebuild, denied permission, or an unrecognized module shape all
   *  collapse to the same macOS-specific outcome: a permission grant is the
   *  fix (§2.4 names Input Monitoring as the one gate for this mechanism). */
  synthCopy(): Promise<KeySynthOutcome>;
  /** Non-prompting Input Monitoring authorization check for `probe()`. */
  probeInputMonitoring(): Promise<InputMonitoringStatus>;
  /** Lazy-loads uiohook-napi. Shared by `register()` and the default
   *  `synthCopy()` — never called by `probe()`. */
  loadUiohook(): Promise<UiohookModule>;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function runCommand(cmd: string, args: readonly string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args as string[]);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
    if (input !== undefined) child.stdin?.end(input, "utf8");
    else child.stdin?.end();
  });
}

async function defaultReadPasteboard(): Promise<string> {
  return runCommand("pbpaste", []);
}

async function defaultWritePasteboard(text: string): Promise<void> {
  await runCommand("pbcopy", [], text);
}

async function loadUiohookModule(): Promise<UiohookModule> {
  const mod = (await import(UIOHOOK_SPECIFIER)) as Partial<UiohookModule>;
  if (!mod.uIOhook || typeof mod.uIOhook.start !== "function" || typeof mod.uIOhook.on !== "function") {
    throw new Error("uiohook-napi loaded but did not expose the expected uIOhook API");
  }
  return mod as UiohookModule;
}

function defaultSynthCopy(loadUiohook: () => Promise<UiohookModule>): () => Promise<KeySynthOutcome> {
  return async () => {
    try {
      const mod = await loadUiohook();
      if (typeof mod.uIOhook.keyTap !== "function") {
        return { ok: false, detail: "uiohook-napi has no keyTap synthesis API in this version." };
      }
      mod.uIOhook.keyTap("c", ["meta"]);
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: describeError(err) };
    }
  };
}

/** Conservative default: there is no public, non-prompting Node API for the
 *  macOS `CGPreflightListenEventAccess` check, so this never claims "granted"
 *  without positive evidence and never imports uiohook. Real status is a
 *  live-smoke item; `probe()` maps "unknown" to `blocked` (safe default). */
async function defaultProbeInputMonitoring(): Promise<InputMonitoringStatus> {
  return "unknown";
}

const DEFAULT_DEPS: MacosAdapterDeps = {
  readPasteboard: defaultReadPasteboard,
  writePasteboard: defaultWritePasteboard,
  synthCopy: defaultSynthCopy(loadUiohookModule),
  probeInputMonitoring: defaultProbeInputMonitoring,
  loadUiohook: loadUiohookModule
};

interface Accelerator {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly key: string;
}

/** Parses accelerators like "cmd+alt+j" / "ctrl+shift+g". Unrecognized tokens
 *  are treated as the trigger key (last one wins), mirroring how the other
 *  adapter slices are expected to parse the same accelerator strings. */
export function parseAccelerator(accelerator: string): Accelerator {
  const parts = accelerator
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  let ctrl = false;
  let alt = false;
  let meta = false;
  let shift = false;
  let key = "";
  for (const part of parts) {
    switch (part) {
      case "ctrl":
      case "control":
        ctrl = true;
        break;
      case "alt":
      case "option":
        alt = true;
        break;
      case "cmd":
      case "meta":
      case "command":
      case "super":
        meta = true;
        break;
      case "shift":
        shift = true;
        break;
      default:
        key = part.toUpperCase();
    }
  }
  return { ctrl, alt, meta, shift, key };
}

function matchesAccelerator(
  e: UiohookKeyboardEvent,
  combo: Accelerator,
  keyMap: Readonly<Record<string, number>> | undefined
): boolean {
  const targetCode = keyMap?.[combo.key];
  if (targetCode === undefined || e.keycode !== targetCode) return false;
  return (
    Boolean(e.ctrlKey) === combo.ctrl &&
    Boolean(e.altKey) === combo.alt &&
    Boolean(e.metaKey) === combo.meta &&
    Boolean(e.shiftKey) === combo.shift
  );
}

export function createMacosAdapter(_env: AdapterEnv, overrides: Partial<MacosAdapterDeps> = {}): CaptureAdapter {
  const deps: MacosAdapterDeps = { ...DEFAULT_DEPS, ...overrides };

  return {
    selection: {
      origin: "macos-pasteboard",

      probe: async (): Promise<CaptureCapability> => {
        const status = await deps.probeInputMonitoring();
        if (status === "granted") {
          return { support: "available", detail: "macOS pasteboard capture ready (Input Monitoring granted)." };
        }
        return {
          support: "blocked",
          detail:
            status === "denied"
              ? "Input Monitoring access is denied for Gloss."
              : "Input Monitoring authorization status is unknown; grant access before using the companion hotkey.",
          remediation: INPUT_MONITORING_PANE
        };
      },

      capture: async (): Promise<CaptureResult> => {
        const original = await deps.readPasteboard();
        const synth = await deps.synthCopy();
        if (!synth.ok) {
          return {
            status: "blocked",
            reason: "permission-denied",
            remediation: CAPTURE_BLOCKED_REMEDIATION,
            restartRequired: true
          };
        }

        let captured: string;
        try {
          captured = await deps.readPasteboard();
        } finally {
          // Always restore the user's real clipboard — the synthesized ⌘C
          // must be invisible, whether or not it found a real selection.
          await deps.writePasteboard(original);
        }

        if (captured.trim().length === 0 || captured === original) {
          return {
            status: "retryable",
            reason: "empty-selection",
            hint: "Select some text, then press the hotkey."
          };
        }
        return { status: "ok", text: captured };
      }
    },

    hotkey: {
      origin: "macos-uiohook",

      register: async (accelerator: string, onTrigger: () => void): Promise<HotkeyRegistration> => {
        let mod: UiohookModule;
        try {
          mod = await deps.loadUiohook();
        } catch (err) {
          return {
            ok: false,
            detail: `${REGISTER_FAILURE_DETAIL} (${describeError(err)})`,
            dispose: async () => undefined
          };
        }

        const combo = parseAccelerator(accelerator);
        const listener = (e: UiohookKeyboardEvent): void => {
          if (matchesAccelerator(e, combo, mod.UiohookKey)) onTrigger();
        };

        try {
          mod.uIOhook.on("keydown", listener);
          mod.uIOhook.start();
        } catch (err) {
          // .start() threw after .on(): tear down the listener AND stop the hook,
          // each in its own try so a throwing removal can't skip .stop()
          // (break-it round 2 F7).
          try {
            mod.uIOhook.off?.("keydown", listener);
          } catch {
            // best-effort
          }
          try {
            mod.uIOhook.stop();
          } catch {
            // best-effort
          }
          return {
            ok: false,
            detail: `${REGISTER_FAILURE_DETAIL} (${describeError(err)})`,
            dispose: async () => undefined
          };
        }

        return {
          ok: true,
          detail: "",
          dispose: async () => {
            try {
              mod.uIOhook.off?.("keydown", listener);
              mod.uIOhook.stop();
            } catch {
              // Best-effort teardown; the process is going away regardless.
            }
          }
        };
      }
    }
  };
}
