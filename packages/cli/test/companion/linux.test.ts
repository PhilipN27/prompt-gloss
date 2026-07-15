// Linux capture adapter (TERMINAL.md §2.4/§8.2): X11 PRIMARY (no keystroke)
// and the Wayland hotkey-first decision tree (portal bind -> prefer
// background PRIMARY -> else clipboard-freshness fallback -> unbindable
// hotkey is always unsupported). Every shell-out / portal call / uiohook
// loader is faked here — no real X11, Wayland, D-Bus, or uiohook-napi.

import { describe, expect, it, vi } from "vitest";
import {
  createLinuxAdapter,
  createDefaultLinuxDeps,
  GLOSS_SHORTCUT_ID,
  type LinuxAdapterDeps,
  type CommandResult,
  type RunCommand
} from "../../src/companion/adapters/linux.js";
import type { AdapterEnv } from "../../src/companion/select.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const OK = (stdout: string): CommandResult => ({ kind: "ok", stdout, stderr: "", exitCode: 0 });
const NOT_FOUND: CommandResult = { kind: "not-found", stdout: "", stderr: "", exitCode: null };
const ERROR = (stderr = "boom"): CommandResult => ({ kind: "error", stdout: "", stderr, exitCode: 1 });

/** Maps an exact `cmd arg1 arg2 …` key to a fixed result or a sequence
 *  (returned in order, then the last value repeats). Unmapped commands
 *  resolve `not-found` — the safe "nothing is installed" default. */
function makeRun(table: Record<string, CommandResult | CommandResult[]>): RunCommand {
  const counters = new Map<string, number>();
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const entry = table[key];
    if (!entry) return NOT_FOUND;
    if (!Array.isArray(entry)) return entry;
    const i = counters.get(key) ?? 0;
    counters.set(key, i + 1);
    return entry[Math.min(i, entry.length - 1)]!;
  };
}

function baseDeps(overrides: Partial<LinuxAdapterDeps> = {}): LinuxAdapterDeps {
  return {
    run: makeRun({}),
    boundedWatch: async () => ({ staysAlive: false }),
    portalBind: async () => ({ boundShortcutIds: [], detail: "not bound" }),
    portalCheckAdvertised: async () => false,
    portalWatch: async () => ({ ok: true, dispose: async () => undefined }),
    loadUiohook: async () => {
      throw new Error("uiohook not available in tests");
    },
    now: () => 0,
    ...overrides
  };
}

const X11_ENV: AdapterEnv = { platform: "linux", env: { DISPLAY: ":0" } };
const WAYLAND_ENV: AdapterEnv = { platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } };

// ---------------------------------------------------------------------------
// createDefaultLinuxDeps — sanity only (no real subprocess/portal work here)
// ---------------------------------------------------------------------------

describe("createDefaultLinuxDeps", () => {
  it("returns a fully-populated real deps object", () => {
    const deps = createDefaultLinuxDeps();
    expect(typeof deps.run).toBe("function");
    expect(typeof deps.boundedWatch).toBe("function");
    expect(typeof deps.portalBind).toBe("function");
    expect(typeof deps.portalCheckAdvertised).toBe("function");
    expect(typeof deps.portalWatch).toBe("function");
    expect(typeof deps.loadUiohook).toBe("function");
    expect(typeof deps.now()).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// OS detection
// ---------------------------------------------------------------------------

describe("createLinuxAdapter — OS detection", () => {
  it("selects the X11 adapter when WAYLAND_DISPLAY is unset and DISPLAY is set", () => {
    const adapter = createLinuxAdapter(X11_ENV, baseDeps());
    expect(adapter.selection.origin).toBe("x11-primary");
    expect(adapter.hotkey.origin).toBe("x11-uiohook");
  });

  it("selects the Wayland adapter when WAYLAND_DISPLAY is set", () => {
    const adapter = createLinuxAdapter(WAYLAND_ENV, baseDeps());
    expect(adapter.selection.origin).toBe("wayland-primary");
    expect(adapter.hotkey.origin).toBe("wayland-portal");
  });
});

// ---------------------------------------------------------------------------
// X11 — SelectionSource
// ---------------------------------------------------------------------------

describe("X11 SelectionSource.capture()", () => {
  it("ok: reads a non-empty PRIMARY via xclip", async () => {
    const deps = baseDeps({
      run: makeRun({
        "xclip -version": OK(""),
        "xclip -o -selection primary": OK("billing engine")
      })
    });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    await expect(adapter.selection.capture()).resolves.toEqual({ status: "ok", text: "billing engine" });
  });

  it("retryable/empty-selection: PRIMARY is empty", async () => {
    const deps = baseDeps({
      run: makeRun({
        "xclip -version": OK(""),
        "xclip -o -selection primary": OK("   \n  ")
      })
    });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    await expect(adapter.selection.capture()).resolves.toEqual({
      status: "retryable",
      reason: "empty-selection",
      hint: "Select text first, then press the hotkey."
    });
  });

  it("retryable/empty-selection: xclip errors (no PRIMARY owner) reads as empty, not a crash", async () => {
    const deps = baseDeps({
      run: makeRun({
        "xclip -version": OK(""),
        "xclip -o -selection primary": ERROR("Error: target STRING not available")
      })
    });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    const result = await adapter.selection.capture();
    expect(result.status).toBe("retryable");
  });

  it("falls back to xsel when xclip is not installed", async () => {
    const deps = baseDeps({
      run: makeRun({
        "xclip -version": NOT_FOUND,
        "xsel --version": OK(""),
        "xsel -p": OK("from xsel")
      })
    });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    await expect(adapter.selection.capture()).resolves.toEqual({ status: "ok", text: "from xsel" });
  });

  it("unsupported: neither xclip nor xsel is installed", async () => {
    const deps = baseDeps({ run: makeRun({}) });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    await expect(adapter.selection.capture()).resolves.toEqual({
      status: "unsupported",
      reason: "xclip/xsel not installed",
      fallback: "cli"
    });
  });
});

describe("X11 SelectionSource.probe()", () => {
  it("available when xclip or xsel is present (non-prompting)", async () => {
    const deps = baseDeps({ run: makeRun({ "xclip -version": OK("") }) });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    await expect(adapter.selection.probe()).resolves.toEqual({
      support: "available",
      detail: "X11 PRIMARY selection"
    });
  });

  it("unsupported with an install remediation when neither tool exists", async () => {
    const deps = baseDeps({ run: makeRun({}) });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("unsupported");
    expect(cap.remediation).toContain("xclip or xsel");
  });
});

// ---------------------------------------------------------------------------
// X11 — HotkeyRegistrar (uiohook-napi, lazily loaded)
// ---------------------------------------------------------------------------

describe("X11 HotkeyRegistrar.register()", () => {
  it("resolves ok:false with a doctor hint when uiohook-napi fails to load", async () => {
    const deps = baseDeps({
      loadUiohook: async () => {
        throw new Error("prebuild missing");
      }
    });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    const reg = await adapter.hotkey.register("ctrl+alt+j", () => undefined);
    expect(reg.ok).toBe(false);
    expect(reg.detail).toContain("uiohook-napi");
    await expect(reg.dispose()).resolves.toBeUndefined();
  });

  it("fires onTrigger only for a matching keydown chord, and dispose() stops listening", async () => {
    type Listener = (e: {
      keycode: number;
      ctrlKey?: boolean;
      altKey?: boolean;
      shiftKey?: boolean;
      metaKey?: boolean;
    }) => void;
    let listener: Listener | undefined;
    const stop = vi.fn();
    const removeListener = vi.fn();
    const deps = baseDeps({
      loadUiohook: async () => ({
        uIOhook: {
          start: vi.fn(),
          stop,
          on: (_event: "keydown", cb: Listener) => {
            listener = cb;
          },
          removeListener
        },
        UiohookKey: { J: 36 }
      })
    });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    const onTrigger = vi.fn();
    const reg = await adapter.hotkey.register("ctrl+alt+j", onTrigger);
    expect(reg.ok).toBe(true);
    expect(listener).toBeDefined();

    listener!({ keycode: 36, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // Non-matching chord (missing alt) does not fire.
    listener!({ keycode: 36, ctrlKey: true, altKey: false });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // Non-matching keycode does not fire.
    listener!({ keycode: 99, ctrlKey: true, altKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    await reg.dispose();
    expect(stop).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalled();
  });

  it("resolves ok:false for an unrecognized accelerator key", async () => {
    const deps = baseDeps({
      loadUiohook: async () => ({
        uIOhook: { start: vi.fn(), stop: vi.fn(), on: vi.fn() },
        UiohookKey: { J: 36 }
      })
    });
    const adapter = createLinuxAdapter(X11_ENV, deps);
    const reg = await adapter.hotkey.register("ctrl+alt+doesnotexist", () => undefined);
    expect(reg.ok).toBe(false);
    expect(reg.detail).toContain("Unrecognized accelerator");
  });
});

// ---------------------------------------------------------------------------
// Wayland — hotkey-first decision tree
// ---------------------------------------------------------------------------

describe("Wayland HotkeyRegistrar.register()", () => {
  it("ok:false when the portal does not bind our shortcut", async () => {
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [], detail: "user declined" })
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    const reg = await adapter.hotkey.register("ctrl+alt+j", () => undefined);
    expect(reg.ok).toBe(false);
    expect(reg.detail).toContain("did not bind");
  });

  it("ok:false when the portal returns a subset that excludes our shortcut id (not a bound state)", async () => {
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: ["some-other-shortcut"], detail: "bound something else" })
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    const reg = await adapter.hotkey.register("ctrl+alt+j", () => undefined);
    expect(reg.ok).toBe(false);
  });

  it("ok:false when bound but the activation watcher fails to start", async () => {
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound" }),
      portalWatch: async () => ({ ok: false, dispose: async () => undefined })
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    const reg = await adapter.hotkey.register("ctrl+alt+j", () => undefined);
    expect(reg.ok).toBe(false);
    expect(reg.detail).toContain("watcher failed to start");
  });

  it("ok:true when bound and the watcher starts; forwards Activated events to onTrigger", async () => {
    let capturedTrigger: (() => void) | undefined;
    const disposeWatch = vi.fn(async () => undefined);
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound ctrl+alt+j" }),
      portalWatch: async (_id, onTrigger) => {
        capturedTrigger = onTrigger;
        return { ok: true, dispose: disposeWatch };
      }
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    const onTrigger = vi.fn();
    const reg = await adapter.hotkey.register("ctrl+alt+j", onTrigger);
    expect(reg.ok).toBe(true);

    capturedTrigger!();
    expect(onTrigger).toHaveBeenCalledTimes(1);

    await reg.dispose();
    expect(disposeWatch).toHaveBeenCalled();
  });
});

describe("Wayland SelectionSource.capture() — hotkey-first decision tree", () => {
  it("not-bound -> unsupported, regardless of clipboard capability (register() never called)", async () => {
    const deps = baseDeps({
      boundedWatch: async () => ({ staysAlive: true }), // PRIMARY would be functional...
      run: makeRun({ "wl-paste --no-newline": OK("some clipboard text") }) // ...clipboard would work too
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    const result = await adapter.selection.capture();
    expect(result).toEqual({
      status: "unsupported",
      reason: expect.stringContaining("not bound"),
      fallback: "cli"
    });
  });

  it("not-bound -> unsupported after an explicit failed register() too", async () => {
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [], detail: "declined" })
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    await adapter.hotkey.register("ctrl+alt+j", () => undefined);
    const result = await adapter.selection.capture();
    expect(result.status).toBe("unsupported");
  });

  it("bound + functional PRIMARY: reads PRIMARY, no clipboard fallback used", async () => {
    const run = makeRun({
      "wl-paste --version": OK(""),
      "wl-paste --primary --no-newline": OK("primary selection text")
    });
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound" }),
      boundedWatch: async () => ({ staysAlive: true }),
      run
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    await adapter.hotkey.register("ctrl+alt+j", () => undefined);

    const result = await adapter.selection.capture();
    expect(result).toEqual({ status: "ok", text: "primary selection text" });
  });

  it("bound + functional PRIMARY but currently empty: retryable/empty-selection (does not fall back to clipboard)", async () => {
    const run = makeRun({
      "wl-paste --primary --no-newline": OK(""),
      "wl-paste --no-newline": OK("some unrelated clipboard content")
    });
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound" }),
      boundedWatch: async () => ({ staysAlive: true }),
      run
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    await adapter.hotkey.register("ctrl+alt+j", () => undefined);

    const result = await adapter.selection.capture();
    expect(result).toEqual({
      status: "retryable",
      reason: "empty-selection",
      hint: "Select text first, then press the hotkey."
    });
  });

  it("bound + PRIMARY unsupported: falls back to clipboard freshness and accepts a changed clipboard", async () => {
    const run = makeRun({
      // arm-read (creation) then the first fallback read see a changed value.
      "wl-paste --no-newline": [OK("old-clip"), OK("freshly copied text")]
    });
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound" }),
      boundedWatch: async () => ({ staysAlive: false }), // PRIMARY protocol unsupported
      run,
      now: () => 1000
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    await adapter.hotkey.register("ctrl+alt+j", () => undefined);

    const result = await adapter.selection.capture();
    expect(result).toEqual({ status: "ok", text: "freshly copied text" });
  });

  it("bound + PRIMARY unsupported: rejects a stale (unchanged) clipboard on the fallback path", async () => {
    const run = makeRun({
      "wl-paste --no-newline": OK("same-old-text") // identical on every read
    });
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound" }),
      boundedWatch: async () => ({ staysAlive: false }),
      run,
      now: () => 1000
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    await adapter.hotkey.register("ctrl+alt+j", () => undefined);

    const result = await adapter.selection.capture();
    expect(result.status).toBe("retryable");
    if (result.status === "retryable") {
      expect(result.reason).toBe("stale-clipboard");
    }
  });

  it("bound + PRIMARY unsupported + empty clipboard: retryable/empty-selection", async () => {
    const run = makeRun({ "wl-paste --no-newline": OK("   ") });
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound" }),
      boundedWatch: async () => ({ staysAlive: false }),
      run,
      now: () => 1000
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    await adapter.hotkey.register("ctrl+alt+j", () => undefined);

    const result = await adapter.selection.capture();
    expect(result.status).toBe("retryable");
    if (result.status === "retryable") {
      expect(result.reason).toBe("empty-selection");
    }
  });
});

describe("Wayland SelectionSource.probe() — rich, non-prompting doctor detail", () => {
  it("before register(): reports advertised-but-unverified when the portal interface exists, without binding", async () => {
    const portalBind = vi.fn(async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound" }));
    const deps = baseDeps({
      portalCheckAdvertised: async () => true,
      boundedWatch: async () => ({ staysAlive: true }),
      portalBind
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("available");
    expect(cap.detail).toContain("advertised-but-unverified");
    expect(portalBind).not.toHaveBeenCalled(); // probe() never prompts
  });

  it("reports unsupported with a remediation when the portal is not advertised at all", async () => {
    const deps = baseDeps({ portalCheckAdvertised: async () => false });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("unsupported");
    expect(cap.detail).toContain("global-hotkey: unavailable");
    expect(cap.remediation).toBeDefined();
  });

  it("after a successful register(): reports the cached 'bound' fact instead of re-checking advertisement", async () => {
    const portalCheckAdvertised = vi.fn(async () => true);
    const deps = baseDeps({
      portalCheckAdvertised,
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound ctrl+alt+j" }),
      boundedWatch: async () => ({ staysAlive: true }),
      run: makeRun({ "wl-paste --primary --no-newline": OK("x") })
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    await adapter.hotkey.register("ctrl+alt+j", () => undefined);

    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("available");
    expect(cap.detail).toContain("global-hotkey: bound");
    expect(portalCheckAdvertised).not.toHaveBeenCalled();
  });

  it("bound but no PRIMARY and no clipboard tool: unsupported (no read mechanism)", async () => {
    const deps = baseDeps({
      portalBind: async () => ({ boundShortcutIds: [GLOSS_SHORTCUT_ID], detail: "bound" }),
      boundedWatch: async () => ({ staysAlive: false }),
      run: makeRun({}) // wl-paste --version -> not-found
    });
    const adapter = createLinuxAdapter(WAYLAND_ENV, deps);
    await adapter.hotkey.register("ctrl+alt+j", () => undefined);

    const cap = await adapter.selection.probe();
    expect(cap.support).toBe("unsupported");
    expect(cap.detail).toContain("no read mechanism");
  });
});
