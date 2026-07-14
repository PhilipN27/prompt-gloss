// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SLICE FILE — Phase D "@claude macOS adapter". Replace this stub body.      │
// └──────────────────────────────────────────────────────────────────────────┘
//
// macOS capture (TERMINAL.md §2.4/§8.2):
//  - Hotkey: uiohook-napi (CGEventTap). Requires the INPUT MONITORING pane
//    (System Settings › Privacy & Security › Input Monitoring) — NOT
//    Accessibility (§2.4). Preflight and name the exact pane.
//  - Capture: snapshot NSPasteboard → synthesize ⌘C via uiohook `keyTap`
//    (safe on macOS — SIGINT is Ctrl+C, a different chord) → read → RESTORE the
//    pasteboard. Empty selection → { status:"retryable", reason:"empty-selection" }.
//  - Permission denied → { status:"blocked", reason:"permission-denied",
//    remediation: <name the Input Monitoring pane>, restartRequired: true }.
//    This is DISTINCT from "unsupported": a grant + restart recovers it, so the
//    flow must not route permanently to the CLI rung.
//  - probe(): non-prompting capability check (must NOT open the permission
//    dialog); map a known denial to support:"blocked".
// Tests: pasteboard save/restore + permission flows are live-smoke items.

import type { AdapterEnv, CaptureAdapter } from "../select.js";
import type { CaptureCapability, CaptureResult, HotkeyRegistration } from "../types.js";

const NOT_IMPLEMENTED =
  "macOS companion capture is not implemented yet (Phase D slice). Use `prompt-gloss add`.";

export function createMacosAdapter(_env: AdapterEnv): CaptureAdapter {
  return {
    selection: {
      origin: "macos-pasteboard",
      probe: async (): Promise<CaptureCapability> => ({
        support: "unsupported",
        detail: NOT_IMPLEMENTED
      }),
      capture: async (): Promise<CaptureResult> => ({
        status: "unsupported",
        reason: NOT_IMPLEMENTED,
        fallback: "cli"
      })
    },
    hotkey: {
      origin: "macos-uiohook",
      register: async (): Promise<HotkeyRegistration> => ({
        ok: false,
        detail: NOT_IMPLEMENTED,
        dispose: async () => undefined
      })
    }
  };
}
