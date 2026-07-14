// add / log / doctor (TERMINAL.md §9.3/§9.4; TESTING.md "CLI tests").

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCardFile } from "@prompt-gloss/core";
import { runAdd } from "../src/commands/add.js";
import { runLog } from "../src/commands/log.js";
import { runDoctor } from "../src/commands/doctor.js";
import { runInit } from "../src/commands/init.js";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "gloss-cli-"));
}

describe("add", () => {
  it("writes a card identical in shape to a panel-created card, origin: cli", async () => {
    const dir = makeProject();
    await runAdd({
      projectDir: dir,
      term: "xyz",
      aliases: ["metrics panel"],
      body: "xyz is the metrics panel."
    });

    const text = readFileSync(join(dir, ".gloss", "cards", "xyz.md"), "utf8");
    const parsed = parseCardFile(text, "xyz");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card.term).toBe("xyz");
    expect(parsed.card.aliases).toEqual(["metrics panel"]);
    expect(parsed.card.body).toBe("xyz is the metrics panel.");
    expect(parsed.card.source.origin).toBe("cli");
    expect(parsed.card.source.span).toBe("xyz");
    expect(parsed.card.source.message).toBe("(created via prompt-gloss add)");
  });
});

describe("log", () => {
  it("renders the most recent injections from injections.jsonl", async () => {
    const dir = makeProject();
    mkdirSync(join(dir, ".gloss", ".state"), { recursive: true });
    const lines = [
      { ts: "2026-07-14T10:00:00.000Z", sessionId: "s1", promptId: "p1", slugs: ["xyz"] },
      { ts: "2026-07-14T11:00:00.000Z", sessionId: "s2", promptId: "p2", slugs: ["a", "b"] }
    ];
    writeFileSync(
      join(dir, ".gloss", ".state", "injections.jsonl"),
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
    );

    const out = await runLog({ projectDir: dir, count: 20 });
    expect(out).toContain("xyz");
    expect(out).toContain("a, b");
    expect(out).toContain("s2");
  });

  it("skips malformed lines and handles a missing log", async () => {
    const dir = makeProject();
    mkdirSync(join(dir, ".gloss", ".state"), { recursive: true });
    writeFileSync(
      join(dir, ".gloss", ".state", "injections.jsonl"),
      'garbage\n{"ts":"2026-07-14T10:00:00.000Z","sessionId":"s1","promptId":"p","slugs":["ok"]}\n'
    );
    expect(await runLog({ projectDir: dir, count: 5 })).toContain("ok");

    const empty = makeProject();
    expect(await runLog({ projectDir: empty, count: 5 })).toContain("no injections");
  });
});

describe("doctor", () => {
  it("flags a missing hook entry and a stale bundle; passes on a healthy install", async () => {
    const dir = makeProject();
    const sick = await runDoctor({ projectDir: dir });
    expect(sick.ok).toBe(false);
    expect(sick.report).toMatch(/hook file: MISSING/);
    expect(sick.report).toMatch(/settings entries: MISSING/);

    await runInit({ projectDir: dir, homeDir: mkdtempSync(join(tmpdir(), "gloss-home-")) });
    const healthy = await runDoctor({ projectDir: dir });
    expect(healthy.ok).toBe(true);

    // Stale bundle: file differs from the shipped one.
    writeFileSync(join(dir, ".gloss", "hook", "gloss-hook.cjs"), "stale");
    const stale = await runDoctor({ projectDir: dir });
    expect(stale.ok).toBe(false);
    expect(stale.report).toMatch(/STALE/);
  });
});
