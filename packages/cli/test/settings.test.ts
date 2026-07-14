// Settings merge/unmerge (TERMINAL.md §9.1/§9.2) — the highest-blast-radius
// code in Phase B: it edits the user's .claude/settings.json. Written before
// the implementation. Invariants: JSON is parsed (never regex-edited), every
// pre-existing key survives untouched, merge is idempotent, unmerge removes
// exactly the Gloss entries and nothing else.

import { describe, expect, it } from "vitest";
import {
  GLOSS_HOOK_MARKER,
  USER_PROMPT_SUBMIT_COMMAND,
  SESSION_START_COMMAND,
  mergeGlossEntries,
  removeGlossEntries
} from "../src/settings.js";

interface HookEntry {
  type: string;
  command: string;
}
interface HookGroup {
  hooks: HookEntry[];
}
interface Settings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

function glossCommands(settings: Settings, event: string): string[] {
  return (settings.hooks?.[event] ?? [])
    .flatMap((g) => g.hooks)
    .map((h) => h.command)
    .filter((c) => c.includes(GLOSS_HOOK_MARKER));
}

describe("mergeGlossEntries", () => {
  it("creates both event entries in an absent/empty settings file", () => {
    for (const input of [null, "{}"]) {
      const { text, changed } = mergeGlossEntries(input);
      expect(changed).toBe(true);
      const parsed = JSON.parse(text) as Settings;
      expect(glossCommands(parsed, "UserPromptSubmit")).toEqual([USER_PROMPT_SUBMIT_COMMAND]);
      expect(glossCommands(parsed, "SessionStart")).toEqual([SESSION_START_COMMAND]);
    }
  });

  it("preserves every pre-existing key and unrelated hook verbatim", () => {
    const existing = {
      permissions: { allow: ["Bash(npm:*)"], deny: [] },
      env: { FOO: "bar" },
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "echo unrelated" }] }
        ],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }]
      },
      model: "opus"
    };
    const { text } = mergeGlossEntries(JSON.stringify(existing));
    const parsed = JSON.parse(text) as Settings & typeof existing;

    expect(parsed.permissions).toEqual(existing.permissions);
    expect(parsed.env).toEqual(existing.env);
    expect(parsed.model).toBe("opus");
    expect(parsed.hooks.PreToolUse).toEqual(existing.hooks.PreToolUse);
    // The unrelated UserPromptSubmit hook survives alongside the Gloss one.
    const commands = (parsed.hooks.UserPromptSubmit as HookGroup[]).flatMap((g) =>
      g.hooks.map((h) => h.command)
    );
    expect(commands).toContain("echo unrelated");
    expect(commands).toContain(USER_PROMPT_SUBMIT_COMMAND);
  });

  it("is idempotent: merging twice adds nothing (changed=false)", () => {
    const once = mergeGlossEntries(null);
    const twice = mergeGlossEntries(once.text);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
    const parsed = JSON.parse(twice.text) as Settings;
    expect(glossCommands(parsed, "UserPromptSubmit")).toHaveLength(1);
    expect(glossCommands(parsed, "SessionStart")).toHaveLength(1);
  });

  it("detects a pre-existing Gloss entry by the hook-path substring, even with different quoting", () => {
    const existing = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "node $CLAUDE_PROJECT_DIR/.gloss/hook/gloss-hook.cjs" }
            ]
          }
        ]
      }
    };
    const { text } = mergeGlossEntries(JSON.stringify(existing));
    const parsed = JSON.parse(text) as Settings;
    // No duplicate UserPromptSubmit entry; SessionStart still added.
    expect(glossCommands(parsed, "UserPromptSubmit")).toHaveLength(1);
    expect(glossCommands(parsed, "SessionStart")).toHaveLength(1);
  });

  it("throws on malformed JSON instead of clobbering the file", () => {
    expect(() => mergeGlossEntries("{not json")).toThrow();
  });
});

describe("removeGlossEntries", () => {
  it("removes exactly the Gloss entries; unrelated hooks and keys survive", () => {
    const merged = mergeGlossEntries(
      JSON.stringify({
        permissions: { allow: ["Read"] },
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo unrelated" }] }]
        }
      })
    );
    const { text, changed } = removeGlossEntries(merged.text);
    expect(changed).toBe(true);
    const parsed = JSON.parse(text) as Settings;
    expect(parsed.permissions).toEqual({ allow: ["Read"] });
    expect(glossCommands(parsed, "UserPromptSubmit")).toEqual([]);
    expect(glossCommands(parsed, "SessionStart")).toEqual([]);
    const commands = (parsed.hooks?.UserPromptSubmit ?? []).flatMap((g) =>
      g.hooks.map((h) => h.command)
    );
    expect(commands).toEqual(["echo unrelated"]);
  });

  it("cleans up empty structures it created (no dangling hooks key)", () => {
    const merged = mergeGlossEntries(null);
    const { text } = removeGlossEntries(merged.text);
    const parsed = JSON.parse(text) as Settings;
    expect(parsed.hooks).toBeUndefined();
  });

  it("is a no-op on a file with no Gloss entries (changed=false)", () => {
    const input = JSON.stringify({ model: "opus" }, null, 2) + "\n";
    const { text, changed } = removeGlossEntries(input);
    expect(changed).toBe(false);
    expect(JSON.parse(text)).toEqual({ model: "opus" });
  });

  it("null input (missing file) is a no-op", () => {
    const { changed } = removeGlossEntries(null);
    expect(changed).toBe(false);
  });
});
