// `prompt-gloss uninstall` (TERMINAL.md §9.2): the exact mirror of init.
// Sweeps BOTH .claude/settings.json and .claude/settings.local.json (hooks
// merge across levels) plus any --settings-file target init was given,
// removes .gloss/hook/ + .gloss/.state/ and the /gloss command init wrote
// (ownership marker), and never touches .gloss/cards/ or any non-Gloss key.
//
// All settings files are read and validated BEFORE any of them is mutated,
// so a malformed file aborts the sweep with nothing half-done.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { removeGlossEntries } from "../settings.js";
import { writeFileAtomic } from "../fsutil.js";
import { glossCommandPath, glossDir, settingsFilePath } from "../paths.js";
import { GLOSS_COMMAND_MARKER } from "./init.js";

export interface UninstallOptions {
  projectDir: string;
  /** Extra settings file to sweep (mirror of init --settings-file). */
  settingsFile?: string;
  log?: (line: string) => void;
}

export async function runUninstall(opts: UninstallOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);

  const targets = [
    settingsFilePath(opts.projectDir, false),
    settingsFilePath(opts.projectDir, true),
    ...(opts.settingsFile ? [opts.settingsFile] : [])
  ];

  // Phase 1: read + compute every edit (throws on a malformed file before
  // anything has been written).
  const edits: Array<{ path: string; text: string }> = [];
  for (const path of targets) {
    if (!existsSync(path)) continue;
    const { text, changed } = removeGlossEntries(readFileSync(path, "utf8"));
    if (changed) edits.push({ path, text });
  }

  // Phase 2: apply.
  for (const { path, text } of edits) {
    writeFileAtomic(path, text);
    log(`removed Gloss hook entries from ${path}`);
  }

  for (const target of [
    join(glossDir(opts.projectDir), "hook"),
    join(glossDir(opts.projectDir), ".state")
  ]) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      log(`removed ${target}`);
    }
  }

  // Only delete the /gloss command if init wrote it (ownership marker).
  const commandPath = glossCommandPath(opts.projectDir);
  if (existsSync(commandPath)) {
    if (readFileSync(commandPath, "utf8").includes(GLOSS_COMMAND_MARKER)) {
      rmSync(commandPath, { force: true });
      log(`removed ${commandPath}`);
    } else {
      log(`kept ${commandPath} (not written by prompt-gloss)`);
    }
  }

  log("Uninstalled. Cards in .gloss/cards/ were left untouched.");
}
