// OS-native login registration for `prompt-gloss companion`
// (TERMINAL.md §8.2). The registry/plist/desktop entry invokes this exact CLI
// installation and carries an explicit project when one was supplied.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AutostartOptions {
  readonly platform: NodeJS.Platform;
  readonly projectDir?: string;
  readonly log?: (line: string) => void;
}

const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const WINDOWS_VALUE = "PromptGlossCompanion";
const MACOS_LABEL = "com.prompt-gloss.companion";

function cliEntryPath(): string {
  return process.argv[1]
    ? resolve(process.argv[1])
    : fileURLToPath(new URL("../cli.js", import.meta.url));
}

function companionArguments(projectDir?: string): string[] {
  const args = [process.execPath, cliEntryPath(), "companion"];
  if (projectDir) args.push("--project", resolve(projectDir));
  return args;
}

function quoteWindowsArgument(value: string): string {
  // CommandLineToArgvW-compatible quoting for registry command strings.
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function desktopExecArgument(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")}"`;
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

function launchAgentPlist(args: readonly string[]): string {
  const programArguments = args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MACOS_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

function desktopEntry(args: readonly string[]): string {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=Gloss Companion
Comment=Capture highlighted terminal text as Gloss context cards
Exec=${args.map(desktopExecArgument).join(" ")}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
}

export async function installAutostart(opts: AutostartOptions): Promise<void> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const args = companionArguments(opts.projectDir);

  switch (opts.platform) {
    case "win32": {
      const commandLine = args.map(quoteWindowsArgument).join(" ");
      await run("reg.exe", [
        "add",
        WINDOWS_RUN_KEY,
        "/v",
        WINDOWS_VALUE,
        "/t",
        "REG_SZ",
        "/d",
        commandLine,
        "/f"
      ]);
      log(
        `[gloss companion] wrote Windows Run value ${WINDOWS_RUN_KEY}\\${WINDOWS_VALUE}: ${commandLine}`
      );
      return;
    }
    case "darwin": {
      const path = join(homedir(), "Library", "LaunchAgents", `${MACOS_LABEL}.plist`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, launchAgentPlist(args), "utf8");
      log(`[gloss companion] wrote macOS LaunchAgent: ${path}`);
      return;
    }
    case "linux": {
      const path = join(
        homedir(),
        ".config",
        "autostart",
        "prompt-gloss-companion.desktop"
      );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, desktopEntry(args), { encoding: "utf8", mode: 0o644 });
      log(`[gloss companion] wrote XDG autostart entry: ${path}`);
      return;
    }
    default:
      throw new Error(`Autostart is not supported on ${opts.platform}`);
  }
}
