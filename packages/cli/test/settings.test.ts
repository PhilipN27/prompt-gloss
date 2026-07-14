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
    .flatMap((g) => (g && Array.isArray(g.hooks) ? g.hooks : []))
    .map((h) => h?.command)
    .filter((c): c is string => typeof c === "string" && c.includes(GLOSS_HOOK_MARKER));
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

  it("preserves untouched bytes verbatim: formatting, unicode escapes, key order", () => {
    const original = '{\n    "caf\\u00e9" :  "\\u006fpus",\n    "zzz": 1,\n    "aaa": 2\n}\n';
    const { text } = mergeGlossEntries(original);
    // The original content survives byte-for-byte (only the hooks edit is new).
    expect(text).toContain('"caf\\u00e9" :  "\\u006fpus"');
    expect(text.indexOf('"zzz"')).toBeLessThan(text.indexOf('"aaa"'));
    const parsed = JSON.parse(text) as Settings;
    expect(parsed["café"]).toBe("opus");
  });

  it("refuses to edit a settings file whose hooks key has an unexpected shape", () => {
    expect(() => mergeGlossEntries('{"hooks": []}')).toThrow(/unexpected shape/);
    expect(() => mergeGlossEntries('{"hooks": "user-data"}')).toThrow(/unexpected shape/);
    expect(() => mergeGlossEntries('{"hooks": {"UserPromptSubmit": {"hooks": []}}}')).toThrow(
      /not an array/
    );
  });

  it("detects an exec-form Gloss entry (args array) as already installed", () => {
    const existing = {
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "node", args: ["/p/.gloss/hook/gloss-hook.cjs"] }
            ]
          }
        ]
      }
    };
    const { text } = mergeGlossEntries(JSON.stringify(existing));
    const parsed = JSON.parse(text) as Settings;
    expect(parsed.hooks?.UserPromptSubmit).toHaveLength(1);
  });

  it("tolerates null groups and null hook entries without crashing", () => {
    const weird = '{"hooks": {"UserPromptSubmit": [null, {"hooks": [null]}]}}';
    const merged = mergeGlossEntries(weird);
    const parsed = JSON.parse(merged.text) as Settings;
    expect(glossCommands(parsed, "UserPromptSubmit")).toEqual([USER_PROMPT_SUBMIT_COMMAND]);
    expect(() => removeGlossEntries(merged.text)).not.toThrow();
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

  it("leaves emptied event arrays as [] (never guesses whether the key predated init)", () => {
    const merged = mergeGlossEntries(null);
    const { text } = removeGlossEntries(merged.text);
    const parsed = JSON.parse(text) as Settings;
    expect(parsed.hooks).toEqual({ UserPromptSubmit: [], SessionStart: [] });
    expect(glossCommands(parsed, "UserPromptSubmit")).toEqual([]);
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

  it("merge-then-unmerge restores the original semantics; untouched regions keep their bytes", () => {
    const original =
      '{\n  "model" :  "opus",\n  "hooks": {\n    "UserPromptSubmit": [],\n    "PreToolUse": [{"hooks": [{"type": "command", "command": "echo x"}]}]\n  }\n}\n';
    const merged = mergeGlossEntries(original);
    const removed = removeGlossEntries(merged.text);
    // Semantic restore: the original document, plus the harmless empty
    // SessionStart array left by the keep-empty-arrays policy.
    const expected = JSON.parse(original) as { hooks: Record<string, unknown> };
    expected.hooks.SessionStart = [];
    expect(JSON.parse(removed.text)).toEqual(expected);
    // Regions no edit ever touched keep their original bytes (odd spacing intact).
    expect(removed.text).toContain('"model" :  "opus"');
  });

  it("never touches other events, even if their commands mention the marker path", () => {
    const original = JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { hooks: [{ type: "command", command: "echo missing: .gloss/hook/gloss-hook.cjs" }] }
          ]
        }
      },
      null,
      2
    );
    const { text, changed } = removeGlossEntries(original);
    expect(changed).toBe(false);
    expect(text).toBe(original);
  });

  it("removes an exec-form Gloss entry under the managed events", () => {
    const original = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          { hooks: [{ type: "command", command: "node", args: ["/p/.gloss/hook/gloss-hook.cjs"] }] }
        ]
      }
    });
    const { text, changed } = removeGlossEntries(original);
    expect(changed).toBe(true);
    expect(JSON.parse(text)).toEqual({ hooks: { UserPromptSubmit: [] } });
  });

  it("preserves matcher metadata on a group that keeps non-Gloss entries", () => {
    const original = JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "compact",
            hooks: [
              { type: "command", command: "echo keep" },
              { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.gloss/hook/gloss-hook.cjs" --session-start' }
            ]
          }
        ]
      }
    });
    const { text } = removeGlossEntries(original);
    const parsed = JSON.parse(text) as {
      hooks: { SessionStart: Array<{ matcher?: string; hooks: Array<{ command: string }> }> };
    };
    expect(parsed.hooks.SessionStart[0]!.matcher).toBe("compact");
    expect(parsed.hooks.SessionStart[0]!.hooks.map((h) => h.command)).toEqual(["echo keep"]);
  });
});
