// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SLICE FILE — Phase D "@codex panel plumbing". Replace this stub body.      │
// └──────────────────────────────────────────────────────────────────────────┘
//
// Fires OS notifications / toasts (TERMINAL.md §6): "Card 'xyz' saved to
// .gloss/" on save, plus the retryable/blocked/unsupported capture toasts.
// Per-OS transport (Windows toast, macOS Notification Center, Linux notify-send
// / D-Bus). Real emission is a live-smoke item — a headless CI box has no
// notification service — so this is a fakeable OUTPUT boundary (TESTING.md).

import type { Notifier, NotifyMessage } from "./types.js";

export function createOsNotifier(log: (line: string) => void = () => undefined): Notifier {
  return {
    notify: (m: NotifyMessage) => {
      // STUB: the real slice raises a native OS notification here.
      log(`[gloss companion] (stub) ${m.kind}: ${m.text}`);
    }
  };
}
