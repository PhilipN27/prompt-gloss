// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SLICE FILE — Phase D "@claude Linux adapter" (X11 + Wayland). Replace stub.│
// └──────────────────────────────────────────────────────────────────────────┘
//
// Linux capture (TERMINAL.md §2.4/§8.2). Detect X11 vs Wayland from `env`:
//
//  X11 (WAYLAND_DISPLAY unset, DISPLAY set):
//   - Hotkey: XGrabKey via uiohook-napi.
//   - Capture: X11 PRIMARY selection — highlighted text is already in PRIMARY
//     with NO keystroke. Read via `xclip -o -selection primary` (fallback
//     `xsel -p`). Highest-fidelity path of any OS. xclip/xsel missing →
//     { status:"unsupported", reason, fallback:"cli" }.
//
//  Wayland — HOTKEY-FIRST ordering (council-pinned, Codex 2026-07-14): a
//  capture mechanism with no hotkey to fire it is not a companion.
//   1. Establish a portal GlobalShortcuts session and BIND the accelerator;
//      capability = the returned bindings actually CONTAIN our shortcut
//      (BindShortcuts may return a subset/empty). Presence of the portal
//      interface is NOT sufficient.
//   2. If bound → prefer functional background PRIMARY: a bounded probe
//      (`wl-paste --primary --watch /bin/true` staying alive proves background
//      selection access), or a registry probe for `zwlr_data_control_manager_v1`
//      / `ext_data_control_manager_v1` PAIRED with confirmation the installed
//      wl-paste supports it. Do NOT infer from WAYLAND_DISPLAY / desktop name /
//      wl-paste executable presence alone.
//   3. Else → clipboard freshness / copy-then-hotkey (../freshness.ts).
//   4. If the hotkey cannot be bound → the companion rung is `unsupported`
//      regardless of clipboard capability.
//
//  probe()/doctor must report SEPARATE facts: session, global-hotkey status,
//  PRIMARY status, clipboard fallback, effective rung, and the exact fix
//  (install wl-clipboard / xclip, enable a portal backend, authorize the
//  shortcut, or use `prompt-gloss add`). Non-prompting.
// Tests: real PRIMARY/portal capture are live-smoke items.

import type { AdapterEnv, CaptureAdapter } from "../select.js";
import type { CaptureCapability, CaptureResult, HotkeyRegistration } from "../types.js";

const NOT_IMPLEMENTED =
  "Linux companion capture is not implemented yet (Phase D slice). Use `prompt-gloss add`.";

export function createLinuxAdapter(_env: AdapterEnv): CaptureAdapter {
  return {
    selection: {
      origin: "linux-primary",
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
      origin: "linux-uiohook-or-portal",
      register: async (): Promise<HotkeyRegistration> => ({
        ok: false,
        detail: NOT_IMPLEMENTED,
        dispose: async () => undefined
      })
    }
  };
}
