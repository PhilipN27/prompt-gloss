// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SLICE FILE — Phase D "@claude Windows adapter". Replace this stub body.    │
// │ Owned by ONE slice; the foundation (types.ts, flow.ts, select.ts) and      │
// │ every other file stay untouched by this slice.                             │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Windows capture (TERMINAL.md §2.4/§8.2):
//  - Hotkey: Win32 RegisterHotKey via `uiohook-napi` (optionalDependency). If
//    the prebuild is missing, `register` resolves { ok:false } with a doctor
//    hint — NEVER throw at import time (lazy-import uiohook inside register).
//  - Capture: read the clipboard and gate it through `assessFreshness`
//    (../freshness.ts) — NEVER synthesize Ctrl+C (SIGINT hazard §2.4). Stale →
//    { status:"retryable", reason:"stale-clipboard", hint: <copy-first toast> }.
//    Prefer the Win32 clipboard sequence number as the freshness identity.
//  - probe(): report "available" (mechanism present) even with an empty
//    clipboard; non-prompting.
// Tests: freshness is pure-unit-tested already (../freshness.ts); real hotkey +
// real clipboard capture are live-smoke items (TESTING.md).

import type { AdapterEnv, CaptureAdapter } from "../select.js";
import type { CaptureCapability, CaptureResult, HotkeyRegistration } from "../types.js";

const NOT_IMPLEMENTED =
  "Windows companion capture is not implemented yet (Phase D slice). Use `prompt-gloss add`.";

export function createWindowsAdapter(_env: AdapterEnv): CaptureAdapter {
  return {
    selection: {
      origin: "windows-clipboard",
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
      origin: "windows-uiohook",
      register: async (): Promise<HotkeyRegistration> => ({
        ok: false,
        detail: NOT_IMPLEMENTED,
        dispose: async () => undefined
      })
    }
  };
}
