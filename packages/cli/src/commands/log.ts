// `prompt-gloss log` (TERMINAL.md §9.3): human-readable tail of
// .gloss/.state/injections.jsonl. Malformed lines are skipped (a torn line
// can only cost one entry — TERMINAL.md §4.2).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glossDir } from "../paths.js";

export interface LogOptions {
  projectDir: string;
  count: number;
}

interface InjectionRecord {
  ts: string;
  sessionId: string;
  promptId: string;
  slugs: string[];
}

export async function runLog(opts: LogOptions): Promise<string> {
  const path = join(glossDir(opts.projectDir), ".state", "injections.jsonl");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return "(no injections logged yet)";
  }

  const records = raw
    .split("\n")
    .filter((l) => l.length > 0)
    .flatMap((line): InjectionRecord[] => {
      try {
        const rec = JSON.parse(line) as InjectionRecord;
        return Array.isArray(rec.slugs) ? [rec] : [];
      } catch {
        return []; // skip malformed lines
      }
    })
    .slice(-opts.count);

  if (records.length === 0) return "(no injections logged yet)";
  return records
    .map((r) => `${r.ts}  session ${r.sessionId}  injected: ${r.slugs.join(", ")}`)
    .join("\n");
}
