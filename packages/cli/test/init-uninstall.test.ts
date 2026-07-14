// init/uninstall integration tests (TESTING.md "CLI tests"): temp-dir projects
// with fixture .claude/settings.json files. The commands run in-process (the
// unit under test is the command logic; nothing is mocked — real filesystem).

import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { runUninstall } from "../src/commands/uninstall.js";
import {
  GLOSS_HOOK_MARKER,
  USER_PROMPT_SUBMIT_COMMAND,
  SESSION_START_COMMAND
} from "../src/settings.js";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "gloss-cli-"));
}

/** Fake home dir so ~/.gloss/projects.json never touches the real home. */
function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "gloss-home-"));
}

function settingsPath(dir: string, local = false): string {
  return join(dir, ".claude", local ? "settings.local.json" : "settings.json");
}

function readSettings(dir: string, local = false): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(dir, local), "utf8")) as Record<string, unknown>;
}

function glossEntries(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
  return Object.values(hooks)
    .flat()
    .flatMap((g) => g.hooks)
    .map((h) => h.command)
    .filter((c) => c.includes(GLOSS_HOOK_MARKER));
}

// The hook bundle is built by the `pnpm test:cli` script before vitest runs
// (same pattern as the hook-contract suite) — init's bundle-copy is real.

describe("init", () => {
  it("scaffolds .gloss/, copies the hook bundle, merges settings, writes /gloss command", async () => {
    const dir = makeProject();
    const home = makeHome();
    await runInit({ projectDir: dir, homeDir: home });

    expect(existsSync(join(dir, ".gloss", "cards"))).toBe(true);
    expect(existsSync(join(dir, ".gloss", "hook", "gloss-hook.cjs"))).toBe(true);
    expect(readFileSync(join(dir, ".gloss", ".state", ".gitignore"), "utf8")).toBe("*\n");
    expect(existsSync(join(dir, ".claude", "commands", "gloss.md"))).toBe(true);

    const settings = readSettings(dir);
    expect(glossEntries(settings).sort()).toEqual(
      [USER_PROMPT_SUBMIT_COMMAND, SESSION_START_COMMAND].sort()
    );

    const projects = JSON.parse(readFileSync(join(home, ".gloss", "projects.json"), "utf8")) as {
      projects: string[];
    };
    expect(projects.projects).toContain(dir);
  });

  it("preserves every pre-existing settings key (fixture with unrelated hooks)", async () => {
    const dir = makeProject();
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const existing = {
      permissions: { allow: ["Bash(git:*)"] },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] }] }
    };
    writeFileSync(settingsPath(dir), JSON.stringify(existing, null, 2));
    await runInit({ projectDir: dir, homeDir: makeHome() });

    const settings = readSettings(dir);
    expect(settings.permissions).toEqual(existing.permissions);
    expect((settings.hooks as Record<string, unknown>).PreToolUse).toEqual(existing.hooks.PreToolUse);
    expect(glossEntries(settings)).toHaveLength(2);
  });

  it("re-run is idempotent (entries exactly once) and refreshes the bundle", async () => {
    const dir = makeProject();
    const home = makeHome();
    await runInit({ projectDir: dir, homeDir: home });
    // Simulate a stale bundle, then re-init = upgrade.
    writeFileSync(join(dir, ".gloss", "hook", "gloss-hook.cjs"), "stale");
    await runInit({ projectDir: dir, homeDir: home });

    expect(glossEntries(readSettings(dir))).toHaveLength(2);
    expect(readFileSync(join(dir, ".gloss", "hook", "gloss-hook.cjs"), "utf8")).not.toBe("stale");
  });

  it("--local targets settings.local.json and leaves settings.json alone", async () => {
    const dir = makeProject();
    await runInit({ projectDir: dir, homeDir: makeHome(), local: true });
    expect(existsSync(settingsPath(dir))).toBe(false);
    expect(glossEntries(readSettings(dir, true))).toHaveLength(2);
  });

  it("--dry-run writes nothing", async () => {
    const dir = makeProject();
    const home = makeHome();
    await runInit({ projectDir: dir, homeDir: home, dryRun: true });
    expect(existsSync(join(dir, ".gloss", "hook"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(existsSync(join(home, ".gloss"))).toBe(false);
  });

  it("aborts without touching a malformed settings file", async () => {
    const dir = makeProject();
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(settingsPath(dir), "{broken");
    await expect(runInit({ projectDir: dir, homeDir: makeHome() })).rejects.toThrow();
    expect(readFileSync(settingsPath(dir), "utf8")).toBe("{broken");
  });
});

describe("uninstall", () => {
  it("mirrors init: sweeps both settings files, removes hook/.state/command, keeps cards", async () => {
    const dir = makeProject();
    const home = makeHome();
    await runInit({ projectDir: dir, homeDir: home });
    await runInit({ projectDir: dir, homeDir: home, local: true });
    // A user card that must survive.
    writeFileSync(join(dir, ".gloss", "cards", "xyz.md"), "---\nterm: xyz\n---\n\nbody\n");

    await runUninstall({ projectDir: dir });

    expect(glossEntries(readSettings(dir))).toEqual([]);
    expect(glossEntries(readSettings(dir, true))).toEqual([]);
    expect(existsSync(join(dir, ".gloss", "hook"))).toBe(false);
    expect(existsSync(join(dir, ".gloss", ".state"))).toBe(false);
    expect(existsSync(join(dir, ".claude", "commands", "gloss.md"))).toBe(false);
    expect(existsSync(join(dir, ".gloss", "cards", "xyz.md"))).toBe(true);
  });

  it("running it twice is a no-op", async () => {
    const dir = makeProject();
    await runInit({ projectDir: dir, homeDir: makeHome() });
    await runUninstall({ projectDir: dir });
    await expect(runUninstall({ projectDir: dir })).resolves.not.toThrow();
  });

  it("never touches unrelated settings keys", async () => {
    const dir = makeProject();
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify({ model: "opus" }, null, 2));
    await runInit({ projectDir: dir, homeDir: makeHome() });
    await runUninstall({ projectDir: dir });
    expect(readSettings(dir)).toEqual({ model: "opus" });
  });
});
