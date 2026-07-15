// Clipboard-freshness — the pure decision that keeps the copy-then-hotkey
// capture rungs (Windows always; Wayland where PRIMARY is unavailable) honest.
// On Windows, Ctrl+C without a selection is SIGINT to the running program
// (TERMINAL.md §2.4), so the companion NEVER synthesizes a copy — it reads the
// clipboard on the hotkey and must decide whether those contents are a
// just-made selection or stale junk (§8.2).
//
// Council-pinned predicate (Codex, 2026-07-14): accept iff the clipboard is
// non-empty AND (it changed since the previous hotkey OR a change was observed
// within the grace window). This module is pure and clock-injected so every
// branch is unit-testable with constructed snapshots/timestamps (TESTING.md).

/** Default grace window (§8.2: "within the last 15 s"). */
export const FRESHNESS_WINDOW_MS = 15_000;

export interface FreshnessState {
  /**
   * Clipboard identity observed at the previous hotkey (or at arm time).
   * `null` means no baseline yet — an unknown baseline can never count as a
   * change, so the first press against un-copied contents is correctly stale.
   */
  readonly previousIdentity: string | null;
  /** Monotonic ms when a change was last observed; `null` = never. */
  readonly lastChangeAt: number | null;
}

export interface FreshnessSnapshot {
  /**
   * Change-detection identity. Prefer the Win32 clipboard sequence number when
   * the adapter can obtain it (it detects re-copying identical text, which
   * content equality cannot); otherwise the clipboard text itself.
   */
  readonly identity: string;
  /** The clipboard text — checked for non-emptiness and returned on accept. */
  readonly text: string;
}

export interface FreshnessDecision {
  readonly accept: boolean;
  readonly reason: "changed" | "recent" | "empty" | "stale";
  /** State to thread into the next hotkey assessment. */
  readonly next: FreshnessState;
}

/**
 * Arm state, captured when the daemon starts. The current clipboard identity is
 * snapshotted as the baseline but explicitly NOT marked as "changed now" — its
 * contents may be days old, and treating the baseline as a fresh change would
 * accept arbitrarily old text for the whole grace window.
 */
export function armFreshness(identity: string): FreshnessState {
  return { previousIdentity: identity, lastChangeAt: null };
}

/**
 * Decide whether the current clipboard is a fresh selection. Pure: pass a
 * monotonic `now`. Returns the verdict plus the state to persist for the next
 * press (the baseline advances after every hotkey, accepted or rejected).
 */
export function assessFreshness(
  prev: FreshnessState,
  current: FreshnessSnapshot,
  now: number,
  windowMs: number = FRESHNESS_WINDOW_MS
): FreshnessDecision {
  const nonEmpty = current.text.trim().length > 0;
  const changedSinceLastHotkey =
    prev.previousIdentity !== null && current.identity !== prev.previousIdentity;

  const lastChangeAt = changedSinceLastHotkey ? now : prev.lastChangeAt;
  const recentlyObservedChange =
    lastChangeAt !== null && now >= lastChangeAt && now - lastChangeAt <= windowMs;

  const accept = nonEmpty && (changedSinceLastHotkey || recentlyObservedChange);
  const reason: FreshnessDecision["reason"] = !nonEmpty
    ? "empty"
    : changedSinceLastHotkey
      ? "changed"
      : recentlyObservedChange
        ? "recent"
        : "stale";

  return {
    accept,
    reason,
    next: { previousIdentity: current.identity, lastChangeAt }
  };
}
