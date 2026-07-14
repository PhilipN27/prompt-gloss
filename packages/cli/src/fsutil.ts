// Atomic file writes for user-owned files (settings, registry): same-dir
// temp + rename, so an interrupted write can never truncate the destination.

import { mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  // Preserve the destination's POSIX mode across the replace.
  let mode: number | undefined;
  try {
    mode = statSync(path).mode;
  } catch {
    // New file — default mode.
  }
  const tmp = join(dir, `.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, content, mode !== undefined ? { mode } : {});
  renameSync(tmp, path);
}
