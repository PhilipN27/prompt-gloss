// runCompanion wiring (TERMINAL.md §8): select adapter → probe → start embedded
// server (with the standalone /panel + picker routes) → build the flow →
// register the hotkey → (save fires notification). With no --project the
// companion starts a picker server and the first-hotkey picker page rebinds to
// the chosen project (§8.2). Exercised with a SCRIPTED adapter (a scripted
// HotkeyRegistrar captures the trigger, covering registration + disposal
// without uiohook-napi) and the REAL panel server (the save + picker routes
// are real).

import { describe, expect, it, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCompanion, type CompanionHandle } from "../../src/companion/command.js";
import type { CaptureAdapter } from "../../src/companion/select.js";
import type { CaptureResult, NotifyMessage } from "../../src/companion/types.js";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "gloss-cmd-"));
}

/** A temp home whose ~/.gloss/projects.json registers `projectDir`. */
function makeHomeWith(projectDir: string): string {
  const home = mkdtempSync(join(tmpdir(), "gloss-home-"));
  mkdirSync(join(home, ".gloss"), { recursive: true });
  writeFileSync(
    join(home, ".gloss", "projects.json"),
    JSON.stringify({ version: 1, projects: [projectDir] })
  );
  return home;
}

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
  return { adapter, fire: () => trigger?.(), accel: () => registeredAccel, disposed: () => disposed };
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

describe("runCompanion — explicit project", () => {
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

    await s.fire();
    const url = new URL(r.opened[0]!);
    expect(url.pathname).toBe("/panel");
    expect(url.searchParams.get("span")).toBe("billing engine");
    expect(url.searchParams.get("origin")).toBe("companion");
    expect(url.searchParams.has("pick")).toBe(false);

    const res = await fetch(`${handle.baseUrl}/api/cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: "xyz", body: "b", source: { span: "xyz", message: "m", origin: "companion" } })
    });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(r.notes.some((n) => n.kind === "saved")).toBe(true));
  });

  it("serves the standalone /panel card form (not a 404) for the captured span", async () => {
    const s = scriptedAdapter({});
    handle = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "linux", env: {} },
      adapter: s.adapter,
      log: () => undefined
    });
    const res = await fetch(`${handle.baseUrl}/panel?span=xyz&origin=companion`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("New context card");
  });

  it("uses cmd+alt+j on macOS", async () => {
    const s = scriptedAdapter({});
    handle = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "darwin", env: {} },
      adapter: s.adapter,
      log: () => undefined
    });
    expect(s.accel()).toBe("cmd+alt+j");
  });
});

describe("runCompanion — degradations", () => {
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

  it("degrades and stops the server when the hotkey cannot be bound", async () => {
    const s = scriptedAdapter({ hotkeyOk: false });
    handle = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "linux", env: {} },
      adapter: s.adapter,
      log: () => undefined
    });
    expect(handle.baseUrl).toBeNull();
  });

  it("disposes the hotkey registration and closes the server on stop()", async () => {
    const s = scriptedAdapter({});
    const h = await runCompanion({
      projectDir: makeProject(),
      env: { platform: "linux", env: {} },
      adapter: s.adapter,
      log: () => undefined
    });
    const baseUrl = h.baseUrl!;
    await h.stop();
    expect(s.disposed()).toBe(true);
    await expect(fetch(`${baseUrl}/api/cards`)).rejects.toThrow();
  });
});

describe("runCompanion — first-hotkey project picker (no --project)", () => {
  it("starts a picker server and opens the picker page (pick=1) on the first hotkey", async () => {
    const project = makeProject();
    const r = recorders();
    const s = scriptedAdapter({ capture: { status: "ok", text: "gateway" } });
    handle = await runCompanion({
      env: { platform: "linux", env: {} },
      homeDir: makeHomeWith(project),
      adapter: s.adapter,
      opener: r.opener,
      notifier: r.notifier,
      log: () => undefined
    });

    // The companion does NOT default to cwd — it starts a picker server instead.
    expect(handle.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    await s.fire();
    const url = new URL(r.opened[0]!);
    expect(url.pathname).toBe("/panel");
    expect(url.searchParams.get("pick")).toBe("1");
    expect(url.searchParams.get("span")).toBe("gateway");

    // The picker page lists the registered project.
    const page = await fetch(`${handle.baseUrl}/panel?pick=1&span=gateway`);
    expect(await page.text()).toContain(project);
  });

  it("rebinds to the chosen project: /api/companion/project returns its panel URL and later captures target it", async () => {
    const project = makeProject();
    const r = recorders();
    const s = scriptedAdapter({ capture: { status: "ok", text: "gateway" } });
    handle = await runCompanion({
      env: { platform: "linux", env: {} },
      homeDir: makeHomeWith(project),
      adapter: s.adapter,
      opener: r.opener,
      notifier: r.notifier,
      log: () => undefined
    });
    const pickerBase = handle.baseUrl!;

    const pick = await fetch(`${pickerBase}/api/companion/project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDir: project, span: "gateway", origin: "companion" })
    });
    expect(pick.status).toBe(200);
    const { panelUrl } = (await pick.json()) as { panelUrl: string };
    const projectUrl = new URL(panelUrl);
    expect(projectUrl.pathname).toBe("/panel");
    expect(projectUrl.searchParams.get("span")).toBe("gateway");
    expect(projectUrl.searchParams.has("pick")).toBe(false);

    // A card saved on the newly bound project server fires the notification.
    const save = await fetch(`${projectUrl.origin}/api/cards`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term: "gateway", body: "b", source: { span: "gateway", message: "m", origin: "companion" } })
    });
    expect(save.status).toBe(201);
    await vi.waitFor(() => expect(r.notes.some((n) => n.kind === "saved")).toBe(true));

    // Subsequent hotkeys now open the project panel directly (no picker).
    await s.fire();
    const next = new URL(r.opened.at(-1)!);
    expect(next.searchParams.has("pick")).toBe(false);
    expect(next.searchParams.get("span")).toBe("gateway");
  });
});
