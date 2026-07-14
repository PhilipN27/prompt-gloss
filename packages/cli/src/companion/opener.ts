// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SLICE FILE — Phase D "@codex panel plumbing". Replace this stub body.      │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Opens the panel window at a URL (TERMINAL.md §8.3): app-mode browser window
// (`chrome --app=<url>` / `msedge --app=<url>`) with a DEFAULT-BROWSER fallback
// when neither is found. Always-on-top is NOT available for --app windows
// (Phase-0 finding, §8.3 / §12 row 6) — the focused normal window satisfies the
// loop. Real launch is a live-smoke item; this fakeable OUTPUT boundary lets the
// flow tests run headless.

import type { PanelOpener } from "./types.js";

export function createAppModeOpener(log: (line: string) => void = () => undefined): PanelOpener {
  return {
    open: async (url: string) => {
      // STUB: the real slice launches an app-mode browser window here.
      log(`[gloss companion] (stub) would open panel window: ${url}`);
    }
  };
}
