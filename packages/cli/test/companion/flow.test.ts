// The capture-flow state machine (TERMINAL.md §8.2/§8.3): hotkey → capture →
// (toast on retryable/blocked/unsupported | open panel on ok) → the user saves
// via the real server route → OS notification. Only the OS boundaries are
// faked: the SelectionSource (input) and the PanelOpener/Notifier (output).
// The URL construction, the embedded server route, and the store all run real
// (TESTING.md "Companion tests" + the boundary rule).

import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "@prompt-gloss/server";
import { CaptureFlow } from "../../src/companion/flow.js";
import type {
  CaptureResult,
  NotifyMessage,
  PanelEndpoints,
  ProjectResolution,
  SelectionSource
} from "../../src/companion/types.js";

const ENDPOINTS: PanelEndpoints = {
  baseUrl: "http://127.0.0.1:9999",
  panelPath: "/panel",
  pickerPath: "/panel"
};

function scriptedSelection(result: CaptureResult | (() => Promise<CaptureResult>)): SelectionSource {
  return {
    origin: "scripted",
    probe: async () => ({ support: "available", detail: "scripted" }),
    capture: typeof result === "function" ? result : async () => result
  };
}

function recorders() {
  const opened: string[] = [];
  const notes: NotifyMessage[] = [];
  return {
    opener: { open: async (url: string) => void opened.push(url) },
    notifier: { notify: (m: NotifyMessage) => void notes.push(m) },
    opened,
    notes
  };
}

const project = (dir: string): { resolve: () => Promise<ProjectResolution> } => ({
  resolve: async () => ({ kind: "project", dir })
});
const picker = (): { resolve: () => Promise<ProjectResolution> } => ({
  resolve: async () => ({ kind: "picker" })
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("CaptureFlow.onHotkey", () => {
  it("ok + configured project: opens the panel URL with an encoded span and origin=companion", async () => {
    const r = recorders();
    const flow = new CaptureFlow({
      selection: scriptedSelection({ status: "ok", text: "billing engine" }),
      projects: project("/some/proj"),
      opener: r.opener,
      notifier: r.notifier,
      endpoints: ENDPOINTS
    });

    await flow.onHotkey();

    expect(r.opened).toHaveLength(1);
    const url = new URL(r.opened[0]!);
    expect(url.origin + url.pathname).toBe("http://127.0.0.1:9999/panel");
    expect(url.searchParams.get("span")).toBe("billing engine"); // decoded round-trip
    expect(url.searchParams.get("origin")).toBe("companion");
    expect(url.searchParams.has("pick")).toBe(false);
    expect(r.notes).toEqual([]); // a successful open is silent
  });

  it("ok + no project configured: opens the picker page (pick=1) carrying the span", async () => {
    const r = recorders();
    const flow = new CaptureFlow({
      selection: scriptedSelection({ status: "ok", text: "gateway" }),
      projects: picker(),
      opener: r.opener,
      notifier: r.notifier,
      endpoints: ENDPOINTS
    });

    await flow.onHotkey();

    expect(r.opened).toHaveLength(1);
    const url = new URL(r.opened[0]!);
    expect(url.pathname).toBe("/panel");
    expect(url.searchParams.get("pick")).toBe("1");
    expect(url.searchParams.get("span")).toBe("gateway");
  });

  it("retryable: toasts the hint and does not open the panel (stays armed)", async () => {
    const r = recorders();
    const flow = new CaptureFlow({
      selection: scriptedSelection({
        status: "retryable",
        reason: "stale-clipboard",
        hint: "Copy your selection first (Ctrl+Shift+C), then press the hotkey."
      }),
      projects: project("/p"),
      opener: r.opener,
      notifier: r.notifier,
      endpoints: ENDPOINTS
    });

    await flow.onHotkey();

    expect(r.opened).toEqual([]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]!.kind).toBe("retryable");
    expect(r.notes[0]!.text).toContain("Ctrl+Shift+C");
  });

  it("blocked: toasts the remediation and does not open the panel", async () => {
    const r = recorders();
    const flow = new CaptureFlow({
      selection: scriptedSelection({
        status: "blocked",
        reason: "permission-denied",
        remediation: "Grant Input Monitoring in System Settings › Privacy & Security.",
        restartRequired: true
      }),
      projects: project("/p"),
      opener: r.opener,
      notifier: r.notifier,
      endpoints: ENDPOINTS
    });

    await flow.onHotkey();

    expect(r.opened).toEqual([]);
    expect(r.notes[0]!.kind).toBe("blocked");
    expect(r.notes[0]!.text).toContain("Input Monitoring");
  });

  it("unsupported: toasts and points at the CLI rung; does not open the panel", async () => {
    const r = recorders();
    const flow = new CaptureFlow({
      selection: scriptedSelection({
        status: "unsupported",
        reason: "xclip/xsel not found",
        fallback: "cli"
      }),
      projects: project("/p"),
      opener: r.opener,
      notifier: r.notifier,
      endpoints: ENDPOINTS
    });

    await flow.onHotkey();

    expect(r.opened).toEqual([]);
    expect(r.notes[0]!.kind).toBe("unsupported");
    expect(r.notes[0]!.text.toLowerCase()).toContain("prompt-gloss add");
  });

  it("never crashes the daemon: a thrown capture is swallowed and toasted as an error", async () => {
    const r = recorders();
    const flow = new CaptureFlow({
      selection: scriptedSelection(async () => {
        throw new Error("uiohook died");
      }),
      projects: project("/p"),
      opener: r.opener,
      notifier: r.notifier,
      endpoints: ENDPOINTS
    });

    await expect(flow.onHotkey()).resolves.toBeUndefined();
    expect(r.opened).toEqual([]);
    expect(r.notes[0]!.kind).toBe("error");
  });

  it("ignores a re-entrant hotkey while a capture is already in flight", async () => {
    const r = recorders();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((res) => (release = res));
    const flow = new CaptureFlow({
      selection: scriptedSelection(async () => {
        await gate;
        return { status: "ok", text: "xyz" };
      }),
      projects: project("/p"),
      opener: r.opener,
      notifier: r.notifier,
      endpoints: ENDPOINTS
    });

    const first = flow.onHotkey();
    const second = flow.onHotkey(); // should be dropped — a capture is in flight
    release!();
    await Promise.all([first, second]);

    expect(r.opened).toHaveLength(1); // not 2
  });
});

describe("CaptureFlow.onCardSaved via the real server route", () => {
  it("fires a 'saved' notification when the panel POSTs a card to the embedded server", async () => {
    const r = recorders();
    const projectDir = mkdtempSync(join(tmpdir(), "gloss-flow-"));
    const flow = new CaptureFlow({
      selection: scriptedSelection({ status: "ok", text: "xyz" }),
      projects: project(projectDir),
      opener: r.opener,
      notifier: r.notifier,
      endpoints: ENDPOINTS
    });

    // The real server, wired exactly as the companion wires it.
    app = await buildServer(
      { projectDir, fakeAgent: true },
      { onCardSaved: (e) => flow.onCardSaved(e) }
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/cards",
      payload: { term: "xyz", body: "the metrics panel", source: { span: "xyz", message: "m", origin: "companion" } }
    });

    expect(res.statusCode).toBe(201);
    const saved = r.notes.find((n) => n.kind === "saved");
    expect(saved).toBeDefined();
    expect(saved!.text).toContain("xyz");
  });
});
