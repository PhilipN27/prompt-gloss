// `prompt-gloss doctor` (TERMINAL.md §9.4): diagnose the install — hook file
// present + current, both settings entries present (parsed, not substring-
// guessed), node resolvable for the hook's shell, .state writable, last hook
// error, companion capture status — and print fixes.

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { GLOSS_HOOK_MARKER } from "../settings.js";
import { glossDir, hookTargetPath, settingsFilePath, shippedBundlePath } from "../paths.js";

export interface DoctorOptions {
  projectDir: string;
  /** Extra settings file to inspect (mirror of init --settings-file). */
  settingsFile?: string;
}

export interface DoctorResult {
  ok: boolean;
  report: string;
}

/** True if the parsed settings document carries a Gloss entry for the event. */
function hasEventEntry(doc: unknown, event: string): boolean {
  if (doc === null || typeof doc !== "object") return false;
  const hooks = (doc as Record<string, unknown>).hooks;
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return false;
  const groups = (hooks as Record<string, unknown>)[event];
  if (!Array.isArray(groups)) return false;
  return groups.some((g) => JSON.stringify(g)?.includes(GLOSS_HOOK_MARKER));
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorResult> {
  const lines: string[] = [];
  let ok = true;
  const fail = (line: string) => {
    ok = false;
    lines.push(line);
  };

  // Hook file present + matching the shipped bundle.
  const target = hookTargetPath(opts.projectDir);
  if (!existsSync(target)) {
    fail("hook file: MISSING — run `npx prompt-gloss init`");
  } else {
    try {
      const shipped = readFileSync(shippedBundlePath(), "utf8");
      if (readFileSync(target, "utf8") === shipped) {
        lines.push("hook file: ok (current)");
      } else {
        fail("hook file: STALE — re-run `npx prompt-gloss init` to upgrade");
      }
    } catch {
      fail("hook file: present, but the shipped bundle is unavailable for comparison");
    }
  }

  // Settings entries: BOTH events must be present, in some inspected file,
  // parsed as actual hook entries (a stray mention of the path in an
  // unrelated key does not count as installed).
  const targets = [
    settingsFilePath(opts.projectDir, false),
    settingsFilePath(opts.projectDir, true),
    ...(opts.settingsFile ? [opts.settingsFile] : [])
  ];
  const docs = targets
    .filter((p) => existsSync(p))
    .map((p) => parse(readFileSync(p, "utf8")) as unknown);
  for (const event of ["UserPromptSubmit", "SessionStart"]) {
    if (docs.some((d) => hasEventEntry(d, event))) {
      lines.push(`settings entry (${event}): ok`);
    } else {
      fail(`settings entries: MISSING ${event} — run \`npx prompt-gloss init\``);
    }
  }

  // node resolvable (the settings command invokes `node` from the hook shell).
  const node = spawnSync(process.platform === "win32" ? "node.exe" : "node", ["--version"], {
    encoding: "utf8"
  });
  if (node.status === 0) {
    lines.push(`node on PATH: ok (${node.stdout.trim()})`);
  } else {
    fail("node on PATH: NOT FOUND — the hook command runs `node`; install Node or fix PATH");
  }

  // .state must be a writable directory (a file named .state fails).
  const stateDir = join(glossDir(opts.projectDir), ".state");
  try {
    if (existsSync(stateDir) && !statSync(stateDir).isDirectory()) {
      fail(`.state: exists but is not a directory (${stateDir})`);
    } else {
      accessSync(existsSync(stateDir) ? stateDir : glossDir(opts.projectDir), constants.W_OK);
      lines.push(".state: writable");
    }
  } catch {
    fail(`.state: NOT WRITABLE (${stateDir})`);
  }

  // Last hook error, if any.
  const errLog = join(stateDir, "hook-errors.log");
  if (existsSync(errLog)) {
    const entries = readFileSync(errLog, "utf8").trim().split("\n");
    const last = entries[entries.length - 1];
    if (last) lines.push(`last hook error: ${last.slice(0, 120)}`);
  } else {
    lines.push("hook errors: none");
  }

  // Companion capture support lands in Phase D (TERMINAL.md §8) — say so
  // honestly instead of omitting the check.
  lines.push("companion capture: not applicable yet (ships in a later release)");

  return { ok, report: lines.join("\n") };
}
