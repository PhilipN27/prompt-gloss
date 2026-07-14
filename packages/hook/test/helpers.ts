// Test helpers for the hook-contract suite (TESTING.md "Hook contract tests").
// Every test spawns the REAL built bundle (dist/gloss-hook.cjs) as a child
// process against a temp-dir .gloss/ fixture — the artifact that ships is the
// unit under test.

import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "gloss-hook.cjs"
);

/** Fresh temp project dir with a .gloss/cards/ fixture. */
export function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "gloss-hook-"));
  mkdirSync(join(dir, ".gloss", "cards"), { recursive: true });
  return dir;
}

export interface FixtureCard {
  slug: string;
  term?: string;
  aliases?: string[];
  updated?: string;
  body?: string;
}

/** Write a card file as literal text (no dependency on core's serializer). */
export function writeCard(projectDir: string, card: FixtureCard): void {
  const term = card.term ?? card.slug;
  const updated = card.updated ?? "2026-07-13T00:00:00.000Z";
  const aliases = (card.aliases ?? []).map((a) => `  - ${a}`).join("\n");
  const text = [
    "---",
    `term: ${term}`,
    ...(aliases ? ["aliases:", aliases] : []),
    "created: '2026-07-13T00:00:00.000Z'",
    `updated: '${updated}'`,
    "scope: project",
    "source:",
    `  span: ${term}`,
    "  message: fixture",
    "---",
    "",
    card.body ?? `${term} is a fixture card body.`,
    ""
  ].join("\n");
  writeFileSync(join(projectDir, ".gloss", "cards", `${card.slug}.md`), text);
}

/** The stdin payload shape captured from the live CLI probe (TERMINAL.md §2.1). */
export function promptPayload(
  projectDir: string,
  prompt: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    session_id: "sess-default",
    transcript_path: join(projectDir, "transcript.jsonl"),
    cwd: projectDir,
    prompt_id: "prompt-1",
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit",
    prompt,
    ...overrides
  };
}

export function sessionStartPayload(
  projectDir: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    session_id: "sess-default",
    transcript_path: join(projectDir, "transcript.jsonl"),
    cwd: projectDir,
    hook_event_name: "SessionStart",
    source: "startup",
    ...overrides
  };
}

export interface RunOptions {
  env?: Record<string, string>;
  args?: string[];
}

/** Run the built bundle synchronously with the given stdin. */
export function runHook(
  projectDir: string,
  stdin: string,
  opts: RunOptions = {}
): SpawnSyncReturns<string> {
  const env = { ...process.env, ...opts.env };
  delete (env as Record<string, unknown>).GLOSS_SKIP_HOOK;
  if (opts.env?.GLOSS_SKIP_HOOK) env.GLOSS_SKIP_HOOK = opts.env.GLOSS_SKIP_HOOK;
  return spawnSync(process.execPath, [BUNDLE, ...(opts.args ?? [])], {
    cwd: projectDir,
    input: stdin,
    encoding: "utf8",
    env
  });
}

/** Run two hook invocations concurrently; resolve with both results. */
export function runHookConcurrent(
  projectDir: string,
  stdins: string[]
): Promise<Array<{ status: number | null; stdout: string }>> {
  return Promise.all(
    stdins.map(
      (stdin) =>
        new Promise<{ status: number | null; stdout: string }>((resolve, reject) => {
          const env = { ...process.env };
          delete (env as Record<string, unknown>).GLOSS_SKIP_HOOK;
          const child = spawn(process.execPath, [BUNDLE], {
            cwd: projectDir,
            env
          });
          let stdout = "";
          child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
          child.on("error", reject);
          child.on("close", (status) => resolve({ status, stdout }));
          child.stdin.write(stdin);
          child.stdin.end();
        })
    )
  );
}
