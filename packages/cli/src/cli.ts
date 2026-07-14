#!/usr/bin/env node
// prompt-gloss CLI entry (TERMINAL.md §9): init / uninstall / add / log /
// doctor / web. Zero-dependency argv parsing — strict: unknown flags error,
// value flags must be followed by a value (never another flag), numbers are
// validated. A typo must never silently perform a real install.

import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInit } from "./commands/init.js";
import { runUninstall } from "./commands/uninstall.js";
import { runAdd } from "./commands/add.js";
import { runLog } from "./commands/log.js";
import { runDoctor } from "./commands/doctor.js";
import { runWeb } from "./commands/web.js";

const USAGE = `prompt-gloss — gloss any word in your prompt

Usage:
  prompt-gloss init [--local] [--settings-file <path>] [--dry-run] [--project <dir>]
  prompt-gloss uninstall [--settings-file <path>] [--project <dir>]
  prompt-gloss add "<term>" [--alias <a>]... (--body "<text>" | --body-file <f> | -)
  prompt-gloss log [-n <count>] [--project <dir>]
  prompt-gloss doctor [--settings-file <path>] [--project <dir>]
  prompt-gloss web [--port <port>] [--project <dir>]
`;

const VALUE_FLAGS = new Set(["--project", "--settings-file", "--body", "--body-file", "--port", "-n", "--alias"]);
const KNOWN_FLAGS: Record<string, Set<string>> = {
  init: new Set(["--project", "--settings-file", "--local", "--dry-run"]),
  uninstall: new Set(["--project", "--settings-file"]),
  add: new Set(["--project", "--alias", "--body", "--body-file"]),
  log: new Set(["--project", "-n"]),
  doctor: new Set(["--project", "--settings-file"]),
  web: new Set(["--project", "--port"])
};

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
  aliases: string[];
}

function parseArgs(command: string, argv: string[]): ParsedArgs {
  const known = KNOWN_FLAGS[command];
  if (!known) throw new Error(`unknown command: ${command}\n\n${USAGE}`);
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const aliases: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-") {
      positional.push(arg);
      continue;
    }
    if (arg.startsWith("-")) {
      if (!known.has(arg)) throw new Error(`unknown option for ${command}: ${arg}\n\n${USAGE}`);
      if (VALUE_FLAGS.has(arg)) {
        const value = argv[i + 1];
        // Reject a KNOWN flag as a value (`--settings-file --dry-run` must not
        // swallow the flag) while still allowing legitimate hyphen-leading
        // values like --body "- a bullet" or an alias starting with "-".
        if (value === undefined || known.has(value)) {
          throw new Error(`option ${arg} requires a value`);
        }
        i++;
        if (arg === "--alias") aliases.push(value);
        else flags.set(arg, value);
      } else {
        flags.set(arg, true);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, aliases };
}

function positiveInt(value: string | true | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function readBody(args: ParsedArgs): string {
  const sources = [
    args.flags.has("--body"),
    args.flags.has("--body-file"),
    args.positional.includes("-")
  ].filter(Boolean).length;
  if (sources > 1) throw new Error("use only one of --body, --body-file, or - (stdin)");
  const body = args.flags.get("--body");
  if (typeof body === "string") return body;
  const bodyFile = args.flags.get("--body-file");
  if (typeof bodyFile === "string") return readFileSync(bodyFile, "utf8");
  if (args.positional.includes("-")) return readFileSync(0, "utf8"); // stdin
  throw new Error("add requires --body, --body-file, or - (stdin)");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    console.log(USAGE);
    return 0;
  }
  const args = parseArgs(command, rest);
  const projectFlag = args.flags.get("--project");
  const projectDir = resolve(typeof projectFlag === "string" ? projectFlag : process.cwd());
  // A relative --settings-file resolves against the PROJECT dir, so the
  // install can never silently split across two roots.
  const settingsFlag = args.flags.get("--settings-file");
  const settingsFile =
    typeof settingsFlag === "string"
      ? isAbsolute(settingsFlag)
        ? settingsFlag
        : resolve(projectDir, settingsFlag)
      : undefined;
  const log = (line: string) => console.log(line);

  switch (command) {
    case "init":
      await runInit({
        projectDir,
        local: args.flags.has("--local"),
        ...(settingsFile ? { settingsFile } : {}),
        dryRun: args.flags.has("--dry-run"),
        log
      });
      return 0;
    case "uninstall":
      await runUninstall({ projectDir, ...(settingsFile ? { settingsFile } : {}), log });
      return 0;
    case "add": {
      const term = args.positional.filter((p) => p !== "-")[0];
      if (!term) throw new Error('add requires a "<term>" argument');
      await runAdd({ projectDir, term, aliases: args.aliases, body: readBody(args), log });
      return 0;
    }
    case "log": {
      const count = positiveInt(args.flags.get("-n"), "-n") ?? 20;
      console.log(await runLog({ projectDir, count }));
      return 0;
    }
    case "doctor": {
      const { ok, report } = await runDoctor({
        projectDir,
        ...(settingsFile ? { settingsFile } : {})
      });
      console.log(report);
      return ok ? 0 : 1;
    }
    case "web": {
      const port = positiveInt(args.flags.get("--port"), "--port");
      await runWeb({ projectDir, ...(port !== undefined ? { port } : {}), log });
      return 0; // keeps running via the open server handle
    }
    default:
      // parseArgs already rejected unknown commands.
      return 1;
  }
}

// npm's Unix bin link is a symlink named `prompt-gloss` (no .js suffix), so
// resolve the real entry path and compare against this module's URL; a plain
// suffix check would make the installed binary a silent no-op.
const entry = process.argv[1];
let invokedDirectly = false;
if (entry) {
  try {
    invokedDirectly = pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    invokedDirectly = entry.endsWith("cli.js") || entry.endsWith("prompt-gloss");
  }
}
if (invokedDirectly) {
  main().then(
    (code) => {
      if (code !== 0) process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`prompt-gloss: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  );
}
