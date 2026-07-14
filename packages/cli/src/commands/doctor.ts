// `prompt-gloss doctor` (TERMINAL.md §9.4): diagnose the install — hook file
// present + current, settings entries present, .state writable, last hook
// error — and print fixes.

import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GLOSS_HOOK_MARKER } from "../settings.js";
import { glossDir, hookTargetPath, settingsFilePath, shippedBundlePath } from "../paths.js";

export interface DoctorOptions {
  projectDir: string;
}

export interface DoctorResult {
  ok: boolean;
  report: string;
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
      lines.push("hook file: present (shipped bundle unavailable for comparison)");
    }
  }

  // Settings entries in either settings file.
  const hasEntries = [false, true].some((local) => {
    const path = settingsFilePath(opts.projectDir, local);
    return existsSync(path) && readFileSync(path, "utf8").includes(GLOSS_HOOK_MARKER);
  });
  if (hasEntries) {
    lines.push("settings entries: ok");
  } else {
    fail("settings entries: MISSING — run `npx prompt-gloss init`");
  }

  // .state writable.
  const stateDir = join(glossDir(opts.projectDir), ".state");
  try {
    accessSync(existsSync(stateDir) ? stateDir : opts.projectDir, constants.W_OK);
    lines.push(".state: writable");
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

  return { ok, report: lines.join("\n") };
}
