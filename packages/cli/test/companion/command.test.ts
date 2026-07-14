// runCompanion wiring (TERMINAL.md §8): select adapter → probe → start embedded
// server → build the flow → register the hotkey → (save fires notification).
// Exercised end-to-end with a SCRIPTED adapter (a scripted HotkeyRegistrar
// captures the trigger, so registration + disposal are covered WITHOUT loading
// uiohook-napi in CI) and the REAL panel server (the save path is real).

import { describe, expect, it, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCompanion, type CompanionHandle } from "../../src/companion/command.js";
import type { CaptureAdapter } from "../../src/companion/select.js";
import type { CaptureResult, NotifyMessage } from "../../src/companion/types.js";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "gloss-cmd-"));
}

/** A scripted adapter whose hotkey registrar exposes its trigger + disposal. */
function scriptedAdapter(cfg: {
  capture?: CaptureResult;
  probeSupport?: "available" | "blocked" | "unsupported";
  hotkeyOk?: boolean;
}) {
  let trigger: (() => void | Promise<void>) | undefined;
  let registeredAccel: string | undefined;
  let disposed = false;
  const adapter: CaptureAdapter = {
    selection: {
      origin: "scripted",
      probe: async () => ({ support: cfg.probeSupport ?? "available", detail: "scripted" }),
      capture: async () => cfg.capture ?? { status: "ok", text: "billing engine" }
    },
    hotkey: {
      origin: "scripted",
      register: async (accel, onTrigger) => {
        registeredAccel = accel;
        trigger = onTrigger;
        return {
          ok: cfg.hotkeyOk ?? true,
          detail: cfg.hotkeyOk === false ? "prebuild missing" : "",
          dispose: async () => {
            disposed = true;
          }
        };
      }
    }
  };
  return {
    adapter,
    fire: () => trigger?.(),
    accel: () => registeredAccel,
    disposed: () => disposed
  };
}

function recorders() {
  const opened: string[] = [];
  const notes: NotifyMessage[] = [];
  return {
    opener: { open: async (u: string) => void opened.push(u) },
    notifier: { notify: (m: NotifyMessage) => void notes.push(m) },
    opened,
    notes
  };
}

let handle: CompanionHandle | undefined;
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

describe("runCompanion", () => {
  it("registers the hotkey, opens the panel on trigger, and notifies on a real save", async () => {
    const r = recorders();
    const s = scriptedAdapter({ capture: { status: "ok", text: "billing engine" } });
    handle = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "linux", env: {} },
      adapter: s.adapter,
      opener: r.opener,
      notifier: r.notifier,
      log: () => undefined
    });

    expect(handle.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(s.accel()).toBe("ctrl+alt+j");

    // Simulate the global keypress.
    await s.fire();
    const url = new URL(r.opened[0]!);
    expect(url.searchParams.get("span")).toBe("billing engine");
    expect(url.searchParams.get("origin")).toBe("companion");

    // Simulate the panel saving through the real server route.
    const res = await fetch(`${handle.baseUrl}/api/cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: "xyz", body: "b", source: { span: "xyz", message: "m", origin: "companion" } })
    });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(r.notes.some((n) => n.kind === "saved")).toBe(true));
  });

  it("uses cmd+alt+j on macOS", async () => {
    const r = recorders();
    const s = scriptedAdapter({});
    handle = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "darwin", env: {} },
      adapter: s.adapter,
      opener: r.opener,
      notifier: r.notifier,
      log: () => undefined
    });
    expect(s.accel()).toBe("cmd+alt+j");
  });

  it("degrades to the CLI rung (no server) when no OS adapter applies", async () => {
    handle = await runCompanion({
      env: { platform: "aix" as NodeJS.Platform, env: {} },
      adapter: null,
      log: () => undefined
    });
    expect(handle.baseUrl).toBeNull();
  });

  it("degrades when the capture mechanism probes unsupported", async () => {
    const s = scriptedAdapter({ probeSupport: "unsupported" });
    handle = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "linux", env: {} },
      adapter: s.adapter,
      log: () => undefined
    });
    expect(handle.baseUrl).toBeNull();
  });

  it("does NOT default to cwd: no --project degrades with guidance, starts no server", async () => {
    const s = scriptedAdapter({});
    const lines: string[] = [];
    handle = await runCompanion({
      env: { platform: "linux", env: {} },
      adapter: s.adapter,
      log: (l) => lines.push(l)
    });
    expect(handle.baseUrl).toBeNull();
    expect(lines.join("\n")).toMatch(/--project/);
  });

  it("degrades and stops the server when the hotkey cannot be bound", async () => {
    const s = scriptedAdapter({ hotkeyOk: false });
    handle = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "linux", env: {} },
      adapter: s.adapter,
      log: () => undefined
    });
    // Server was started for the ephemeral port then torn down; no live handle.
    expect(handle.baseUrl).toBeNull();
  });

  it("disposes the hotkey registration and closes the server on stop()", async () => {
    const r = recorders();
    const s = scriptedAdapter({});
    const h = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "linux", env: {} },
      adapter: s.adapter,
      opener: r.opener,
      notifier: r.notifier,
      log: () => undefined
    });
    const baseUrl = h.baseUrl!;
    await h.stop();
    expect(s.disposed()).toBe(true);
    await expect(fetch(`${baseUrl}/api/cards`)).rejects.toThrow();
  });
});
