// Merge/unmerge of the Gloss hook entries in .claude/settings.json
// (TERMINAL.md §9.1/§9.2). JSON is parsed, never regex-edited; every other
// key is preserved verbatim; merge is idempotent (entries identified by the
// hook-path substring); unmerge removes exactly the Gloss entries and cleans
// up only structures left empty by that removal.

export const GLOSS_HOOK_MARKER = ".gloss/hook/gloss-hook.cjs";

export const USER_PROMPT_SUBMIT_COMMAND = `node "$CLAUDE_PROJECT_DIR/${GLOSS_HOOK_MARKER}"`;
export const SESSION_START_COMMAND = `${USER_PROMPT_SUBMIT_COMMAND} --session-start`;

interface HookEntry {
  type: string;
  command?: string;
  [key: string]: unknown;
}
interface HookGroup {
  hooks?: HookEntry[];
  [key: string]: unknown;
}
type Settings = Record<string, unknown>;

export interface EditResult {
  /** The full new file text (2-space indent, trailing newline). */
  text: string;
  changed: boolean;
}

const EVENTS: ReadonlyArray<[event: string, command: string]> = [
  ["UserPromptSubmit", USER_PROMPT_SUBMIT_COMMAND],
  ["SessionStart", SESSION_START_COMMAND]
];

/** Parse settings text; null/empty → {}. Malformed JSON throws — the caller
 * must abort rather than clobber a file it cannot understand. */
function parseSettings(text: string | null): Settings {
  if (text === null || text.trim().length === 0) return {};
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("settings file is not a JSON object");
  }
  return parsed as Settings;
}

function stringify(settings: Settings): string {
  return JSON.stringify(settings, null, 2) + "\n";
}

function groupsOf(settings: Settings, event: string): HookGroup[] | undefined {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  const groups = hooks?.[event];
  return Array.isArray(groups) ? (groups as HookGroup[]) : undefined;
}

function hasGlossEntry(groups: HookGroup[] | undefined): boolean {
  return (groups ?? []).some((g) =>
    (g.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(GLOSS_HOOK_MARKER))
  );
}

/** Add the Gloss UserPromptSubmit + SessionStart entries (idempotent). */
export function mergeGlossEntries(text: string | null): EditResult {
  const settings = parseSettings(text);
  let changed = false;

  for (const [event, command] of EVENTS) {
    if (hasGlossEntry(groupsOf(settings, event))) continue;
    const hooks = (settings.hooks ??= {}) as Record<string, unknown>;
    const groups = (hooks[event] ??= []) as HookGroup[];
    groups.push({ hooks: [{ type: "command", command }] });
    changed = true;
  }

  return { text: stringify(settings), changed };
}

/** Remove every hook entry whose command references the Gloss hook path,
 * across all events; drop only the structures that removal left empty. */
export function removeGlossEntries(text: string | null): EditResult {
  if (text === null) return { text: "", changed: false };
  const settings = parseSettings(text);
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks || typeof hooks !== "object") {
    return { text: stringify(settings), changed: false };
  }

  let changed = false;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    let removedHere = false;
    const kept = (groups as HookGroup[])
      .map((g) => {
        if (!Array.isArray(g.hooks)) return g;
        const entries = g.hooks.filter(
          (h) => !(typeof h.command === "string" && h.command.includes(GLOSS_HOOK_MARKER))
        );
        if (entries.length !== g.hooks.length) removedHere = true;
        return entries.length !== g.hooks.length ? { ...g, hooks: entries } : g;
      })
      .filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
    if (!removedHere) continue; // Untouched event — leave its structure alone.
    changed = true;
    if (kept.length > 0) {
      hooks[event] = kept;
    } else {
      delete hooks[event];
    }
  }
  if (changed && Object.keys(hooks).length === 0) delete settings.hooks;

  return { text: stringify(settings), changed };
}
