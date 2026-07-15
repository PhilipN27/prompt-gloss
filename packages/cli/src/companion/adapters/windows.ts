// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SLICE FILE — Phase D "@claude Windows adapter". Owned by this slice only. │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Windows capture (TERMINAL.md §2.4/§8.2):
//  - Capture: read the clipboard (shell out to PowerShell's `Get-Clipboard`,
//    no new dependency) and gate it through `assessFreshness` (../freshness.js)
//    with per-adapter closure state, armed via `armFreshness` at adapter
//    creation. NEVER synthesize Ctrl+C — on Windows that's SIGINT to the
//    running terminal program (§2.4).
//  - probe(): reports "available" (the mechanism itself needs nothing beyond
//    PowerShell) even with an empty clipboard; non-prompting; must not
//    require uiohook.
//  - Hotkey: Win32-visible global hotkey via `uiohook-napi` (optionalDependency).
//    Lazily, dynamically imported ONLY inside `register()` — never at module
//    top level — so `doctor`'s probe and a plain CI import of this file never
//    need the native prebuild. Import/registration failure degrades to
//    `{ ok:false, detail }`, never a thrown exception.
//
// Testability: the clipboard reader, the freshness clock, and the initial
// freshness baseline are all injectable via the second `deps` parameter,
// defaulting to the real PowerShell-backed implementations. `select.ts` (the
// integrator-owned registry) calls `createWindowsAdapter(env)` with a single
// argument, which still works — the second parameter is optional. Real
// PowerShell capture and the real uiohook hotkey are live-smoke items
// (TESTING.md); `parseAccelerator` and the freshness-gated `capture()` branches
// are unit-tested in `test/companion/windows.test.ts`.

import { spawnSync } from "node:child_process";

import { armFreshness, assessFreshness, type FreshnessState } from "../freshness.js";
import type { AdapterEnv, CaptureAdapter } from "../select.js";
import type { CaptureCapability, CaptureResult, HotkeyRegistration } from "../types.js";

const DOCTOR_HINT = "uiohook-napi prebuild unavailable — run `prompt-gloss doctor`";

const EMPTY_HINT = "Select and copy text first (Ctrl+Shift+C in Windows Terminal), then press the hotkey.";
const STALE_HINT = "Copy your selection first (Ctrl+Shift+C in Windows Terminal), then press the hotkey again.";

// ---------------------------------------------------------------------------
// Clipboard reader (real implementation: shells out to PowerShell).
// ---------------------------------------------------------------------------

/** Strips the single trailing newline PowerShell's console formatting adds;
 *  preserves any internal whitespace/newlines the real selection carried. */
function stripTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, "");
}

/** Synchronous clipboard read via `Get-Clipboard`. Used both by the async
 *  `readClipboard` seam's default implementation and to arm the freshness
 *  baseline at adapter-construction time (which must happen synchronously,
 *  since `createWindowsAdapter` itself is not async). `Get-Clipboard` throws
 *  when the clipboard holds no text-compatible format (empty, an image, a
 *  file-drop list, …) — that is treated as an empty clipboard, not a hard
 *  failure, so a non-text clipboard degrades to the normal "empty" retry hint
 *  instead of crashing the companion. */
function readClipboardViaPowerShell(): string {
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard"], {
      encoding: "utf8",
      // Bound the read: a stalled clipboard provider must never hang the caller
      // (e.g. `prompt-gloss doctor`, which constructs the adapter) — break-it F6.
      timeout: 1500
    });
    if (result.error || result.status !== 0) return "";
    return stripTrailingNewline(result.stdout ?? "");
  } catch {
    return "";
  }
}

function defaultReadClipboard(): Promise<string> {
  return Promise.resolve(readClipboardViaPowerShell());
}

// ---------------------------------------------------------------------------
// Injectable seams (TESTING.md boundary rule): production defaults to the
// real PowerShell clipboard + wall clock; tests supply fakes + constructed
// `FreshnessState`s so `capture()` is exercised without ever shelling out.
// ---------------------------------------------------------------------------

export interface WindowsAdapterDeps {
  /** Reads the current clipboard text on each `capture()`. Default: shells
   *  out to `powershell -NoProfile -Command Get-Clipboard`. */
  readonly readClipboard: () => Promise<string>;
  /** Clock for freshness gating (`../freshness.js` expects monotonic ms).
   *  Default: `Date.now`. */
  readonly now: () => number;
  /** Freshness baseline to arm with, `armFreshness(identity)`-shaped. Default:
   *  reads the real clipboard synchronously at construction time and arms
   *  from it (TERMINAL.md §8.2). Tests pass an explicit `FreshnessState` (via
   *  `armFreshness(...)` from `../freshness.js`) for deterministic scenarios —
   *  and MUST do so whenever they also override `readClipboard`, since the
   *  default arm otherwise still shells out to the real clipboard. */
  readonly initialState: FreshnessState;
}

export function createWindowsAdapter(
  _env: AdapterEnv,
  deps: Partial<WindowsAdapterDeps> = {}
): CaptureAdapter {
  const readClipboard = deps.readClipboard ?? defaultReadClipboard;
  const now = deps.now ?? (() => Date.now());
  // Arm the baseline at adapter creation (not at first capture): a copy made
  // between daemon start and the first hotkey press must read as "changed",
  // which requires the pre-copy clipboard to already be the recorded baseline.
  let state: FreshnessState = deps.initialState ?? armFreshness(readClipboardViaPowerShell());

  return {
    selection: {
      origin: "windows-clipboard",
      probe: async (): Promise<CaptureCapability> => ({
        support: "available",
        detail: "Windows clipboard capture (copy-then-hotkey)"
      }),
      capture: async (): Promise<CaptureResult> => {
        const text = await readClipboard();
        // Content-based identity: simple and dependency-free. A Win32
        // clipboard *sequence number* (via a native/FFI call) would be a
        // strictly better identity — it catches re-copying identical text,
        // which content equality can't (see freshness.test.ts's documented
        // false-reject case) — but that needs a native call beyond
        // uiohook-napi, so it's left as a documented future upgrade, not
        // implemented here.
        const decision = assessFreshness(state, { identity: text, text }, now());
        state = decision.next;
        switch (decision.reason) {
          case "empty":
            return { status: "retryable", reason: "empty-selection", hint: EMPTY_HINT };
          case "stale":
            return { status: "retryable", reason: "stale-clipboard", hint: STALE_HINT };
          case "changed":
          case "recent":
            return { status: "ok", text };
        }
      }
    },
    hotkey: {
      origin: "windows-uiohook",
      register: async (accelerator: string, onTrigger: () => void): Promise<HotkeyRegistration> => {
        let uiohook: UiohookModule;
        try {
          // Non-literal specifier: keeps this a value TypeScript types as
          // `any` rather than a statically-resolved module import, so `tsc`
          // never needs `uiohook-napi`'s (nonexistent, here) type declarations
          // or the package to be installed at all. At runtime this is the
          // required lazy dynamic import — never a module-top-level import —
          // so a missing/broken native prebuild only fails inside `register()`.
          uiohook = (await import(UIOHOOK_SPECIFIER)) as UiohookModule;
        } catch (err) {
          return { ok: false, detail: `${DOCTOR_HINT} (${errMessage(err)})`, dispose: async () => undefined };
        }

        const chord = resolveChord(accelerator, uiohook.UiohookKey);
        if (!chord) {
          return {
            ok: false,
            detail: `unsupported accelerator "${accelerator}" — run \`prompt-gloss doctor\``,
            dispose: async () => undefined
          };
        }

        const pressed = new Set<number>();
        // Guards key-repeat: once the chord fires, it re-arms only after the
        // chord is no longer fully held (mirrors a normal OS global hotkey,
        // which fires once per press-and-release, not once per repeat event).
        let armed = true;
        const chordSatisfied = (): boolean =>
          pressed.has(chord.mainKeyCode) &&
          chord.modifierCodes.every((group) => group.some((code) => pressed.has(code)));

        const onKeydown = (e: UiohookKeyboardEvent): void => {
          pressed.add(e.keycode);
          if (armed && chordSatisfied()) {
            armed = false;
            onTrigger();
          }
        };
        const onKeyup = (e: UiohookKeyboardEvent): void => {
          pressed.delete(e.keycode);
          if (!chordSatisfied()) armed = true;
        };

        try {
          uiohook.uIOhook.on("keydown", onKeydown);
          uiohook.uIOhook.on("keyup", onKeyup);
          uiohook.uIOhook.start();
        } catch (err) {
          // If .start() throws after .on(), the listeners are already installed
          // — tear them down AND stop the hook before degrading. Each in its own
          // try so a throwing removeListener can't skip .stop() (break-it round 2 F7).
          try {
            uiohook.uIOhook.removeListener("keydown", onKeydown);
          } catch {
            // best-effort
          }
          try {
            uiohook.uIOhook.removeListener("keyup", onKeyup);
          } catch {
            // best-effort
          }
          try {
            uiohook.uIOhook.stop();
          } catch {
            // best-effort
          }
          return {
            ok: false,
            detail: `uiohook-napi failed to start — run \`prompt-gloss doctor\` (${errMessage(err)})`,
            dispose: async () => undefined
          };
        }

        return {
          ok: true,
          detail: "",
          dispose: async () => {
            try {
              uiohook.uIOhook.removeListener("keydown", onKeydown);
              uiohook.uIOhook.removeListener("keyup", onKeyup);
              uiohook.uIOhook.stop();
            } catch {
              // best-effort teardown — dispose never throws
            }
          }
        };
      }
    }
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Accelerator parsing (pure, unit-tested) — "ctrl+alt+j" → modifiers + key.
// ---------------------------------------------------------------------------

export type ModifierName = "ctrl" | "alt" | "shift" | "meta";

export interface ParsedAccelerator {
  readonly modifiers: readonly ModifierName[];
  /** Normalized (lowercased) main-key token, e.g. "j", "f1", "space". Empty
   *  string when the accelerator carried no non-modifier token. */
  readonly key: string;
}

const MODIFIER_ALIASES: Record<string, ModifierName> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  win: "meta",
  super: "meta"
};

/** Splits an accelerator string like "Ctrl+Alt+J" into normalized modifiers +
 *  main key. Case-insensitive, whitespace-tolerant. The last non-modifier
 *  token wins as the main key (accelerators carry exactly one). */
export function parseAccelerator(accelerator: string): ParsedAccelerator {
  const tokens = accelerator
    .split("+")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  const modifiers: ModifierName[] = [];
  let key = "";
  for (const token of tokens) {
    const mod = MODIFIER_ALIASES[token];
    if (mod) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
    } else {
      key = token;
    }
  }
  return { modifiers, key };
}

// ---------------------------------------------------------------------------
// Chord resolution against the real `uiohook-napi` module (live-smoke only —
// this needs the actual `UiohookKey` table, so it is not unit-tested here).
// ---------------------------------------------------------------------------

/** `uiohook-napi` has no left/right-specific token in our accelerators, so
 *  either physical key satisfies a modifier (e.g. either Ctrl key). */
const MODIFIER_KEY_NAMES: Record<ModifierName, readonly string[]> = {
  ctrl: ["Ctrl", "CtrlRight"],
  alt: ["Alt", "AltRight"],
  shift: ["Shift", "ShiftRight"],
  meta: ["Meta", "MetaRight"]
};

const NAMED_KEY_ALIASES: Record<string, string> = {
  space: "Space",
  tab: "Tab",
  enter: "Enter",
  return: "Enter",
  esc: "Escape",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight"
};

/** Candidate `UiohookKey` property names for a single main-key token, tried
 *  in order until one resolves to a numeric code in the real table. */
function keyNameCandidates(token: string): readonly string[] {
  if (/^[a-z]$/.test(token)) return [token.toUpperCase()];
  if (/^[0-9]$/.test(token)) return [token];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(token)) return [token.toUpperCase()];
  const named = NAMED_KEY_ALIASES[token];
  return named ? [named] : [];
}

function lookupCode(table: Record<string, number>, names: readonly string[]): number | undefined {
  for (const name of names) {
    const code = table[name];
    if (typeof code === "number") return code;
  }
  return undefined;
}

interface ResolvedChord {
  /** One inner array per modifier; any code within it satisfies that modifier. */
  readonly modifierCodes: readonly (readonly number[])[];
  readonly mainKeyCode: number;
}

/** Resolves a parsed accelerator to concrete `UiohookKey` codes. `null` when
 *  any token (main key or a modifier) doesn't resolve — the caller reports
 *  that accelerator as unsupported rather than registering a looser chord
 *  than the user asked for. */
function resolveChord(accelerator: string, table: Record<string, number>): ResolvedChord | null {
  const parsed = parseAccelerator(accelerator);
  if (!parsed.key) return null;

  const mainKeyCode = lookupCode(table, keyNameCandidates(parsed.key));
  if (mainKeyCode === undefined) return null;

  const modifierCodes: number[][] = [];
  for (const mod of parsed.modifiers) {
    const codes = MODIFIER_KEY_NAMES[mod]
      .map((name) => table[name])
      .filter((c): c is number => typeof c === "number");
    if (codes.length === 0) return null;
    modifierCodes.push(codes);
  }
  return { modifierCodes, mainKeyCode };
}

// ---------------------------------------------------------------------------
// Minimal local shape for the dynamically-imported `uiohook-napi` module.
// There is no installed/bundled declaration file for it (it's an
// optionalDependency, frequently absent — that's the whole reason for the
// lazy import), so this is a hand-written surface covering only what this
// adapter uses.
// ---------------------------------------------------------------------------

const UIOHOOK_SPECIFIER = "uiohook-napi";

interface UiohookKeyboardEvent {
  readonly keycode: number;
}

interface UiohookInstance {
  start(): void;
  stop(): void;
  on(event: "keydown" | "keyup", listener: (e: UiohookKeyboardEvent) => void): void;
  removeListener(event: "keydown" | "keyup", listener: (e: UiohookKeyboardEvent) => void): void;
}

interface UiohookModule {
  readonly uIOhook: UiohookInstance;
  readonly UiohookKey: Record<string, number>;
}
