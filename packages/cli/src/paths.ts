// Shared path helpers for the CLI commands.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function glossDir(projectDir: string): string {
  return join(projectDir, ".gloss");
}

export function hookTargetPath(projectDir: string): string {
  return join(glossDir(projectDir), "hook", "gloss-hook.cjs");
}

export function settingsFilePath(projectDir: string, local: boolean): string {
  return join(projectDir, ".claude", local ? "settings.local.json" : "settings.json");
}

export function glossCommandPath(projectDir: string): string {
  return join(projectDir, ".claude", "commands", "gloss.md");
}

export function projectsRegistryPath(homeDir: string = homedir()): string {
  return join(homeDir, ".gloss", "projects.json");
}

/**
 * The shipped hook bundle: dist/gloss-hook.cjs next to the built CLI
 * (published layout, created by copy-bundle.mjs), falling back to
 * packages/hook/dist in the monorepo (dev/tests run from src/).
 */
export function shippedBundlePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "gloss-hook.cjs"), // running from dist/
    join(here, "..", "dist", "gloss-hook.cjs"), // running from src/ after a build
    join(here, "..", "..", "hook", "dist", "gloss-hook.cjs") // monorepo dev
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error("hook bundle not found — build @prompt-gloss/hook first");
}
