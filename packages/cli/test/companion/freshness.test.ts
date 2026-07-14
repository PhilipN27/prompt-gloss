// Windows/Wayland clipboard-freshness — the pure logic that decides whether
// the clipboard's current contents are a just-made selection or stale junk
// (TERMINAL.md §8.2: "read the clipboard only if it changed since the last
// hotkey press OR within the last 15 s"). Never synthesize Ctrl+C (SIGINT
// hazard §2.4) — freshness is how the copy-then-hotkey rungs stay honest.
//
// Council-pinned (Codex, 2026-07-14): accept iff
//   nonEmpty && (changed-since-last-hotkey || change-observed-within-window).
// State rules: arm snapshots the clipboard but does NOT mark it "changed"; the
// baseline updates after EVERY hotkey; a monotonic clock is assumed. Identity
// is the Win32 clipboard sequence number when available, else the text — the
// tests exercise both the strengths and the documented content-only blind spots.

import { describe, expect, it } from "vitest";
import {
  armFreshness,
  assessFreshness,
  FRESHNESS_WINDOW_MS,
  type FreshnessState
} from "../../src/companion/freshness.js";

const snap = (identity: string, text = identity) => ({ identity, text });

describe("armFreshness", () => {
  it("snapshots the clipboard identity without marking it changed", () => {
    expect(armFreshness("baseline")).toEqual({
      previousIdentity: "baseline",
      lastChangeAt: null
    });
  });
});

describe("assessFreshness", () => {
  it("accepts a fresh copy: clipboard changed since arm (copy-then-hotkey)", () => {
    const state = armFreshness("old-clip");
    const d = assessFreshness(state, snap("billing engine"), 1000);
    expect(d.accept).toBe(true);
    expect(d.reason).toBe("changed");
    expect(d.next.previousIdentity).toBe("billing engine");
    expect(d.next.lastChangeAt).toBe(1000);
  });

  it("rejects an unchanged clipboard at the first hotkey (stale baseline, no copy)", () => {
    // Text copied before the daemon armed has no trustworthy change time.
    const state = armFreshness("old-clip");
    const d = assessFreshness(state, snap("old-clip", "days-old text"), 1000);
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("stale");
  });

  it("rejects an empty/whitespace clipboard as `empty`, not stale", () => {
    const state = armFreshness("old-clip");
    const d = assessFreshness(state, snap("", "   \n  "), 1000);
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("empty");
  });

  it("accepts within the 15s grace window even without a new change (documented false-accept)", () => {
    // A change was observed at t=1000; a second press at t=5000 with the SAME
    // clipboard is accepted because it is within the window.
    let state = armFreshness("old-clip");
    state = assessFreshness(state, snap("selection-A"), 1000).next; // change observed
    const d = assessFreshness(state, snap("selection-A"), 5000);
    expect(d.accept).toBe(true);
    expect(d.reason).toBe("recent");
    expect(4000).toBeLessThanOrEqual(FRESHNESS_WINDOW_MS);
  });

  it("rejects the same unchanged clipboard once the grace window has elapsed", () => {
    let state = armFreshness("old-clip");
    state = assessFreshness(state, snap("selection-A"), 1000).next;
    const d = assessFreshness(state, snap("selection-A"), 1000 + FRESHNESS_WINDOW_MS + 1);
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("stale");
  });

  it("false-reject: re-copying identical text after the window is invisible to a content snapshot", () => {
    // Documented limitation of content-only identity — a Win32 sequence number
    // would catch this; content equality cannot.
    let state = armFreshness("old-clip");
    state = assessFreshness(state, snap("A"), 1000).next; // first copy accepted
    const d = assessFreshness(state, snap("A"), 30_000); // same text re-copied later
    expect(d.accept).toBe(false);
    expect(d.reason).toBe("stale");
  });

  it("updates the baseline after every hotkey, including rejected presses", () => {
    let state: FreshnessState = armFreshness("old-clip");
    // Rejected stale press — baseline still advances to the observed identity.
    state = assessFreshness(state, snap("old-clip", "old"), 1000).next;
    expect(state.previousIdentity).toBe("old-clip");
    // A subsequent different clipboard now reads as a change.
    const d = assessFreshness(state, snap("new-sel"), 2000);
    expect(d.accept).toBe(true);
    expect(d.reason).toBe("changed");
  });

  it("honours a custom window", () => {
    let state = armFreshness("old-clip");
    state = assessFreshness(state, snap("A"), 0).next;
    expect(assessFreshness(state, snap("A"), 500, 1000).accept).toBe(true);
    expect(assessFreshness(state, snap("A"), 1500, 1000).accept).toBe(false);
  });
});
