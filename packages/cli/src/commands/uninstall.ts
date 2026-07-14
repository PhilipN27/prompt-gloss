// `prompt-gloss uninstall` (TERMINAL.md §9.2): the exact mirror of init.
// Sweeps BOTH .claude/settings.json and .claude/settings.local.json (hooks
// merge across levels), removes .gloss/hook/ + .gloss/.state/ and the /gloss
// command, and never touches .gloss/cards/ or any non-Gloss settings key.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeGlossEntries } from "../settings.js";
import { glossCommandPath, glossDir, settingsFilePath } from "../paths.js";

export interface UninstallOptions {
  projectDir: string;
  log?: (line: string) => void;
}

export async function runUninstall(opts: UninstallOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);

  for (const local of [false, true]) {
    const path = settingsFilePath(opts.projectDir, local);
    if (!existsSync(path)) continue;
    const { text, changed } = removeGlossEntries(readFileSync(path, "utf8"));
    if (changed) {
      writeFileSync(path, text);
      log(`removed Gloss hook entries from ${path}`);
    }
  }

  for (const target of [
    join(glossDir(opts.projectDir), "hook"),
    join(glossDir(opts.projectDir), ".state"),
    glossCommandPath(opts.projectDir)
  ]) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      log(`removed ${target}`);
    }
  }

  log("Uninstalled. Cards in .gloss/cards/ were left untouched.");
}
