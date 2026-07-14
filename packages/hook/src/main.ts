// The Gloss Claude Code hook (TERMINAL.md §4): stdin JSON → match → file-backed
// session dedup → budget pack → 9,500-char clamp → stdout JSON. Also handles
// `--session-start` (framing + state pruning). Failure policy is absolute: any
// error → log to .gloss/.state/hook-errors.log, print nothing, exit 0. Exit
// code 2 is forbidden — it erases the user's prompt (§2.1).
//
// Built by esbuild into a single CJS bundle (dist/gloss-hook.cjs); the entry
// wraps an async main — no top-level await (CJS output).

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  CardStore,
  InjectionLog,
  matchMessage,
  packInjection,
  DEFAULT_BUDGET,
  type BudgetOptions,
  type Card
} from "@prompt-gloss/core";

/** Hard clamp under Claude Code's 10,000-char hook-output cap (§4.1). */
const MAX_PAYLOAD_CHARS = 9500;
/** Wrapper/join overhead reserved outside the per-card token math. */
const WRAPPER_RESERVE_CHARS = 300;
/**
 * The 9,500-char clamp, applied as a token-budget ceiling rather than a string
 * slice (council with Codex, 2026-07-14): estimateTokens = ceil(chars/4), so a
 * pack whose budget and cardCap are capped at (9500-300)/4 = 2300 tokens can
 * never serialize past 9,500 chars — and packInjection's own per-card
 * truncation marker handles "truncate the last card", keeping injectedSlugs,
 * dedup state, and systemMessage truthful (no silently dropped cards).
 */
const MAX_PACK_TOKENS = Math.floor((MAX_PAYLOAD_CHARS - WRAPPER_RESERVE_CHARS) / 4);
/**
 * The per-card cap sits below the budget ceiling by a header margin: a card
 * truncated exactly at the cap still carries its <card …> header inside the
 * same block, and a block that exceeds the budget is skipped outright — so
 * cap === budget would make a clamped oversized card silently vanish.
 */
const CARD_HEADER_MARGIN_TOKENS = 75;

/** Same framing v1 delivers via systemPrompt append (§4.3). */
const SESSION_START_FRAMING =
  "When a message includes a <gloss-context> block, treat each <card> inside it " +
  "as authoritative background the user attached to a term in their message. It " +
  "is not part of their visible prompt.";

const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const INJECTIONS_MAX_LINES = 1000;

interface HookPayload {
  session_id: string;
  cwd?: string;
  prompt_id?: string;
  prompt?: string;
}

function stateDir(projectDir: string): string {
  return join(projectDir, ".gloss", ".state");
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** Budget knobs: .gloss/config.json { injectBudget?, cardCap? }, env overrides. */
function resolveBudget(projectDir: string): BudgetOptions {
  let budget = DEFAULT_BUDGET.budget;
  let cardCap = DEFAULT_BUDGET.cardCap;
  try {
    const raw = readFileSync(join(projectDir, ".gloss", "config.json"), "utf8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (typeof config.injectBudget === "number" && config.injectBudget > 0) {
      budget = config.injectBudget;
    }
    if (typeof config.cardCap === "number" && config.cardCap > 0) {
      cardCap = config.cardCap;
    }
  } catch {
    // Optional file — absent or malformed means defaults.
  }
  const envBudget = Number(process.env.GLOSS_INJECT_BUDGET);
  if (Number.isFinite(envBudget) && envBudget > 0) budget = envBudget;
  const envCap = Number(process.env.GLOSS_CARD_CAP);
  if (Number.isFinite(envCap) && envCap > 0) cardCap = envCap;
  // A raised budget can never trip Claude Code's 10,000-char output cap.
  return {
    budget: Math.min(budget, MAX_PACK_TOKENS),
    cardCap: Math.min(cardCap, MAX_PACK_TOKENS - CARD_HEADER_MARGIN_TOKENS)
  };
}

function sessionFilePath(projectDir: string, sessionId: string): string {
  // session_id comes from Claude Code (a UUID), but never trust it as a path.
  // The hash suffix keys the file to the RAW id, so lossy sanitization (or a
  // case-insensitive filesystem, or a DOS-reserved basename) can never merge
  // two distinct sessions' dedup state.
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 8);
  return join(stateDir(projectDir), "sessions", `${safe}-${hash}.json`);
}

/** Create .gloss/.state, self-gitignored (TERMINAL.md §4.2) — the hook may be
 * the first writer in a project where the store never created it. */
function ensureStateDir(projectDir: string): void {
  const dir = stateDir(projectDir);
  mkdirSync(dir, { recursive: true });
  const gitignore = join(dir, ".gitignore");
  try {
    writeFileSync(gitignore, "*\n", { flag: "wx" });
  } catch {
    // Already present — fine.
  }
}

/** Missing file → empty log. Unparseable JSON → throw (catch-all handles it). */
function loadSessionLog(path: string): InjectionLog {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return new InjectionLog();
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // Unknown schema version → start fresh (worst case one duplicate injection).
  if (parsed.version !== 1) return new InjectionLog();
  return InjectionLog.fromJSON(parsed.injected);
}

/** Atomic write: same-dir tmp file + rename (§4.2). */
function saveSessionLog(projectDir: string, path: string, log: InjectionLog): void {
  ensureStateDir(projectDir);
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const doc = {
    version: 1,
    updatedAt: new Date().toISOString(),
    injected: log.toJSON()
  };
  writeFileSync(tmp, JSON.stringify(doc));
  renameSync(tmp, path);
}

/**
 * Defensive backstop only — the MAX_PACK_TOKENS ceiling makes this
 * mathematically unreachable; if it ever fires, drop the payload entirely
 * (silence beats corrupt markup reaching the model).
 */
function withinCap(payload: string): boolean {
  return payload.length <= MAX_PAYLOAD_CHARS;
}

function logInjection(projectDir: string, payload: HookPayload, slugs: string[]): void {
  const record = {
    ts: new Date().toISOString(),
    // Clamp ids so a record always stays under the atomic small-write
    // threshold that makes single-call appends torn-line-safe (§4.2).
    sessionId: payload.session_id.slice(0, 200),
    promptId: (payload.prompt_id ?? "").slice(0, 200),
    slugs
  };
  ensureStateDir(projectDir);
  // One line per record in a SINGLE appendFileSync call (O_APPEND) so
  // concurrent hook processes never interleave partial lines (§4.2).
  appendFileSync(join(stateDir(projectDir), "injections.jsonl"), JSON.stringify(record) + "\n");
}

async function runUserPromptSubmit(payload: HookPayload, projectDir: string): Promise<void> {
  const prompt = payload.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) return;
  if (typeof payload.session_id !== "string" || payload.session_id.length === 0) return;

  const store = new CardStore(projectDir);
  const index = await store.buildIndex();
  const slugs = matchMessage(prompt, index);
  if (slugs.length === 0) return;

  const cards: Card[] = [];
  for (const slug of slugs) {
    const card = await store.get(slug);
    if (card) cards.push(card);
  }

  const sessionPath = sessionFilePath(projectDir, payload.session_id);
  const log = loadSessionLog(sessionPath);
  const packed = packInjection(cards, log, resolveBudget(projectDir));
  if (packed.injectedSlugs.length === 0 || !withinCap(packed.payload)) return;

  saveSessionLog(projectDir, sessionPath, log);
  // Best-effort: a broken audit log must not swallow the injection itself
  // (dedup state is already committed — losing the emission too would
  // permanently dedup a card that never reached the model).
  try {
    logInjection(projectDir, payload, packed.injectedSlugs);
  } catch (err) {
    logError(projectDir, err);
  }

  const noun = packed.injectedSlugs.length === 1 ? "card" : "cards";
  const output = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: packed.payload
    },
    systemMessage: `Gloss: injected ${packed.injectedSlugs.length} ${noun} (${packed.injectedSlugs.join(", ")})`
  };
  process.stdout.write(JSON.stringify(output));
}

/** §4.2 cleanup: prune stale session files, trim the injections log. */
function pruneState(projectDir: string): void {
  const sessions = join(stateDir(projectDir), "sessions");
  let files: string[] = [];
  try {
    files = readdirSync(sessions);
  } catch {
    files = [];
  }
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;
  for (const file of files) {
    const path = join(sessions, file);
    try {
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
    } catch {
      // Racing session file — leave it.
    }
  }

  const jsonl = join(stateDir(projectDir), "injections.jsonl");
  try {
    const lines = readFileSync(jsonl, "utf8").split("\n").filter((l) => l.length > 0);
    if (lines.length > INJECTIONS_MAX_LINES) {
      const kept = lines.slice(-INJECTIONS_MAX_LINES).join("\n") + "\n";
      const tmp = `${jsonl}.${process.pid}.tmp`;
      writeFileSync(tmp, kept);
      renameSync(tmp, jsonl);
    }
  } catch {
    // Absent log — nothing to trim.
  }
}

function runSessionStart(projectDir: string): void {
  pruneState(projectDir);
  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: SESSION_START_FRAMING
    }
  };
  process.stdout.write(JSON.stringify(output));
}

async function main(): Promise<void> {
  // The coexistence switch (§4.5): checked before ANY parse, state, or log
  // write, for both event modes. The v1 web app's SdkInjector arms this so the
  // file hook never double-injects inside SDK sessions.
  if (process.env.GLOSS_SKIP_HOOK === "1") return;

  const stdin = await readStdin();
  const payload = JSON.parse(stdin) as HookPayload;
  const projectDir =
    typeof payload.cwd === "string" && payload.cwd.length > 0
      ? payload.cwd
      : process.cwd();

  try {
    if (process.argv.includes("--session-start")) {
      runSessionStart(projectDir);
    } else {
      await runUserPromptSubmit(payload, projectDir);
    }
  } catch (err) {
    logError(projectDir, err);
  }
}

function logError(projectDir: string, err: unknown): void {
  try {
    ensureStateDir(projectDir);
    // Truncated: V8 parse errors quote their input, and this file must never
    // accumulate prompt text (privacy) or grow without bound.
    const detail = (err instanceof Error ? (err.stack ?? err.message) : String(err)).slice(0, 500);
    appendFileSync(
      join(stateDir(projectDir), "hook-errors.log"),
      `${new Date().toISOString()} ${detail}\n`
    );
  } catch {
    // Even error logging must never break the prompt.
  }
}

main().catch((err: unknown) => {
  // Errors before the project dir is known (unreadable/unparseable stdin):
  // best-effort log against the process cwd, still exit 0.
  logError(process.cwd(), err);
  process.exitCode = 0;
});
