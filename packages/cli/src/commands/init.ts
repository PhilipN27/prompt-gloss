// `prompt-gloss init` (TERMINAL.md §9.1): scaffold .gloss/, copy the hook
// bundle, merge the two hook entries into the chosen settings file, write the
// /gloss command, record the project for the companion picker. Idempotent;
// --dry-run prints the planned changes and writes nothing.
//
// Ordering is deliberate: the settings merge — the step that ACTIVATES the
// hook — happens last, so a failure partway through can leave inert files
// behind but never an active hook pointing at missing pieces.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mergeGlossEntries } from "../settings.js";
import { writeFileAtomic } from "../fsutil.js";
import {
  glossCommandPath,
  glossDir,
  hookTargetPath,
  projectsRegistryPath,
  settingsFilePath,
  shippedBundlePath
} from "../paths.js";

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

/** Ownership marker: uninstall only ever deletes a /gloss command carrying it,
 * and init never overwrites one without it (§9.2: "the /gloss command init wrote"). */
export const GLOSS_COMMAND_MARKER = "<!-- managed by prompt-gloss init -->";

const GLOSS_COMMAND_MD = `---
description: Create a Gloss context card for a term ("/gloss term: explanation")
---

${GLOSS_COMMAND_MARKER}

Parse the arguments as \`<term>[: <explanation>]\`. Run
\`npx prompt-gloss add "<term>" --body "<explanation>"\` in the project root
(ask for the explanation first if none was given). Report the created card file.
`;

export async function runInit(opts: InitOptions): Promise<void> {
  const log = opts.log ?? (() => undefined);

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
  const commandPath = glossCommandPath(opts.projectDir);
  const registry = projectsRegistryPath(opts.homeDir ?? homedir());

  const commandExists = existsSync(commandPath);
  const commandIsOurs =
    commandExists && readFileSync(commandPath, "utf8").includes(GLOSS_COMMAND_MARKER);
  const foreignCommand = commandExists && !commandIsOurs;

  const changes: string[] = [
    `scaffold ${glossDir(opts.projectDir)}`,
    `copy hook bundle -> ${bundleTarget}`,
    foreignCommand
      ? `SKIP ${commandPath} (exists and was not written by prompt-gloss)`
      : `write ${commandPath}`,
    `record project in ${registry}`,
    merged.changed
      ? `merge Gloss hook entries -> ${settingsPath}`
      : `settings already have Gloss entries (${settingsPath}) — unchanged`
  ];

  if (opts.dryRun) {
    for (const c of changes) log(`[dry-run] ${c}`);
    if (merged.changed) {
      log("[dry-run] settings file after merge would be:");
      log(merged.text);
    }
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

  // 3. /gloss command — never clobber a user-authored file.
  if (!foreignCommand) {
    mkdirSync(dirname(commandPath), { recursive: true });
    writeFileAtomic(commandPath, GLOSS_COMMAND_MD);
  }

  // 4. Companion project registry. A malformed registry is preserved as a
  // .bak next to the fresh one — never silently clobbered.
  let projects: string[] = [];
  if (existsSync(registry)) {
    try {
      const parsed = JSON.parse(readFileSync(registry, "utf8")) as { projects?: unknown };
      if (!Array.isArray(parsed.projects)) throw new Error("bad shape");
      projects = parsed.projects.filter((p): p is string => typeof p === "string");
    } catch {
      const backup = `${registry}.bak-${Date.now()}`;
      copyFileSync(registry, backup);
      log(`warning: ${registry} was malformed — preserved as ${backup}`);
    }
  }
  // Windows paths are case-insensitive; dedup accordingly there.
  const seen = projects.map((p) => (process.platform === "win32" ? p.toLowerCase() : p));
  const key = process.platform === "win32" ? opts.projectDir.toLowerCase() : opts.projectDir;
  if (!seen.includes(key)) projects.push(opts.projectDir);
  writeFileAtomic(registry, JSON.stringify({ version: 1, projects }, null, 2) + "\n");

  // 5. Settings merge — last: this is the step that turns the hook on.
  if (merged.changed) {
    writeFileAtomic(settingsPath, merged.text);
  }

  for (const c of changes) log(c);
  log("Done. Try it: start `claude`, send a prompt using a card's term.");
}
