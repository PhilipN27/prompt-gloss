// macOS capture adapter (TERMINAL.md §2.4/§8.2, docs/plans/v2-companion-plan.md
// "Slice 2"). All pasteboard I/O, the ⌘C-synth outcome, the Input Monitoring
// probe, and the uiohook loader are injectable seams (`createMacosAdapter`'s
// second `deps` argument) — these tests never touch a real pasteboard or the
// real uiohook-napi native module, matching the v1 "fake the OS boundary,
// never the pipeline" rule. Real ⌘C synth and real permission prompts are
// live-smoke (TESTING.md).

import { describe, expect, it } from "vitest";
import {
  createMacosAdapter,
  parseAccelerator,
  type MacosAdapterDeps,
  type UiohookModule
} from "../../src/companion/adapters/macos.js";

function fakeDeps(overrides: Partial<MacosAdapterDeps> = {}): MacosAdapterDeps {
  return {
    readPasteboard: async () => "",
    writePasteboard: async () => undefined,
    synthCopy: async () => ({ ok: true }),
    probeInputMonitoring: async () => "unknown",
    loadUiohook: async () => {
      throw new Error("loadUiohook not faked for this test");
    },
    ...overrides
  };
}

describe("createMacosAdapter — selection.capture()", () => {
  it("returns ok with the newly-selected text and restores the original pasteboard", async () => {
    const writes: string[] = [];
    let call = 0;
    const deps = fakeDeps({
      readPasteboard: async () => (call++ === 0 ? "old-clipboard" : "billing engine"),
      writePasteboard: async (text) => void writes.push(text),
      synthCopy: async () => ({ ok: true })
    });
    const adapter = createMacosAdapter({ platform: "darwin", env: {} }, deps);

    const result = await adapter.selection.capture();

    expect(result).toEqual({ status: "ok", text: "billing engine" });
    // The synthesized ⌘C must be invisible: the original pasteboard content
    // is written back after reading the captured selection.
    expect(writes).toEqual(["old-clipboard"]);
  });

  it("returns retryable/empty-selection when the pasteboard is unchanged (no highlight)", async () => {
    const writes: string[] = [];
    const deps = fakeDeps({
      readPasteboard: async () => "same-old-clipboard",
      writePasteboard: async (text) => void writes.push(text),
      synthCopy: async () => ({ ok: true })
    });
    const adapter = createMacosAdapter({ platform: "darwin", env: {} }, deps);

    const result = await adapter.selection.capture();

    expect(result).toEqual({
      status: "retryable",
      reason: "empty-selection",
      hint: "Select some text, then press the hotkey."
    });
    expect(writes).toEqual(["same-old-clipboard"]);
  });

  it("returns retryable/empty-selection when the pasteboard reads back empty/whitespace", async () => {
    let call = 0;
    const deps = fakeDeps({
      readPasteboard: async () => (call++ === 0 ? "old" : "   \n  "),
      synthCopy: async () => ({ ok: true })
    });
    const adapter = createMacosAdapter({ platform: "darwin", env: {} }, deps);

    const result = await adapter.selection.capture();
    expect(result.status).toBe("retryable");
  });

  it("returns blocked/permission-denied when the ⌘C synth fails, without touching the pasteboard again", async () => {
    const writes: string[] = [];
    let reads = 0;
    const deps = fakeDeps({
      readPasteboard: async () => {
        reads++;
        return "old-clipboard";
      },
      writePasteboard: async (text) => void writes.push(text),
      synthCopy: async () => ({ ok: false, detail: "Input Monitoring denied" })
    });
    const adapter = createMacosAdapter({ platform: "darwin", env: {} }, deps);

    const result = await adapter.selection.capture();

    expect(result).toEqual({
      status: "blocked",
      reason: "permission-denied",
      remediation: "Grant Gloss access in System Settings › Privacy & Security › Input Monitoring.",
      restartRequired: true
    });
    // Nothing was ever written by us — the synth never fired, so there is
    // nothing to restore, and the pasteboard is read exactly once (the
    // pre-capture snapshot).
    expect(writes).toEqual([]);
    expect(reads).toBe(1);
  });

  it("restores the pasteboard even when the post-synth read throws", async () => {
    const writes: string[] = [];
    let call = 0;
    const deps = fakeDeps({
      readPasteboard: async () => {
        call++;
        if (call === 1) return "old-clipboard";
        throw new Error("pbpaste exploded");
      },
      writePasteboard: async (text) => void writes.push(text),
      synthCopy: async () => ({ ok: true })
    });
    const adapter = createMacosAdapter({ platform: "darwin", env: {} }, deps);

    await expect(adapter.selection.capture()).rejects.toThrow("pbpaste exploded");
    expect(writes).toEqual(["old-clipboard"]);
  });
});

describe("createMacosAdapter — selection.probe()", () => {
  it("is available when Input Monitoring is granted", async () => {
    const adapter = createMacosAdapter(
      { platform: "darwin", env: {} },
      fakeDeps({ probeInputMonitoring: async () => "granted" })
    );
    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("available");
  });

  it("is blocked (with the Input Monitoring pane named) when denied", async () => {
    const adapter = createMacosAdapter(
      { platform: "darwin", env: {} },
      fakeDeps({ probeInputMonitoring: async () => "denied" })
    );
    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("blocked");
    expect(cap.remediation).toBe("System Settings › Privacy & Security › Input Monitoring");
  });

  it("is blocked (not available) when the authorization status is unknown", async () => {
    const adapter = createMacosAdapter(
      { platform: "darwin", env: {} },
      fakeDeps({ probeInputMonitoring: async () => "unknown" })
    );
    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("blocked");
  });

  it("never loads uiohook to answer probe()", async () => {
    let loaded = false;
    const adapter = createMacosAdapter(
      { platform: "darwin", env: {} },
      fakeDeps({
        probeInputMonitoring: async () => "granted",
        loadUiohook: async () => {
          loaded = true;
          throw new Error("should never be called by probe()");
        }
      })
    );
    await adapter.selection.probe();
    expect(loaded).toBe(false);
  });
});

describe("createMacosAdapter — hotkey.register()", () => {
  function fakeUiohookModule() {
    const listeners = new Map<string, (e: unknown) => void>();
    let started = false;
    let stopped = false;
    const mod: UiohookModule = {
      uIOhook: {
        start: () => void (started = true),
        stop: () => void (stopped = true),
        on: (event, listener) => void listeners.set(event, listener as (e: unknown) => void),
        off: (event) => void listeners.delete(event),
        keyTap: () => undefined
      },
      UiohookKey: { J: 36 }
    };
    return {
      mod,
      fireKeydown: (e: Record<string, unknown>) => listeners.get("keydown")?.(e),
      isStarted: () => started,
      isStopped: () => stopped
    };
  }

  it("resolves ok:true and fires onTrigger on a matching key + modifier combo", async () => {
    const fake = fakeUiohookModule();
    const adapter = createMacosAdapter(
      { platform: "darwin", env: {} },
      fakeDeps({ loadUiohook: async () => fake.mod })
    );

    let fired = 0;
    const reg = await adapter.hotkey.register("cmd+alt+j", () => void fired++);

    expect(reg.ok).toBe(true);
    expect(fake.isStarted()).toBe(true);

    // Matching combo: keycode for "j" + meta + alt, no ctrl/shift.
    fake.fireKeydown({ keycode: 36, metaKey: true, altKey: true });
    expect(fired).toBe(1);

    // Non-matching: right keycode but missing a modifier.
    fake.fireKeydown({ keycode: 36, metaKey: true });
    expect(fired).toBe(1);

    // Non-matching: wrong keycode entirely.
    fake.fireKeydown({ keycode: 99, metaKey: true, altKey: true });
    expect(fired).toBe(1);

    await reg.dispose();
    expect(fake.isStopped()).toBe(true);
  });

  it("resolves ok:false with an Input Monitoring hint when uiohook fails to load", async () => {
    const adapter = createMacosAdapter(
      { platform: "darwin", env: {} },
      fakeDeps({
        loadUiohook: async () => {
          throw new Error("prebuild unavailable");
        }
      })
    );

    const reg = await adapter.hotkey.register("cmd+alt+j", () => undefined);

    expect(reg.ok).toBe(false);
    expect(reg.detail).toContain("Input Monitoring");
    expect(reg.detail).toContain("System Settings");
    expect(reg.detail).toContain("NOT Accessibility");
    // dispose() must stay safe to call even on a failed registration.
    await expect(reg.dispose()).resolves.toBeUndefined();
  });

  it("resolves ok:false gracefully with the REAL default deps in this environment (no uiohook-napi installed)", async () => {
    // No overrides at all: exercises the real lazy `import("uiohook-napi")`
    // path. This package genuinely is not installed in this environment, so
    // this proves the try/catch degrades honestly instead of crashing.
    const adapter = createMacosAdapter({ platform: "darwin", env: {} });
    const reg = await adapter.hotkey.register("cmd+alt+j", () => undefined);
    expect(reg.ok).toBe(false);
    expect(reg.detail).toContain("Input Monitoring");
    await reg.dispose();
  });
});

describe("parseAccelerator", () => {
  it("parses modifiers and the trigger key case-insensitively", () => {
    expect(parseAccelerator("cmd+alt+j")).toEqual({
      ctrl: false,
      alt: true,
      meta: true,
      shift: false,
      key: "J"
    });
    expect(parseAccelerator("Ctrl+Shift+G")).toEqual({
      ctrl: true,
      alt: false,
      meta: false,
      shift: true,
      key: "G"
    });
  });
});
