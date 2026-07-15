// Companion capture contracts (TERMINAL.md §8). These interfaces are the
// pinned boundary between the OS-specific capture adapters (one per OS, each a
// parallel implementation slice) and the OS-agnostic capture flow. Both edges
// at the OS boundary are fakeable in tests: the INPUT boundary
// (`SelectionSource`, `HotkeyRegistrar` — a real selection / global keypress
// cannot be synthesized in CI) and the OUTPUT boundary (`PanelOpener`,
// `Notifier` — a real browser window / OS toast cannot fire in headless CI).
// Everything BETWEEN them (URL construction, the embedded server route, dedup,
// the store) runs real — the v1 "fake the boundary, never the pipeline" rule
// (TESTING.md "Terminal surfaces"), extended to the output edge.

import type { CardOrigin } from "@prompt-gloss/core";

/** The origin every companion-created card carries (TERMINAL.md §5/§8.3). */
export const COMPANION_ORIGIN: CardOrigin = "companion";

/**
 * The result of capturing the current selection on a hotkey press. Four
 * outcomes the flow branches on distinctly (TERMINAL.md §8.2, §2.4). The
 * `retryable`/`blocked`/`unsupported` split is load-bearing:
 *
 * - `ok`         → we have the user's selection; open the panel.
 * - `retryable`  → transient, stay armed: nothing usable *right now*. Windows
 *                  stale clipboard or an empty X11 PRIMARY. Show `hint`
 *                  ("copy first…"); the next hotkey press can succeed.
 * - `blocked`    → actionable: the mechanism exists but a permission grant is
 *                  in the way (macOS Input Monitoring denied, §2.4). Show
 *                  `remediation` naming the exact Settings pane; if
 *                  `restartRequired` the daemon can't recover this session.
 *                  NOT terminal like `unsupported` — a re-probe after the grant
 *                  can succeed, so the flow must not route permanently to CLI.
 * - `unsupported`→ terminal for this session: no usable mechanism (xclip
 *                  missing, Wayland compositor can't bind a hotkey). Route to
 *                  the CLI rung (§9.3).
 */
export type CaptureResult =
  | { readonly status: "ok"; readonly text: string }
  | {
      readonly status: "retryable";
      readonly reason: "empty-selection" | "stale-clipboard";
      readonly hint: string;
    }
  | {
      readonly status: "blocked";
      readonly reason: "permission-denied";
      readonly remediation: string;
      readonly restartRequired: boolean;
    }
  | { readonly status: "unsupported"; readonly reason: string; readonly fallback: "cli" };

/** Doctor/preflight capability tiers (§9.4). Distinct from a per-hotkey capture:
 *  an empty current selection still means the mechanism is `available`. */
export type CaptureSupport = "available" | "blocked" | "unsupported";

/**
 * Capability probe surfaced by `doctor` (§9.4) and startup preflight. MUST be
 * cheap and NON-PROMPTING — doctor must never pop a macOS permission dialog or
 * a Wayland shortcut-registration prompt. `remediation` names the exact OS
 * affordance to grant/install when `support` is `blocked`/`unsupported`.
 */
export interface CaptureCapability {
  readonly support: CaptureSupport;
  /** Human-readable line for `doctor`: what works, what's degraded, what to do. */
  readonly detail: string;
  readonly remediation?: string;
}

/**
 * Abstracts "get the text the user has selected", per OS/mechanism
 * (TERMINAL.md §2.4/§8.2). The OS input boundary — faked (scripted) in flow
 * tests because CI cannot make a real selection.
 */
export interface SelectionSource {
  /** Stable id for logging/doctor: "x11-primary", "macos-pasteboard", … */
  readonly origin: string;
  probe(): Promise<CaptureCapability>;
  capture(): Promise<CaptureResult>;
}

/**
 * Registers the global hotkey (TERMINAL.md §2.4/§8.2) — the OS keypress
 * boundary, and (Wayland) the trigger whose bindability gates the whole rung:
 * a capture mechanism with no hotkey to fire it is not a companion. `register`
 * never throws for an expected degradation (prebuild missing, portal refused to
 * bind the accelerator): it resolves to `{ ok: false, detail }` and the caller
 * routes to the CLI rung.
 */
export interface HotkeyRegistrar {
  readonly origin: string;
  register(accelerator: string, onTrigger: () => void): Promise<HotkeyRegistration>;
}

export interface HotkeyRegistration {
  /** false → the hotkey could not be bound; degrade to the CLI rung with `detail`. */
  readonly ok: boolean;
  readonly detail: string;
  dispose(): Promise<void>;
}

/**
 * Opens the panel window at a URL — the app-mode browser launch with a
 * default-browser fallback (§8.3). Fakeable OUTPUT boundary (recording opener
 * in flow tests); real launch covered by live smoke.
 */
export interface PanelOpener {
  open(url: string): Promise<void>;
}

/** An OS notification / toast (TERMINAL.md §6). Fakeable OUTPUT boundary. */
export interface Notifier {
  notify(message: NotifyMessage): void;
}

export interface NotifyMessage {
  readonly kind: "saved" | "retryable" | "blocked" | "unsupported" | "error";
  readonly text: string;
}

/**
 * Resolves which project a captured card belongs to (§8.2). When no project is
 * configured yet, the flow opens the panel on the project-picker page instead
 * of the card panel. NB: the companion must NOT inherit the CLI's cwd default —
 * an unconfigured companion resolves to `picker`, never to whatever directory
 * launched the daemon.
 */
export interface ProjectResolver {
  resolve(): Promise<ProjectResolution>;
}

export type ProjectResolution =
  | { readonly kind: "project"; readonly dir: string }
  | { readonly kind: "picker" };

// `CardSavedEvent` — the server's card-saved signal — is owned by and imported
// from `@prompt-gloss/server` (single source of truth for the buildServer
// contract); the flow re-exports it for slice convenience.
export type { CardSavedEvent } from "@prompt-gloss/server";

/**
 * Where the embedded panel server lives and the paths for the card panel vs.
 * the project-picker page. The flow owns URL construction (span + origin
 * encoding is a correctness concern); the picker page content is the panel
 * slice's.
 */
export interface PanelEndpoints {
  /** e.g. "http://127.0.0.1:53187" (no trailing slash; port is ephemeral, §8.3). */
  readonly baseUrl: string;
  /** Card panel path, default "/panel". */
  readonly panelPath: string;
  /** Project-picker path, default "/panel" (opened with `?pick=1`). */
  readonly pickerPath: string;
}
