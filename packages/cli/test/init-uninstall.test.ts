// init/uninstall integration tests (TESTING.md "CLI tests"): temp-dir projects
// with fixture .claude/settings.json files. The commands run in-process (the
// unit under test is the command logic; nothing is mocked — real filesystem).

import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

describe("init — both settings targets (TESTING.md)", () => {
  for (const local of [false, true]) {
    const label = local ? "settings.local.json (--local)" : "settings.json (default)";
    it(`no file / unrelated hooks / idempotent re-run against ${label}`, async () => {
      const dir = makeProject();
      const home = makeHome();
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(
        settingsPath(dir, local),
        JSON.stringify({
          keep: true,
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo x" }] }] }
        })
      );
      await runInit({ projectDir: dir, homeDir: home, local });
      await runInit({ projectDir: dir, homeDir: home, local }); // idempotent
      const settings = readSettings(dir, local);
      expect(settings.keep).toBe(true);
      expect((settings.hooks as Record<string, unknown>).PreToolUse).toBeDefined();
      expect(glossEntries(settings)).toHaveLength(2);
      // The other target was never created.
      expect(existsSync(settingsPath(dir, !local))).toBe(false);
    });
  }
});

describe("init — /gloss command ownership", () => {
  it("never overwrites a user-authored /gloss command; uninstall keeps it", async () => {
    const dir = makeProject();
    mkdirSync(join(dir, ".claude", "commands"), { recursive: true });
    const userContent = "---\ndescription: my own gloss command\n---\n\ndo my thing\n";
    writeFileSync(join(dir, ".claude", "commands", "gloss.md"), userContent);

    await runInit({ projectDir: dir, homeDir: makeHome() });
    expect(readFileSync(join(dir, ".claude", "commands", "gloss.md"), "utf8")).toBe(userContent);

    await runUninstall({ projectDir: dir });
    expect(readFileSync(join(dir, ".claude", "commands", "gloss.md"), "utf8")).toBe(userContent);
  });
});

describe("init — projects registry hardening", () => {
  it("preserves a malformed registry as .bak instead of clobbering it", async () => {
    const dir = makeProject();
    const home = makeHome();
    mkdirSync(join(home, ".gloss"), { recursive: true });
    writeFileSync(join(home, ".gloss", "projects.json"), "{corrupt!");
    await runInit({ projectDir: dir, homeDir: home });

    const files = readdirSync(join(home, ".gloss"));
    expect(files.some((f) => f.startsWith("projects.json.bak-"))).toBe(true);
    const registry = JSON.parse(readFileSync(join(home, ".gloss", "projects.json"), "utf8")) as {
      projects: string[];
    };
    expect(registry.projects).toContain(dir);
  });
});

describe("uninstall", () => {
  it("sweeps a custom --settings-file target (mirror of init)", async () => {
    const dir = makeProject();
    const custom = join(dir, "custom-settings.json");
    await runInit({ projectDir: dir, homeDir: makeHome(), settingsFile: custom });
    expect(readFileSync(custom, "utf8")).toContain(GLOSS_HOOK_MARKER);

    await runUninstall({ projectDir: dir, settingsFile: custom });
    expect(readFileSync(custom, "utf8")).not.toContain(GLOSS_HOOK_MARKER);
  });

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
    // Gloss entries gone; unrelated keys intact. The emptied event arrays
    // remain as [] — uninstall never guesses whether a key predated init.
    expect(readSettings(dir)).toEqual({
      model: "opus",
      hooks: { UserPromptSubmit: [], SessionStart: [] }
    });
  });
});
