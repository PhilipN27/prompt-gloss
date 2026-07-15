// Reads the companion project registry (~/.gloss/projects.json) written by
// `prompt-gloss init` (TERMINAL.md §8.2/§9.1). The project-picker page (§8.3)
// lists these when the first hotkey fires with no project configured.
//
// This is a read-only, never-throw view: a missing or malformed registry
// degrades to an empty list so a broken file can never crash the daemon.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { projectsRegistryPath } from "../paths.js";

/** The recorded project directories, in stored order. Empty if absent/malformed. */
export function readProjectRegistry(homeDir: string = homedir()): string[] {
  let raw: string;
  try {
    raw = readFileSync(projectsRegistryPath(homeDir), "utf8");
  } catch {
    return []; // absent registry — no projects yet
  }
  try {
    const parsed = JSON.parse(raw) as { projects?: unknown };
    if (!Array.isArray(parsed.projects)) return [];
    return parsed.projects.filter((p): p is string => typeof p === "string");
  } catch {
    return []; // malformed JSON — treat as empty, never throw
  }
}
