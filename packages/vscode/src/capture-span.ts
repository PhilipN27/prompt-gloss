// Pure decision logic for which text a terminal capture uses as the span.
// vscode-free so it unit-tests under vitest (the extension host is absent in
// `pnpm test`); capture.ts does the vscode clipboard/command orchestration and
// delegates the choice here.

export interface CaptureSources {
  /**
   * Text from a native terminal selection (via
   * `workbench.action.terminal.copySelection`), or "" when the terminal has no
   * native selection. Populated in a plain shell, or when a TUI's mouse
   * reporting is off.
   */
  nativeSelection: string;
  /**
   * Clipboard contents at capture time. Claude Code's TUI enables mouse
   * reporting (v2.1.150+), so a drag in the terminal never produces a native
   * selection — Claude consumes the mouse events and auto-copies the selection
   * to the clipboard. The clipboard is therefore the real selection channel for
   * the primary use case (TERMINAL.md §7.2).
   */
  clipboard: string;
}

/**
 * Resolve the span to capture. Prefer a native terminal selection when present
 * (unambiguous); otherwise fall back to the clipboard, which is where Claude
 * Code's mouse-mode TUI puts the user's drag-selection. Returns null only when
 * neither source yields text — the caller then prompts the user to select
 * something.
 *
 * Any non-empty clipboard is accepted (not freshness-gated): the panel is a
 * review step, so a stale prefill is visible and correctable, whereas an
 * equality-based freshness guard would wrongly reject re-selecting the same
 * word. A robust freshness signal needs the OS clipboard sequence number, which
 * the sandboxed extension can't read — tracked as a follow-up (the companion
 * already does this natively, §8.2).
 */
export function resolveCaptureSpan(sources: CaptureSources): string | null {
  const native = sources.nativeSelection.trim();
  if (native.length > 0) return native;
  const clip = sources.clipboard.trim();
  if (clip.length > 0) return clip;
  return null;
}
