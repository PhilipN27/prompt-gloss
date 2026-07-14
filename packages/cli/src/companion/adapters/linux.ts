// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SLICE FILE — Phase D "@claude Linux adapter" (X11 + Wayland).              │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Linux capture (TERMINAL.md §2.4/§8.2). Detects X11 vs Wayland from `env.env`:
// `WAYLAND_DISPLAY` set → Wayland; else → X11.
//
//  X11 (`x11-primary`):
//   - Capture: X11 PRIMARY selection — highlighted text is already in PRIMARY
//     with NO keystroke. Read via `xclip -o -selection primary`, fallback
//     `xsel -p`. Highest-fidelity path of any OS. Both missing → unsupported.
//   - Hotkey: uiohook-napi keydown-chord match (XGrabKey-equivalent), lazily
//     imported inside `register()` — never at module top-level.
//
//  Wayland — HOTKEY-FIRST ordering (council-pinned, Codex 2026-07-14): a
//  capture mechanism with no hotkey to fire it is not a companion.
//   1. `register()` establishes a portal `GlobalShortcuts` session and BINDS
//      the accelerator. Capability = the returned bindings actually CONTAIN
//      our shortcut id — a subset/empty binding does NOT count as bound.
//   2. Bound → prefer functional background PRIMARY: a BOUNDED probe
//      (`wl-paste --primary --watch /bin/true` staying alive past its
//      handshake proves background selection access; exiting proves missing
//      support). Never inferred from `WAYLAND_DISPLAY` / desktop name /
//      `wl-paste` executable presence alone.
//   3. Else → clipboard freshness / copy-then-hotkey, reusing the pure
//      `../freshness.js` predicate (same as Windows).
//   4. Hotkey can't bind → `unsupported`, regardless of clipboard capability.
//
//  `probe()` (both OSes) is NON-PROMPTING and reports rich, separate facts for
//  `doctor`. On Wayland the actual portal bind/authorization happens only in
//  `register()` (which the companion daemon calls once at startup — that is
//  where a real desktop shortcut-authorization prompt, if any, occurs);
//  `probe()` only checks whether the portal INTERFACE is advertised (a
//  `Properties.Get` D-Bus call — no session, no dialog) unless a prior
//  `register()` on this same adapter instance already produced a real,
//  cached bind result, in which case `probe()` reports that cached fact
//  instead of re-attempting anything.
//
// TESTABILITY: every shell-out (xclip/xsel/wl-paste), the bounded background
// probe, the portal bind/advertise/watch calls, and the uiohook loader are
// injectable via `LinuxAdapterDeps` (second, optional argument to
// `createLinuxAdapter`, defaulting to the real implementations below). Tests
// exercise the full decision tree with fakes only — no real X11/Wayland/
// uiohook/D-Bus. Real capture (xclip/xsel/wl-paste/portal/uiohook) is a
// LIVE-SMOKE item (TESTING.md); the gdbus-based portal implementation in
// particular is a best-effort shell-out (no new npm dependency, §8.1) whose
// wire-level fidelity is verified by a human on a real Wayland session, not
// by CI — it fails closed (never bound) on any parse/timeout/missing-gdbus
// condition, which is the safe default per the hotkey-first ordering above.

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AdapterEnv, CaptureAdapter } from "../select.js";
import type {
  CaptureCapability,
  CaptureResult,
  CaptureSupport,
  HotkeyRegistrar,
  HotkeyRegistration,
  SelectionSource
} from "../types.js";
import { armFreshness, assessFreshness, type FreshnessState } from "../freshness.js";

// `uiohook-napi` is an optionalDependency (§8.1): its native prebuild may be
// entirely absent from `node_modules` (as it is in a plain `pnpm install` on
// an unsupported platform, or in this dev worktree), which leaves no type
// declarations for `tsc` to resolve — even though the import is dynamic and
// lazy (never at module top-level, never evaluated unless `register()`
// actually runs). Widening the specifier to `string` (rather than a literal)
// makes `import()` type as `Promise<any>` instead of requiring `tsc` to
// resolve real declaration files, so compilation never depends on the
// prebuild being present; the real exports are reshaped into `UiohookModule`
// via the cast in `defaultLoadUiohook`.
const UIOHOOK_MODULE_SPECIFIER: string = "uiohook-napi";

// ---------------------------------------------------------------------------
// Injectable seams — real implementations by default (`createDefaultLinuxDeps`).
// ---------------------------------------------------------------------------

/** Outcome of running a command to completion. `"not-found"` is specifically
 *  "the binary isn't on PATH" (ENOENT) — distinct from `"error"` (the binary
 *  ran and exited non-zero), so callers can tell "not installed" from "ran and
 *  said no" (e.g. xclip against an empty PRIMARY). */
export interface CommandResult {
  readonly kind: "ok" | "not-found" | "error";
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export type RunCommand = (
  cmd: string,
  args: readonly string[],
  opts?: { readonly timeoutMs?: number }
) => Promise<CommandResult>;

/** Spawns `cmd args`, waits up to `timeoutMs`, and reports whether the
 *  process was still alive at that point (proving it passed whatever startup
 *  handshake it needed) or had already exited (proving it didn't). Always
 *  kills the process before resolving `staysAlive: true`. */
export type BoundedWatch = (
  cmd: string,
  args: readonly string[],
  timeoutMs: number
) => Promise<{ readonly staysAlive: boolean }>;

export interface PortalBindResult {
  /** The shortcut ids the portal actually confirmed bound. A subset/empty
   *  array (relative to what we asked for) does NOT count as bound. */
  readonly boundShortcutIds: readonly string[];
  readonly detail: string;
}

/** PROMPTING: creates a `GlobalShortcuts` portal session and attempts to bind
 *  `accelerator` under `shortcutId`/`description`. This is where a real
 *  compositor authorization dialog (if any) happens — never called from
 *  `probe()`. */
export type PortalBind = (
  accelerator: string,
  shortcutId: string,
  description: string
) => Promise<PortalBindResult>;

/** Non-prompting: is `org.freedesktop.portal.GlobalShortcuts` advertised on
 *  the session bus? Interface presence only — no session, no dialog. */
export type PortalCheckAdvertised = () => Promise<boolean>;

export interface PortalWatchHandle {
  /** false → watching could not start; the caller must treat the hotkey as
   *  unusable even if the bind itself nominally succeeded. */
  readonly ok: boolean;
  dispose(): Promise<void>;
}

/** Starts watching for `Activated` signals for a previously bound shortcut;
 *  invokes `onTrigger` on each matching activation. */
export type PortalWatch = (shortcutId: string, onTrigger: () => void) => Promise<PortalWatchHandle>;

interface UiohookKeyEvent {
  readonly keycode: number;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
}

interface UiohookModule {
  readonly uIOhook: {
    start(): void;
    stop(): void;
    on(event: "keydown", listener: (e: UiohookKeyEvent) => void): void;
    removeListener?(event: "keydown", listener: (e: UiohookKeyEvent) => void): void;
  };
  readonly UiohookKey: Record<string, number>;
}

export type UiohookLoader = () => Promise<UiohookModule>;

export interface LinuxAdapterDeps {
  readonly run: RunCommand;
  readonly boundedWatch: BoundedWatch;
  readonly portalBind: PortalBind;
  readonly portalCheckAdvertised: PortalCheckAdvertised;
  readonly portalWatch: PortalWatch;
  readonly loadUiohook: UiohookLoader;
  readonly now: () => number;
}

// --- real implementations ---------------------------------------------------

const defaultRun: RunCommand = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(cmd, [...args], { timeout: opts.timeoutMs ?? 3000, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const err = error as NodeJS.ErrnoException & { code?: string | number };
        if (err.code === "ENOENT") {
          resolve({ kind: "not-found", stdout: "", stderr: "", exitCode: null });
          return;
        }
        resolve({
          kind: "error",
          stdout: stdout ?? "",
          stderr: stderr ?? String(err.message ?? err),
          exitCode: typeof err.code === "number" ? err.code : null
        });
        return;
      }
      resolve({ kind: "ok", stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
    });
  });

const defaultBoundedWatch: BoundedWatch = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const child = spawn(cmd, [...args], { stdio: "ignore" });
    const finish = (staysAlive: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ staysAlive });
    };
    child.once("error", () => finish(false));
    child.once("exit", () => finish(false));
    setTimeout(() => {
      if (settled) return;
      finish(true);
      try {
        child.kill();
      } catch {
        // best-effort
      }
    }, timeoutMs);
  });

const defaultLoadUiohook: UiohookLoader = async () => {
  const mod = await import(UIOHOOK_MODULE_SPECIFIER);
  return mod as unknown as UiohookModule;
};

// --- gdbus-based portal plumbing (best-effort; see file header) ------------

const PORTAL_BUS_NAME = "org.freedesktop.portal.Desktop";
const PORTAL_OBJECT_PATH = "/org/freedesktop/portal/desktop";
const GLOBAL_SHORTCUTS_IFACE = "org.freedesktop.portal.GlobalShortcuts";
const PORTAL_CALL_TIMEOUT_MS = 3000;
const PORTAL_SESSION_RESPONSE_TIMEOUT_MS = 4000;
/** Generous: BindShortcuts commonly needs a human to approve a system
 *  authorization dialog on first use, unlike the cheap protocol handshake. */
const PORTAL_BIND_RESPONSE_TIMEOUT_MS = 60_000;

function sanitizeToken(raw: string): string {
  return `gloss_${raw.replace(/[^a-zA-Z0-9_]/g, "")}`;
}

function execGdbus(args: readonly string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile("gdbus", [...args], { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => {
      resolve({ ok: !error, stdout: stdout ?? "" });
    });
  });
}

function extractObjectPath(text: string): string | null {
  const match = text.match(/objectpath '([^']+)'/);
  return match?.[1] ?? null;
}

function extractSessionHandle(text: string): string | null {
  const match = text.match(/'session_handle': <'([^']+)'>/);
  return match?.[1] ?? null;
}

/** Bounded `gdbus monitor` scan for a `Response` signal mentioning
 *  `requestPath`. Best-effort text-format scanning, not a real D-Bus client —
 *  see file header. */
function monitorPortalResponse(requestPath: string, budgetMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const child = spawn("gdbus", ["monitor", "--session", "--dest", PORTAL_BUS_NAME], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      // Clear the (possibly 60s) budget timer on early resolution — otherwise a
      // ref'd timer keeps the CLI process alive after the companion degrades
      // (break-it F8). `timer` is always assigned before any child event fires.
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // best-effort
      }
      resolve(value);
    };
    child.once("error", () => finish(null));
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (out.includes(requestPath) && out.includes("Response")) {
        finish(out);
      }
    });
    const timer = setTimeout(() => finish(out.includes(requestPath) ? out : null), budgetMs);
  });
}

async function realPortalCheckAdvertised(): Promise<boolean> {
  const result = await execGdbus(
    [
      "call",
      "--session",
      "--dest",
      PORTAL_BUS_NAME,
      "--object-path",
      PORTAL_OBJECT_PATH,
      "--method",
      "org.freedesktop.DBus.Properties.Get",
      GLOBAL_SHORTCUTS_IFACE,
      "version"
    ],
    PORTAL_CALL_TIMEOUT_MS
  );
  return result.ok;
}

const realPortalBind: PortalBind = async (accelerator, shortcutId, description) => {
  try {
    const sessionToken = sanitizeToken(randomUUID());
    const createHandleToken = sanitizeToken(randomUUID());
    const createResult = await execGdbus(
      [
        "call",
        "--session",
        "--dest",
        PORTAL_BUS_NAME,
        "--object-path",
        PORTAL_OBJECT_PATH,
        "--method",
        `${GLOBAL_SHORTCUTS_IFACE}.CreateSession`,
        `{'handle_token': <'${createHandleToken}'>, 'session_handle_token': <'${sessionToken}'>}`
      ],
      PORTAL_CALL_TIMEOUT_MS
    );
    if (!createResult.ok) {
      return {
        boundShortcutIds: [],
        detail: "The GlobalShortcuts portal did not respond to CreateSession (backend missing, or gdbus unavailable)."
      };
    }
    const createRequestPath = extractObjectPath(createResult.stdout);
    if (!createRequestPath) {
      return { boundShortcutIds: [], detail: "CreateSession returned an unexpected reply; could not parse the request handle." };
    }
    const createResponse = await monitorPortalResponse(createRequestPath, PORTAL_SESSION_RESPONSE_TIMEOUT_MS);
    const sessionHandle = createResponse ? extractSessionHandle(createResponse) : null;
    if (!sessionHandle) {
      return { boundShortcutIds: [], detail: "The portal did not confirm a GlobalShortcuts session within the probe window." };
    }

    const bindHandleToken = sanitizeToken(randomUUID());
    const shortcutsArg = `[('${shortcutId}', {'description': <'${description}'>, 'preferred_trigger': <'${accelerator}'>})]`;
    const bindResult = await execGdbus(
      [
        "call",
        "--session",
        "--dest",
        PORTAL_BUS_NAME,
        "--object-path",
        PORTAL_OBJECT_PATH,
        "--method",
        `${GLOBAL_SHORTCUTS_IFACE}.BindShortcuts`,
        `objectpath '${sessionHandle}'`,
        shortcutsArg,
        "''",
        `{'handle_token': <'${bindHandleToken}'>}`
      ],
      PORTAL_CALL_TIMEOUT_MS
    );
    if (!bindResult.ok) {
      return { boundShortcutIds: [], detail: "BindShortcuts call failed; the portal or compositor rejected the request." };
    }
    const bindRequestPath = extractObjectPath(bindResult.stdout);
    if (!bindRequestPath) {
      return { boundShortcutIds: [], detail: "BindShortcuts returned an unexpected reply; could not parse the request handle." };
    }
    const bindResponse = await monitorPortalResponse(bindRequestPath, PORTAL_BIND_RESPONSE_TIMEOUT_MS);
    if (!bindResponse) {
      return {
        boundShortcutIds: [],
        detail: "The portal did not confirm any bound shortcuts (declined, or no response within the authorization window)."
      };
    }
    const bound = bindResponse.includes(`'${shortcutId}'`);
    return {
      boundShortcutIds: bound ? [shortcutId] : [],
      detail: bound
        ? `The portal confirmed ${accelerator} bound to "${shortcutId}".`
        : `The portal responded but "${shortcutId}" was not among the bound shortcuts (declined or reassigned).`
    };
  } catch (err) {
    return {
      boundShortcutIds: [],
      detail: `Portal GlobalShortcuts bind attempt failed: ${err instanceof Error ? err.message : String(err)}.`
    };
  }
};

const realPortalWatch: PortalWatch = async (shortcutId, onTrigger) => {
  const child = spawn("gdbus", ["monitor", "--session", "--dest", PORTAL_BUS_NAME], {
    stdio: ["ignore", "pipe", "ignore"]
  });
  const failedToStart = await new Promise<boolean>((resolve) => {
    let settled = false;
    child.once("error", () => {
      if (!settled) {
        settled = true;
        resolve(true);
      }
    });
    child.once("spawn", () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
  });
  if (failedToStart) {
    return { ok: false, dispose: async () => undefined };
  }
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.includes("Activated") && line.includes(`'${shortcutId}'`)) {
        onTrigger();
      }
    }
  });
  let disposed = false;
  return {
    ok: true,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      try {
        child.kill();
      } catch {
        // best-effort
      }
    }
  };
};

export function createDefaultLinuxDeps(): LinuxAdapterDeps {
  return {
    run: defaultRun,
    boundedWatch: defaultBoundedWatch,
    portalBind: realPortalBind,
    portalCheckAdvertised: realPortalCheckAdvertised,
    portalWatch: realPortalWatch,
    loadUiohook: defaultLoadUiohook,
    now: () => Date.now()
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function createLinuxAdapter(env: AdapterEnv, deps: LinuxAdapterDeps = createDefaultLinuxDeps()): CaptureAdapter {
  return env.env.WAYLAND_DISPLAY ? createWaylandAdapter(deps) : createX11Adapter(deps);
}

// ---------------------------------------------------------------------------
// Shared: accelerator parsing + a uiohook keydown-chord HotkeyRegistrar
// (used by X11; Wayland binds its hotkey through the portal instead).
// ---------------------------------------------------------------------------

interface ParsedAccelerator {
  readonly keyName: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

function parseAccelerator(accelerator: string): ParsedAccelerator {
  const parts = accelerator
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let keyName = "";
  for (const part of parts) {
    if (part === "ctrl" || part === "control") ctrl = true;
    else if (part === "alt") alt = true;
    else if (part === "shift") shift = true;
    else if (part === "cmd" || part === "meta" || part === "super" || part === "win") meta = true;
    else keyName = part;
  }
  return { keyName, ctrl, alt, shift, meta };
}

function keycodeForName(uiohookKey: Record<string, number>, keyName: string): number | undefined {
  const name = keyName.length === 1 ? keyName.toUpperCase() : keyName.charAt(0).toUpperCase() + keyName.slice(1);
  return uiohookKey[name] ?? uiohookKey[keyName.toUpperCase()];
}

function createUiohookHotkeyRegistrar(origin: string, loadUiohook: UiohookLoader): HotkeyRegistrar {
  return {
    origin,
    register: async (accelerator, onTrigger): Promise<HotkeyRegistration> => {
      let mod: UiohookModule;
      try {
        mod = await loadUiohook();
      } catch (err) {
        return {
          ok: false,
          detail: `uiohook-napi prebuild unavailable — see \`prompt-gloss doctor\` (${err instanceof Error ? err.message : String(err)}).`,
          dispose: async () => undefined
        };
      }
      const { uIOhook, UiohookKey } = mod;
      const parsed = parseAccelerator(accelerator);
      const keycode = keycodeForName(UiohookKey, parsed.keyName);
      if (keycode === undefined) {
        return {
          ok: false,
          detail: `Unrecognized accelerator key "${parsed.keyName}" in "${accelerator}".`,
          dispose: async () => undefined
        };
      }
      const listener = (e: UiohookKeyEvent) => {
        if (
          e.keycode === keycode &&
          Boolean(e.ctrlKey) === parsed.ctrl &&
          Boolean(e.altKey) === parsed.alt &&
          Boolean(e.shiftKey) === parsed.shift &&
          Boolean(e.metaKey) === parsed.meta
        ) {
          onTrigger();
        }
      };
      try {
        uIOhook.on("keydown", listener);
        uIOhook.start();
      } catch (err) {
        // .start() threw after .on(): remove the listener AND stop the hook,
        // each in its own try so a throwing removal can't skip .stop()
        // (break-it round 2 F7).
        try {
          uIOhook.removeListener?.("keydown", listener);
        } catch {
          // best-effort
        }
        try {
          uIOhook.stop();
        } catch {
          // best-effort
        }
        return {
          ok: false,
          detail: `Failed to start the X11 key listener: ${err instanceof Error ? err.message : String(err)}.`,
          dispose: async () => undefined
        };
      }
      return {
        ok: true,
        detail: `Listening for ${accelerator} via XGrabKey (uiohook-napi).`,
        dispose: async () => {
          try {
            uIOhook.removeListener?.("keydown", listener);
            uIOhook.stop();
          } catch {
            // best-effort
          }
        }
      };
    }
  };
}

// ---------------------------------------------------------------------------
// X11 — SelectionSource "x11-primary"
// ---------------------------------------------------------------------------

type PrimaryTool = "xclip" | "xsel";

async function pickPrimaryTool(run: RunCommand): Promise<PrimaryTool | null> {
  const xclip = await run("xclip", ["-version"], { timeoutMs: 1500 });
  if (xclip.kind !== "not-found") return "xclip";
  const xsel = await run("xsel", ["--version"], { timeoutMs: 1500 });
  if (xsel.kind !== "not-found") return "xsel";
  return null;
}

async function readPrimarySelection(run: RunCommand, tool: PrimaryTool): Promise<string> {
  const result =
    tool === "xclip"
      ? await run("xclip", ["-o", "-selection", "primary"], { timeoutMs: 2000 })
      : await run("xsel", ["-p"], { timeoutMs: 2000 });
  return result.kind === "not-found" ? "" : result.stdout;
}

function createX11Selection(deps: LinuxAdapterDeps): SelectionSource {
  return {
    origin: "x11-primary",
    probe: async (): Promise<CaptureCapability> => {
      const tool = await pickPrimaryTool(deps.run);
      if (!tool) {
        return {
          support: "unsupported",
          detail: "Neither xclip nor xsel is installed; X11 PRIMARY selection can't be read.",
          remediation: "install xclip or xsel (e.g. `sudo apt install xclip`)"
        };
      }
      return { support: "available", detail: "X11 PRIMARY selection" };
    },
    capture: async (): Promise<CaptureResult> => {
      const tool = await pickPrimaryTool(deps.run);
      if (!tool) {
        return { status: "unsupported", reason: "xclip/xsel not installed", fallback: "cli" };
      }
      const text = await readPrimarySelection(deps.run, tool);
      if (text.trim().length === 0) {
        return {
          status: "retryable",
          reason: "empty-selection",
          hint: "Select text first, then press the hotkey."
        };
      }
      return { status: "ok", text };
    }
  };
}

function createX11Adapter(deps: LinuxAdapterDeps): CaptureAdapter {
  return {
    selection: createX11Selection(deps),
    hotkey: createUiohookHotkeyRegistrar("x11-uiohook", deps.loadUiohook)
  };
}

// ---------------------------------------------------------------------------
// Wayland — SelectionSource "wayland-primary" + HotkeyRegistrar "wayland-portal"
// ---------------------------------------------------------------------------

/** The one shortcut Gloss ever asks the portal to bind. */
export const GLOSS_SHORTCUT_ID = "gloss-capture";
const GLOSS_SHORTCUT_DESCRIPTION = "Gloss: capture selection";
/** Bounded window for the background-PRIMARY handshake probe (§8.2). */
const WAYLAND_PRIMARY_PROBE_MS = 600;

interface WaylandBindOutcome {
  readonly bound: boolean;
  readonly boundShortcutIds: readonly string[];
  readonly detail: string;
}

interface WaylandPrimarySupport {
  readonly supported: boolean;
  readonly detail: string;
}

/** State shared between the selection source and the hotkey registrar
 *  returned by ONE `createWaylandAdapter` call — they are "one unit"
 *  (select.ts): capture-time behavior must reflect what `register()` actually
 *  achieved, not a fresh re-attempt on every hotkey press. */
interface WaylandSharedState {
  bindOutcome?: WaylandBindOutcome | undefined;
  primarySupport?: WaylandPrimarySupport | undefined;
  freshness?: FreshnessState | undefined;
  freshnessReady?: Promise<void> | undefined;
}

type HotkeyFactStatus = "bound" | "advertised-but-unverified" | "unavailable";
interface HotkeyFact {
  readonly status: HotkeyFactStatus;
  readonly detail: string;
}

type PrimaryFactStatus = "functional" | "empty-but-supported" | "unavailable";
interface PrimaryFact {
  readonly status: PrimaryFactStatus;
  readonly detail: string;
}

interface EffectiveRung {
  readonly support: CaptureSupport;
  readonly label: string;
  readonly fix: string;
}

async function getPrimarySupport(deps: LinuxAdapterDeps, state: WaylandSharedState): Promise<WaylandPrimarySupport> {
  if (!state.primarySupport) {
    const watch = await deps.boundedWatch("wl-paste", ["--primary", "--watch", "/bin/true"], WAYLAND_PRIMARY_PROBE_MS);
    state.primarySupport = watch.staysAlive
      ? {
          supported: true,
          detail: "background PRIMARY reads are supported (wl-paste --primary --watch stayed alive past its handshake)"
        }
      : {
          supported: false,
          detail: "wl-paste --primary is unavailable (missing binary, or the compositor lacks the primary-selection data-control protocol)"
        };
  }
  return state.primarySupport;
}

async function readPrimaryOnce(deps: LinuxAdapterDeps): Promise<string> {
  const read = await deps.run("wl-paste", ["--primary", "--no-newline"], { timeoutMs: 1500 });
  return read.kind === "ok" ? read.stdout : "";
}

async function describePrimaryForDoctor(deps: LinuxAdapterDeps, state: WaylandSharedState): Promise<PrimaryFact> {
  const support = await getPrimarySupport(deps, state);
  if (!support.supported) {
    return { status: "unavailable", detail: support.detail };
  }
  const text = await readPrimaryOnce(deps);
  return text.trim().length > 0
    ? { status: "functional", detail: "PRIMARY has a selection right now" }
    : { status: "empty-but-supported", detail: "background PRIMARY reads work; nothing is selected right now" };
}

async function describeClipboardFallback(deps: LinuxAdapterDeps): Promise<{ available: boolean; detail: string }> {
  const result = await deps.run("wl-paste", ["--version"], { timeoutMs: 1500 });
  return result.kind === "not-found"
    ? { available: false, detail: "wl-paste (wl-clipboard) is not installed" }
    : { available: true, detail: "wl-paste is installed" };
}

async function describeHotkeyFact(deps: LinuxAdapterDeps, state: WaylandSharedState): Promise<HotkeyFact> {
  // Reuse a cached REAL bind outcome from a prior register() call on this same
  // adapter instance — reporting a known fact is non-prompting even though
  // establishing it originally was not.
  if (state.bindOutcome) {
    return state.bindOutcome.bound
      ? { status: "bound", detail: state.bindOutcome.detail }
      : { status: "unavailable", detail: state.bindOutcome.detail };
  }
  const advertised = await deps.portalCheckAdvertised();
  return advertised
    ? {
        status: "advertised-but-unverified",
        detail: "org.freedesktop.portal.GlobalShortcuts is advertised on the session bus; not yet bound"
      }
    : {
        status: "unavailable",
        detail: "org.freedesktop.portal.GlobalShortcuts is not advertised (no compatible portal backend for this compositor)"
      };
}

function computeEffectiveRung(hotkey: HotkeyFact, primary: PrimaryFact, clipboard: { available: boolean }): EffectiveRung {
  if (hotkey.status === "unavailable") {
    return {
      support: "unsupported",
      label: "unsupported (no bindable global shortcut)",
      fix: "install/enable a GlobalShortcuts portal backend for your compositor (xdg-desktop-portal-gnome ≥48, xdg-desktop-portal-kde ≥6.3, or xdg-desktop-portal-wlr/-hyprland), or use `prompt-gloss add`"
    };
  }
  const primaryOk = primary.status !== "unavailable";
  if (hotkey.status === "bound") {
    if (primaryOk) {
      return { support: "available", label: "companion (PRIMARY, no keystroke)", fix: "none" };
    }
    if (clipboard.available) {
      return {
        support: "available",
        label: "companion (copy-then-hotkey)",
        fix: "install wl-clipboard's PRIMARY support for a no-copy capture (optional)"
      };
    }
    return {
      support: "unsupported",
      label: "unsupported (no read mechanism)",
      fix: "install wl-clipboard (`wl-paste`), or use `prompt-gloss add`"
    };
  }
  // advertised-but-unverified: optimistic — the real bind is confirmed when
  // the companion daemon starts and calls register().
  if (primaryOk || clipboard.available) {
    return {
      support: "available",
      label: primaryOk
        ? "companion (PRIMARY expected, pending shortcut authorization)"
        : "companion (copy-then-hotkey expected, pending shortcut authorization)",
      fix: "run `prompt-gloss companion` and authorize the shortcut when your desktop prompts"
    };
  }
  return {
    support: "unsupported",
    label: "unsupported (no read mechanism once bound)",
    fix: "install wl-clipboard (`wl-paste`), or use `prompt-gloss add`"
  };
}

/** Arms the clipboard-freshness baseline exactly once per adapter instance, on
 *  the first clipboard-fallback capture (NOT at construction — break-it F6, so
 *  `doctor`/`selectAdapter` stay side-effect-free). The first fallback capture
 *  thus arms from the then-current clipboard; a subsequent copy-then-hotkey
 *  reads as "changed". */
function armFreshnessOnce(deps: LinuxAdapterDeps, state: WaylandSharedState): Promise<void> {
  state.freshnessReady ??= (async () => {
    const read = await deps.run("wl-paste", ["--no-newline"], { timeoutMs: 1500 });
    state.freshness = armFreshness(read.kind === "ok" ? read.stdout : "");
  })();
  return state.freshnessReady;
}

async function captureViaClipboardFreshness(deps: LinuxAdapterDeps, state: WaylandSharedState): Promise<CaptureResult> {
  await armFreshnessOnce(deps, state);
  const read = await deps.run("wl-paste", ["--no-newline"], { timeoutMs: 1500 });
  const text = read.kind === "ok" ? read.stdout : "";
  const baseline = state.freshness ?? armFreshness("");
  const decision = assessFreshness(baseline, { identity: text, text }, deps.now());
  state.freshness = decision.next;
  if (!decision.accept) {
    return {
      status: "retryable",
      reason: decision.reason === "empty" ? "empty-selection" : "stale-clipboard",
      hint:
        decision.reason === "empty"
          ? "Select text first, then copy it, then press the hotkey."
          : "Copy your selection first, then press the hotkey again."
    };
  }
  return { status: "ok", text };
}

function createWaylandAdapter(deps: LinuxAdapterDeps): CaptureAdapter {
  // Construction is side-effect-free (break-it F6): the freshness baseline is
  // armed lazily on the first clipboard-fallback capture (armFreshnessOnce in
  // captureViaClipboardFreshness), NOT eagerly here — so merely selecting the
  // adapter (e.g. `doctor`) never spawns wl-paste.
  const state: WaylandSharedState = {};

  const selection: SelectionSource = {
    origin: "wayland-primary",
    probe: async (): Promise<CaptureCapability> => {
      const hotkey = await describeHotkeyFact(deps, state);
      const primary = await describePrimaryForDoctor(deps, state);
      const clipboard = await describeClipboardFallback(deps);
      const rung = computeEffectiveRung(hotkey, primary, clipboard);
      const detail = [
        "session: wayland",
        `global-hotkey: ${hotkey.status} — ${hotkey.detail}`,
        `PRIMARY: ${primary.status} — ${primary.detail}`,
        `clipboard-fallback: ${clipboard.available ? "available" : "unavailable"} — ${clipboard.detail}`,
        `effective rung: ${rung.label}`,
        `fix: ${rung.fix}`
      ].join(" | ");
      return rung.support === "unsupported"
        ? { support: "unsupported", detail, remediation: rung.fix }
        : { support: rung.support, detail };
    },
    capture: async (): Promise<CaptureResult> => {
      if (!state.bindOutcome?.bound) {
        return {
          status: "unsupported",
          reason:
            "The Wayland global shortcut is not bound (no portal GlobalShortcuts backend, or the authorization was declined); a capture mechanism with no trigger is not usable.",
          fallback: "cli"
        };
      }
      const support = await getPrimarySupport(deps, state);
      if (support.supported) {
        const text = await readPrimaryOnce(deps);
        if (text.trim().length === 0) {
          return {
            status: "retryable",
            reason: "empty-selection",
            hint: "Select text first, then press the hotkey."
          };
        }
        return { status: "ok", text };
      }
      return captureViaClipboardFreshness(deps, state);
    }
  };

  const hotkey: HotkeyRegistrar = {
    origin: "wayland-portal",
    register: async (accelerator, onTrigger): Promise<HotkeyRegistration> => {
      const bind = await deps.portalBind(accelerator, GLOSS_SHORTCUT_ID, GLOSS_SHORTCUT_DESCRIPTION);
      const bound = bind.boundShortcutIds.includes(GLOSS_SHORTCUT_ID);
      if (!bound) {
        state.bindOutcome = { bound: false, boundShortcutIds: bind.boundShortcutIds, detail: bind.detail };
        return {
          ok: false,
          detail: `Wayland portal did not bind ${accelerator}: ${bind.detail}`,
          dispose: async () => undefined
        };
      }
      const watch = await deps.portalWatch(GLOSS_SHORTCUT_ID, onTrigger);
      if (!watch.ok) {
        state.bindOutcome = {
          bound: false,
          boundShortcutIds: bind.boundShortcutIds,
          detail: "The portal bound the shortcut but the activation watcher failed to start."
        };
        return {
          ok: false,
          detail: "Wayland portal bound the shortcut but the activation watcher failed to start.",
          dispose: async () => undefined
        };
      }
      state.bindOutcome = { bound: true, boundShortcutIds: bind.boundShortcutIds, detail: bind.detail };
      return {
        ok: true,
        detail: `Wayland global shortcut ${accelerator} bound via the portal; watching for activation.`,
        dispose: async () => {
          state.bindOutcome = undefined;
          await watch.dispose();
        }
      };
    }
  };

  return { selection, hotkey };
}
