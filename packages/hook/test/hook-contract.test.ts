// Hook contract tests (TESTING.md "Hook contract tests") — written before the
// implementation. Each case spawns the real built bundle against a temp-dir
// fixture. Run via `pnpm test:hook` (which builds the bundle first).

import { describe, expect, it } from "vitest";
import {
  existsSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
  mkdirSync
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import {
  makeProject,
  promptPayload,
  sessionStartPayload,
  runHook,
  runHookConcurrent,
  writeCard
} from "./helpers.js";

function stateDir(projectDir: string): string {
  return join(projectDir, ".gloss", ".state");
}

// Mirrors the bundle's naming: sanitized id + 8-char sha256 of the raw id,
// so lossy sanitization can never merge two sessions' dedup state.
function sessionFile(projectDir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 8);
  return join(stateDir(projectDir), "sessions", `${safe}-${hash}.json`);
}

describe("match → contract", () => {
  it("emits the exact stdout JSON contract with exit 0", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz", body: "xyz is the metrics panel." });
    const res = runHook(dir, JSON.stringify(promptPayload(dir, "wire xyz in")));

    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["hookSpecificOutput", "systemMessage"]);
    const hso = out.hookSpecificOutput as Record<string, unknown>;
    expect(hso.hookEventName).toBe("UserPromptSubmit");
    const ctx = hso.additionalContext as string;
    // Snapshot-locked <gloss-context> wrapper — exact string, so any format
    // drift (or smuggled extra text) is a visible test failure.
    expect(ctx).toBe(
      [
        "<gloss-context>",
        "The user has attached the following context cards to terms in their message.",
        "Treat them as authoritative background provided by the user.",
        '<card term="xyz" file=".gloss/cards/xyz.md">',
        "xyz is the metrics panel.",
        "</card>",
        "</gloss-context>"
      ].join("\n")
    );
    expect(out.systemMessage).toBe("Gloss: injected 1 card (xyz)");
  });

  it("names all injected slugs in systemMessage", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz", updated: "2026-07-13T02:00:00.000Z" });
    writeCard(dir, { slug: "billing-engine", term: "billing engine" });
    const res = runHook(
      dir,
      JSON.stringify(promptPayload(dir, "wire xyz into the billing engine"))
    );
    const out = JSON.parse(res.stdout) as { systemMessage: string };
    expect(out.systemMessage).toBe("Gloss: injected 2 cards (xyz, billing-engine)");
  });
});

describe("no match → silence", () => {
  it("prints nothing and exits 0", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    const res = runHook(dir, JSON.stringify(promptPayload(dir, "nothing relevant")));
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });
});

describe("session dedup across invocations", () => {
  it("injects once per session; state lands in sessions/<session_id>.json", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    const payload = JSON.stringify(promptPayload(dir, "about xyz"));

    const first = runHook(dir, payload);
    expect(first.stdout).not.toBe("");

    const state = JSON.parse(
      readFileSync(sessionFile(dir, "sess-default"), "utf8")
    ) as { version: number; injected: Record<string, string> };
    expect(state.version).toBe(1);
    expect(Object.keys(state.injected)).toEqual(["xyz"]);

    const second = runHook(dir, payload);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe("");
  });

  it("re-injects after the card's updated bumps", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz", updated: "2026-07-13T00:00:00.000Z" });
    const payload = JSON.stringify(promptPayload(dir, "about xyz"));
    runHook(dir, payload);

    writeCard(dir, { slug: "xyz", updated: "2026-07-14T00:00:00.000Z" });
    const second = runHook(dir, payload);
    expect(second.stdout).not.toBe("");
  });

  it("a different session_id injects fresh", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")));
    const other = runHook(
      dir,
      JSON.stringify(promptPayload(dir, "about xyz", { session_id: "sess-other" }))
    );
    expect(other.stdout).not.toBe("");
    expect(existsSync(sessionFile(dir, "sess-other"))).toBe(true);
  });

  it("leaves no tmp files behind (atomic tmp+rename)", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")));
    const files = readdirSync(join(stateDir(dir), "sessions"));
    expect(files).toEqual([basename(sessionFile(dir, "sess-default"))]);
  });

  it("session ids that sanitize identically never share dedup state", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    const a = runHook(dir, JSON.stringify(promptPayload(dir, "about xyz", { session_id: "a/b" })));
    const b = runHook(dir, JSON.stringify(promptPayload(dir, "about xyz", { session_id: "a?b" })));
    // Both sessions inject fresh — no filename collision.
    expect(a.stdout).not.toBe("");
    expect(b.stdout).not.toBe("");
    expect(readdirSync(join(stateDir(dir), "sessions"))).toHaveLength(2);
  });

  it("a state file with an unknown schema version is treated as empty (fresh inject)", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz", updated: "2026-07-13T00:00:00.000Z" });
    mkdirSync(join(stateDir(dir), "sessions"), { recursive: true });
    writeFileSync(
      sessionFile(dir, "sess-default"),
      JSON.stringify({ version: 999, injected: { xyz: "2026-07-13T00:00:00.000Z" } })
    );
    const res = runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")));
    expect(res.stdout).not.toBe("");
  });

  it("a session state file containing JSON null is treated as empty (fresh inject)", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    mkdirSync(join(stateDir(dir), "sessions"), { recursive: true });
    writeFileSync(sessionFile(dir, "sess-default"), "null");
    const res = runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")));
    expect(res.status).toBe(0);
    expect(res.stdout).not.toBe("");
  });

  it("self-gitignores .gloss/.state when the hook creates it", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")));
    expect(readFileSync(join(stateDir(dir), ".gitignore"), "utf8")).toBe("*\n");
  });
});

describe("budget + cap", () => {
  it("packs under the v1 budget rules (most-recently-updated wins)", () => {
    const dir = makeProject();
    // Two cards of ~1500 tokens each: only one fits the default 2000 budget.
    writeCard(dir, {
      slug: "older",
      updated: "2026-07-13T00:00:00.000Z",
      body: "o".repeat(6000)
    });
    writeCard(dir, {
      slug: "newer",
      updated: "2026-07-14T00:00:00.000Z",
      body: "n".repeat(6000)
    });
    const res = runHook(
      dir,
      JSON.stringify(promptPayload(dir, "about older and newer")),
      { env: { GLOSS_CARD_CAP: "1600" } }
    );
    const out = JSON.parse(res.stdout) as { systemMessage: string };
    expect(out.systemMessage).toBe("Gloss: injected 1 card (newer)");
  });

  it("clamps the final payload at 9,500 chars with the truncation marker", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz", body: "x".repeat(40000) });
    const res = runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")), {
      env: { GLOSS_INJECT_BUDGET: "20000", GLOSS_CARD_CAP: "15000" }
    });
    const out = JSON.parse(res.stdout) as {
      hookSpecificOutput: { additionalContext: string };
    };
    const ctx = out.hookSpecificOutput.additionalContext;
    expect(ctx.length).toBeLessThanOrEqual(9500);
    expect(ctx).toContain("…[truncated by Gloss]");
    expect(ctx.endsWith("</gloss-context>")).toBe(true);
  });
});

describe("never break the prompt", () => {
  it("malformed stdin JSON → empty stdout, exit 0, error logged", () => {
    const dir = makeProject();
    const res = runHook(dir, "this is not json{");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    const log = readFileSync(join(stateDir(dir), "hook-errors.log"), "utf8");
    expect(log.length).toBeGreaterThan(0);
  });

  it("missing .gloss/ → empty stdout, exit 0", () => {
    const dir = makeProject();
    // A project dir with no .gloss at all:
    const bare = join(dir, "bare");
    mkdirSync(bare);
    const res = runHook(bare, JSON.stringify(promptPayload(bare, "about xyz")));
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("corrupted session state file → empty stdout, exit 0, error logged", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    mkdirSync(join(stateDir(dir), "sessions"), { recursive: true });
    writeFileSync(sessionFile(dir, "sess-default"), "{corrupt json!!");
    const res = runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")));
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    const log = readFileSync(join(stateDir(dir), "hook-errors.log"), "utf8");
    expect(log.length).toBeGreaterThan(0);
  });

  it("never exits 2 even on garbage argv + garbage stdin", () => {
    const dir = makeProject();
    const res = runHook(dir, "garbage", { args: ["--unknown-flag"] });
    expect(res.status).toBe(0);
  });
});

describe("skip switch (GLOSS_SKIP_HOOK=1, both modes)", () => {
  it("UserPromptSubmit: empty stdout, exit 0, no state/log write", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    const res = runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")), {
      env: { GLOSS_SKIP_HOOK: "1" }
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(existsSync(stateDir(dir))).toBe(false);
  });

  it("checked before parsing stdin (garbage stdin still exits clean, no error log)", () => {
    const dir = makeProject();
    const res = runHook(dir, "not json at all", { env: { GLOSS_SKIP_HOOK: "1" } });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(existsSync(stateDir(dir))).toBe(false);
  });

  it("--session-start: no framing additionalContext either", () => {
    const dir = makeProject();
    const res = runHook(dir, JSON.stringify(sessionStartPayload(dir)), {
      env: { GLOSS_SKIP_HOOK: "1" },
      args: ["--session-start"]
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(existsSync(stateDir(dir))).toBe(false);
  });
});

describe("concurrent append", () => {
  it("two simultaneous hook processes → both jsonl records intact, both session files valid", async () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    const results = await runHookConcurrent(dir, [
      JSON.stringify(promptPayload(dir, "about xyz", { session_id: "sess-a" })),
      JSON.stringify(promptPayload(dir, "about xyz", { session_id: "sess-b" }))
    ]);
    for (const r of results) expect(r.status).toBe(0);

    const lines = readFileSync(join(stateDir(dir), "injections.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l) as { sessionId: string; slugs: string[] });
    expect(parsed.map((p) => p.sessionId).sort()).toEqual(["sess-a", "sess-b"]);
    for (const p of parsed) expect(p.slugs).toEqual(["xyz"]);

    for (const id of ["sess-a", "sess-b"]) {
      const state = JSON.parse(readFileSync(sessionFile(dir, id), "utf8")) as {
        injected: Record<string, string>;
      };
      expect(Object.keys(state.injected)).toEqual(["xyz"]);
    }
  });
});

describe("SessionStart mode", () => {
  it("returns the framing additionalContext", () => {
    const dir = makeProject();
    const res = runHook(dir, JSON.stringify(sessionStartPayload(dir)), {
      args: ["--session-start"]
    });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("<gloss-context>");
  });

  it("prunes sessions/*.json older than 30 days and keeps fresh ones", () => {
    const dir = makeProject();
    const sessions = join(stateDir(dir), "sessions");
    mkdirSync(sessions, { recursive: true });
    const oldFile = join(sessions, "sess-old.json");
    const freshFile = join(sessions, "sess-fresh.json");
    writeFileSync(oldFile, "{}");
    writeFileSync(freshFile, "{}");
    const fortyDaysAgo = (Date.now() - 40 * 24 * 3600 * 1000) / 1000;
    utimesSync(oldFile, fortyDaysAgo, fortyDaysAgo);

    runHook(dir, JSON.stringify(sessionStartPayload(dir)), {
      args: ["--session-start"]
    });
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(freshFile)).toBe(true);
  });

  it("trims injections.jsonl beyond 1,000 lines, keeping the most recent", () => {
    const dir = makeProject();
    mkdirSync(stateDir(dir), { recursive: true });
    const jsonl = join(stateDir(dir), "injections.jsonl");
    const lines = Array.from({ length: 1200 }, (_, i) =>
      JSON.stringify({ ts: "t", sessionId: `s${i}`, promptId: "p", slugs: [] })
    );
    writeFileSync(jsonl, lines.join("\n") + "\n");

    runHook(dir, JSON.stringify(sessionStartPayload(dir)), {
      args: ["--session-start"]
    });
    const kept = readFileSync(jsonl, "utf8").split("\n").filter((l) => l.length > 0);
    expect(kept).toHaveLength(1000);
    expect(kept[0]).toContain("s200");
    expect(kept[999]).toContain("s1199");
  });
});

describe("injection log", () => {
  it("every injection appends one jsonl line with ts/sessionId/promptId/slugs", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    runHook(dir, JSON.stringify(promptPayload(dir, "about xyz")));

    const lines = readFileSync(join(stateDir(dir), "injections.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(rec.sessionId).toBe("sess-default");
    expect(rec.promptId).toBe("prompt-1");
    expect(rec.slugs).toEqual(["xyz"]);
    expect(typeof rec.ts).toBe("string");
  });

  it("no injection → no jsonl line", () => {
    const dir = makeProject();
    writeCard(dir, { slug: "xyz" });
    runHook(dir, JSON.stringify(promptPayload(dir, "unrelated")));
    expect(existsSync(join(stateDir(dir), "injections.jsonl"))).toBe(false);
  });
});
