// `prompt-gloss init` (TERMINAL.md §9.1): scaffold .gloss/, copy the hook
// bundle, merge the two hook entries into the chosen settings file, write the
// /gloss command, record the project for the companion picker. Idempotent;
// --dry-run prints the would-be changes and writes nothing.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { mergeGlossEntries } from "../settings.js";
import {
  glossCommandPath,
  glossDir,
  hookTargetPath,
  projectsRegistryPath,
  settingsFilePath,
  shippedBundlePath
} from "../paths.js";
import { join } from "node:path";

export interface InitOptions {
  projectDir: string;
  /** Override for tests; defaults to the real home dir. */
  homeDir?: string;
  local?: boolean;
  /** Explicit settings file target (overrides local). */
  settingsFile?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}

const GLOSS_COMMAND_MD = `---
description: Create a Gloss context card for a term ("/gloss term: explanation")
---

Parse the arguments as \`<term>[: <explanation>]\`. Run
\`npx prompt-gloss add "<term>" --body "<explanation>"\` in the project root
(ask for the explanation first if none was given). Report the created card file.
`;

export async function runInit(opts: InitOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);
  const changes: string[] = [];

  const settingsPath =
    opts.settingsFile ?? settingsFilePath(opts.projectDir, opts.local ?? false);
  const existingSettings = existsSync(settingsPath)
    ? readFileSync(settingsPath, "utf8")
    : null;
  // Parse-or-abort BEFORE any writes: a malformed settings file must stop the
  // whole init, leaving everything untouched.
  const merged = mergeGlossEntries(existingSettings);

  const bundleSource = shippedBundlePath();
  const bundleTarget = hookTargetPath(opts.projectDir);
  changes.push(`scaffold ${glossDir(opts.projectDir)}`);
  changes.push(`copy hook bundle -> ${bundleTarget}`);
  if (merged.changed) changes.push(`merge Gloss hook entries -> ${settingsPath}`);
  changes.push(`write ${glossCommandPath(opts.projectDir)}`);

  if (opts.dryRun) {
    for (const c of changes) log(`[dry-run] ${c}`);
    return;
  }

  // 1. Scaffold.
  mkdirSync(join(glossDir(opts.projectDir), "cards"), { recursive: true });
  const stateDir = join(glossDir(opts.projectDir), ".state");
  mkdirSync(stateDir, { recursive: true });
  if (!existsSync(join(stateDir, ".gitignore"))) {
    writeFileSync(join(stateDir, ".gitignore"), "*\n");
  }

  // 2. Hook bundle (overwrite = upgrade on re-run).
  mkdirSync(dirname(bundleTarget), { recursive: true });
  copyFileSync(bundleSource, bundleTarget);

  // 3. Settings merge.
  if (merged.changed) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, merged.text);
  }

  // 4. /gloss command.
  mkdirSync(dirname(glossCommandPath(opts.projectDir)), { recursive: true });
  writeFileSync(glossCommandPath(opts.projectDir), GLOSS_COMMAND_MD);

  // 5. Companion project registry.
  const registry = projectsRegistryPath(opts.homeDir ?? homedir());
  mkdirSync(dirname(registry), { recursive: true });
  let projects: string[] = [];
  try {
    const parsed = JSON.parse(readFileSync(registry, "utf8")) as { projects?: unknown };
    if (Array.isArray(parsed.projects)) {
      projects = parsed.projects.filter((p): p is string => typeof p === "string");
    }
  } catch {
    // Missing or malformed registry — start fresh.
  }
  if (!projects.includes(opts.projectDir)) projects.push(opts.projectDir);
  writeFileSync(registry, JSON.stringify({ version: 1, projects }, null, 2) + "\n");

  for (const c of changes) log(c);
  log("Done. Try it: start `claude`, send a prompt using a card's term.");
}
