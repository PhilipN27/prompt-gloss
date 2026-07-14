// prompt-gloss CLI entry (TERMINAL.md §9): init / uninstall / add / log /
// doctor / web. Zero-dependency argv parsing — the surface is small and pinned.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInit } from "./commands/init.js";
import { runUninstall } from "./commands/uninstall.js";
import { runAdd } from "./commands/add.js";
import { runLog } from "./commands/log.js";
import { runDoctor } from "./commands/doctor.js";
import { runWeb } from "./commands/web.js";

const USAGE = `prompt-gloss — gloss any word in your prompt

Usage:
  prompt-gloss init [--local] [--settings-file <path>] [--dry-run] [--project <dir>]
  prompt-gloss uninstall [--project <dir>]
  prompt-gloss add "<term>" [--alias <a>]... [--body "<text>" | --body-file <f> | -]
  prompt-gloss log [-n <count>] [--project <dir>]
  prompt-gloss doctor [--project <dir>]
  prompt-gloss web [--port <port>] [--project <dir>]
`;

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
  aliases: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const aliases: string[] = [];
  const valueFlags = new Set([
    "--project",
    "--settings-file",
    "--body",
    "--body-file",
    "--port",
    "-n"
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--alias") {
      const v = argv[++i];
      if (v !== undefined) aliases.push(v);
    } else if (valueFlags.has(arg)) {
      const v = argv[++i];
      flags.set(arg, v ?? true);
    } else if (arg.startsWith("-") && arg !== "-") {
      flags.set(arg, true);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, aliases };
}

function readBody(args: ParsedArgs): string {
  const body = args.flags.get("--body");
  if (typeof body === "string") return body;
  const bodyFile = args.flags.get("--body-file");
  if (typeof bodyFile === "string") return readFileSync(bodyFile, "utf8");
  if (args.positional.includes("-")) return readFileSync(0, "utf8"); // stdin
  throw new Error("add requires --body, --body-file, or - (stdin)");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  const projectFlag = args.flags.get("--project");
  const projectDir = resolve(typeof projectFlag === "string" ? projectFlag : process.cwd());
  const log = (line: string) => console.log(line);

  switch (command) {
    case "init": {
      const settingsFile = args.flags.get("--settings-file");
      await runInit({
        projectDir,
        local: args.flags.has("--local"),
        ...(typeof settingsFile === "string" ? { settingsFile } : {}),
        dryRun: args.flags.has("--dry-run"),
        log
      });
      return 0;
    }
    case "uninstall":
      await runUninstall({ projectDir, log });
      return 0;
    case "add": {
      const term = args.positional.filter((p) => p !== "-")[0];
      if (!term) throw new Error('add requires a "<term>" argument');
      await runAdd({ projectDir, term, aliases: args.aliases, body: readBody(args), log });
      return 0;
    }
    case "log": {
      const n = args.flags.get("-n");
      console.log(await runLog({ projectDir, count: typeof n === "string" ? Number(n) || 20 : 20 }));
      return 0;
    }
    case "doctor": {
      const { ok, report } = await runDoctor({ projectDir });
      console.log(report);
      return ok ? 0 : 1;
    }
    case "web": {
      const port = args.flags.get("--port");
      await runWeb({
        projectDir,
        ...(typeof port === "string" ? { port: Number(port) } : {}),
        log
      });
      return 0; // keeps running via the open server handle
    }
    default:
      console.log(USAGE);
      return command === undefined || command === "help" ? 0 : 1;
  }
}

const invokedDirectly = process.argv[1]?.endsWith("cli.js") ?? false;
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
