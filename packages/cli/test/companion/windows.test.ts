// Windows capture adapter (TERMINAL.md §2.4/§8.2, Phase D slice 1). Only the
// injectable seams (`readClipboard`, `now`, `initialState`) are exercised
// here — never the real PowerShell process or the real `uiohook-napi` module,
// per the "fake the boundary, never the pipeline" rule (TESTING.md). The real
// hotkey registration and real clipboard shell-out are live-smoke items.

import { describe, expect, it } from "vitest";
import { armFreshness } from "../../src/companion/freshness.js";
import { createWindowsAdapter, parseAccelerator } from "../../src/companion/adapters/windows.js";

function scriptedClipboard(...texts: readonly string[]): () => Promise<string> {
  const queue = [...texts];
  return async () => {
    if (queue.length === 0) throw new Error("scriptedClipboard: ran out of scripted reads");
    return queue.shift()!;
  };
}

describe("createWindowsAdapter — selection.probe()", () => {
  it("reports available even with an empty clipboard, without prompting or touching the clipboard", async () => {
    const adapter = createWindowsAdapter(
      { platform: "win32", env: {} },
      {
        readClipboard: () => Promise.reject(new Error("probe must never read the clipboard")),
        initialState: armFreshness("")
      }
    );
    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("available");
    expect(cap.detail).toContain("Windows clipboard");
  });

  it("has the windows-clipboard origin", () => {
    const adapter = createWindowsAdapter(
      { platform: "win32", env: {} },
      { readClipboard: scriptedClipboard(""), initialState: armFreshness("") }
    );
    expect(adapter.selection.origin).toBe("windows-clipboard");
    expect(adapter.hotkey.origin).toBe("windows-uiohook");
  });
});

describe("createWindowsAdapter — selection.capture()", () => {
  it("accepts a fresh copy: clipboard changed since the armed baseline", async () => {
    const adapter = createWindowsAdapter(
      { platform: "win32", env: {} },
      {
        readClipboard: scriptedClipboard("billing engine"),
        now: () => 1_000,
        initialState: armFreshness("old-clip")
      }
    );
    const result = await adapter.selection.capture();
    expect(result).toEqual({ status: "ok", text: "billing engine" });
  });

  it("rejects an empty clipboard as retryable/empty-selection with the copy-first hint", async () => {
    const adapter = createWindowsAdapter(
      { platform: "win32", env: {} },
      {
        readClipboard: scriptedClipboard("   \n  "),
        now: () => 1_000,
        initialState: armFreshness("old-clip")
      }
    );
    const result = await adapter.selection.capture();
    expect(result.status).toBe("retryable");
    if (result.status !== "retryable") throw new Error("unreachable");
    expect(result.reason).toBe("empty-selection");
    expect(result.hint).toContain("Ctrl+Shift+C");
    expect(result.hint).toContain("Select and copy text first");
  });

  it("rejects an unchanged clipboard outside the grace window as retryable/stale-clipboard", async () => {
    const adapter = createWindowsAdapter(
      { platform: "win32", env: {} },
      {
        // Baseline text is identical to what capture() will read, and no
        // change has ever been observed, so this is stale from the first press.
        readClipboard: scriptedClipboard("days-old text"),
        now: () => 1_000,
        initialState: armFreshness("days-old text")
      }
    );
    const result = await adapter.selection.capture();
    expect(result.status).toBe("retryable");
    if (result.status !== "retryable") throw new Error("unreachable");
    expect(result.reason).toBe("stale-clipboard");
    expect(result.hint).toContain("Copy your selection first");
  });

  it("accepts a second press within the 15s grace window on the same clipboard contents", async () => {
    let clock = 1_000;
    const adapter = createWindowsAdapter(
      { platform: "win32", env: {} },
      {
        readClipboard: scriptedClipboard("selection-A", "selection-A"),
        now: () => clock,
        initialState: armFreshness("old-clip")
      }
    );

    const first = await adapter.selection.capture(); // change observed at t=1000
    expect(first).toEqual({ status: "ok", text: "selection-A" });

    clock = 5_000; // +4s, inside the 15s window, same clipboard contents
    const second = await adapter.selection.capture();
    expect(second).toEqual({ status: "ok", text: "selection-A" });
  });

  it("rejects the same unchanged clipboard once the grace window has elapsed", async () => {
    let clock = 1_000;
    const adapter = createWindowsAdapter(
      { platform: "win32", env: {} },
      {
        readClipboard: scriptedClipboard("selection-A", "selection-A"),
        now: () => clock,
        initialState: armFreshness("old-clip")
      }
    );

    await adapter.selection.capture(); // change observed at t=1000
    clock = 1_000 + 15_000 + 1; // just past the grace window
    const result = await adapter.selection.capture();
    expect(result.status).toBe("retryable");
    if (result.status !== "retryable") throw new Error("unreachable");
    expect(result.reason).toBe("stale-clipboard");
  });

  it("threads freshness state across repeated presses: copy, capture, press again without copying", async () => {
    let clock = 0;
    const adapter = createWindowsAdapter(
      { platform: "win32", env: {} },
      {
        readClipboard: scriptedClipboard("term one", "term one"),
        now: () => clock,
        initialState: armFreshness("")
      }
    );

    clock = 0;
    const okResult = await adapter.selection.capture();
    expect(okResult).toEqual({ status: "ok", text: "term one" });

    // Press again, well outside the grace window, with no new copy: stale.
    clock = 20_000;
    const staleResult = await adapter.selection.capture();
    expect(staleResult.status).toBe("retryable");
  });

});

describe("parseAccelerator", () => {
  it("splits modifiers and the main key", () => {
    expect(parseAccelerator("ctrl+alt+j")).toEqual({ modifiers: ["ctrl", "alt"], key: "j" });
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    expect(parseAccelerator(" CTRL + Alt + J ")).toEqual({ modifiers: ["ctrl", "alt"], key: "j" });
  });

  it("normalizes modifier aliases (cmd/command/win/super -> meta, option -> alt, control -> ctrl)", () => {
    expect(parseAccelerator("cmd+j")).toEqual({ modifiers: ["meta"], key: "j" });
    expect(parseAccelerator("command+j")).toEqual({ modifiers: ["meta"], key: "j" });
    expect(parseAccelerator("win+j")).toEqual({ modifiers: ["meta"], key: "j" });
    expect(parseAccelerator("super+j")).toEqual({ modifiers: ["meta"], key: "j" });
    expect(parseAccelerator("option+j")).toEqual({ modifiers: ["alt"], key: "j" });
    expect(parseAccelerator("control+j")).toEqual({ modifiers: ["ctrl"], key: "j" });
  });

  it("supports a bare key with no modifiers", () => {
    expect(parseAccelerator("j")).toEqual({ modifiers: [], key: "j" });
  });

  it("supports named/function keys as the main key", () => {
    expect(parseAccelerator("ctrl+shift+f1")).toEqual({ modifiers: ["ctrl", "shift"], key: "f1" });
    expect(parseAccelerator("ctrl+space")).toEqual({ modifiers: ["ctrl"], key: "space" });
  });

  it("de-duplicates repeated modifiers", () => {
    expect(parseAccelerator("ctrl+ctrl+j")).toEqual({ modifiers: ["ctrl"], key: "j" });
  });
});
