// Merge/unmerge of the Gloss hook entries in .claude/settings.json
// (TERMINAL.md §9.1/§9.2). Edits are applied as surgical text patches via
// jsonc-parser (the library VS Code uses for exactly this job), so every byte
// the edit does not touch — formatting, key order, unicode escapes, unrelated
// keys — is preserved verbatim. JSON is parsed, never regex-edited; merge is
// idempotent (entries identified by the hook-path marker anywhere in the
// entry, covering shell- and exec-form); unmerge sweeps ONLY the two events
// init writes and removes only what it identifies as Gloss's.

import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export const GLOSS_HOOK_MARKER = ".gloss/hook/gloss-hook.cjs";

export const USER_PROMPT_SUBMIT_COMMAND = `node "$CLAUDE_PROJECT_DIR/${GLOSS_HOOK_MARKER}"`;
export const SESSION_START_COMMAND = `${USER_PROMPT_SUBMIT_COMMAND} --session-start`;

type Settings = Record<string, unknown>;

export interface EditResult {
  /** The full new file text; byte-identical to the input outside the edits. */
  text: string;
  changed: boolean;
}

const EVENTS: ReadonlyArray<[event: string, command: string]> = [
  ["UserPromptSubmit", USER_PROMPT_SUBMIT_COMMAND],
  ["SessionStart", SESSION_START_COMMAND]
];

const FORMAT = {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" }
};

/** An entry/group belongs to Gloss if the marker path appears anywhere in its
 * serialized form — covers shell-form `command` strings and exec-form `args`
 * arrays alike. */
function isGloss(value: unknown): boolean {
  return JSON.stringify(value)?.includes(GLOSS_HOOK_MARKER) ?? false;
}

/** Strict parse: malformed JSON or a non-object root throws — callers abort
 * rather than touch a file they cannot understand. */
function parseStrict(text: string): Settings {
  const errors: ParseError[] = [];
  const root = parse(text, errors, { allowTrailingComma: false }) as unknown;
  if (errors.length > 0) throw new Error("settings file is not valid JSON");
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    throw new Error("settings file is not a JSON object");
  }
  return root as Settings;
}

/** hooks must be absent or an object of event → group[]; anything else is a
 * shape this tool refuses to edit (fix the file manually). */
function hooksOf(settings: Settings): Record<string, unknown> | undefined {
  const hooks = settings.hooks;
  if (hooks === undefined) return undefined;
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error(
      'the "hooks" key in the settings file has an unexpected shape — fix it manually, then re-run'
    );
  }
  return hooks as Record<string, unknown>;
}

function eventGroups(
  hooks: Record<string, unknown> | undefined,
  event: string
): unknown[] | undefined {
  const groups = hooks?.[event];
  if (groups === undefined) return undefined;
  if (!Array.isArray(groups)) {
    throw new Error(
      `the hooks.${event} value in the settings file is not an array — fix it manually, then re-run`
    );
  }
  return groups;
}

/** Add the Gloss UserPromptSubmit + SessionStart entries (idempotent). */
export function mergeGlossEntries(text: string | null): EditResult {
  if (text === null || text.trim().length === 0) {
    const fresh: Settings = {
      hooks: Object.fromEntries(
        EVENTS.map(([event, command]) => [event, [{ hooks: [{ type: "command", command }] }]])
      )
    };
    return { text: JSON.stringify(fresh, null, 2) + "\n", changed: true };
  }

  let out = text;
  let changed = false;
  for (const [event, command] of EVENTS) {
    const settings = parseStrict(out);
    const groups = eventGroups(hooksOf(settings), event);
    if ((groups ?? []).some(isGloss)) continue; // already installed — idempotent
    const index = groups?.length ?? 0;
    const edits = modify(
      out,
      ["hooks", event, index],
      { hooks: [{ type: "command", command }] },
      { ...FORMAT, isArrayInsertion: true }
    );
    out = applyEdits(out, edits);
    changed = true;
  }
  return { text: out, changed };
}

/**
 * Remove the Gloss entries from the two events init writes — and only those
 * events, so an unrelated hook elsewhere that merely mentions the marker path
 * is never touched. A group that contained only Gloss entries (and no other
 * keys) is dropped; a mixed group keeps its other entries and metadata. An
 * event array emptied by removal is kept as `[]` rather than deleted — we
 * cannot know whether the key predated init, and leaving a harmless empty
 * array beats deleting a user's key. An event with no Gloss entries is not
 * rewritten at all (byte-identical).
 *
 * Note: array-element removal is replaced by whole-array value replacement —
 * jsonc-parser's modify() produces corrupt output when deleting the last
 * element of a nested array (verified against 3.3.1).
 */
export function removeGlossEntries(text: string | null): EditResult {
  if (text === null) return { text: "", changed: false };

  let out = text;
  let changed = false;
  for (const [event] of EVENTS) {
    const settings = parseStrict(out);
    let groups: unknown[] | undefined;
    try {
      groups = eventGroups(hooksOf(settings), event);
    } catch {
      continue; // unexpected shape — leave it alone rather than crash uninstall
    }
    if (!groups) continue;

    let removed = false;
    const kept: unknown[] = [];
    for (const group of groups) {
      if (group !== null && typeof group === "object" && !Array.isArray(group)) {
        const g = group as Record<string, unknown>;
        if (Array.isArray(g.hooks)) {
          const remaining = g.hooks.filter((h) => !isGloss(h));
          if (remaining.length !== g.hooks.length) {
            removed = true;
            const onlyHooksKey = Object.keys(g).every((k) => k === "hooks");
            if (remaining.length === 0 && onlyHooksKey) continue; // Gloss-only group
            kept.push({ ...g, hooks: remaining });
            continue;
          }
        }
      }
      kept.push(group);
    }
    if (!removed) continue;
    changed = true;
    out = applyEdits(out, modify(out, ["hooks", event], kept, FORMAT));
  }
  return { text: out, changed };
}
