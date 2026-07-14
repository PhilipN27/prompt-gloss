// ┌──────────────────────────────────────────────────────────────────────────┐
// │ SLICE FILE — Phase D "@codex panel plumbing". Replace this stub body.      │
// └──────────────────────────────────────────────────────────────────────────┘
//
// `prompt-gloss companion --install-autostart` writes the OS-native autostart
// entry (TERMINAL.md §8.2): Windows Run key, macOS LaunchAgent plist, XDG
// autostart .desktop. One flag, documented per OS.

export interface AutostartOptions {
  readonly platform: NodeJS.Platform;
  readonly projectDir?: string;
  readonly log?: (line: string) => void;
}

export async function installAutostart(opts: AutostartOptions): Promise<void> {
  // STUB: the real slice writes the per-OS autostart entry here.
  (opts.log ?? (() => undefined))(
    `[gloss companion] (stub) --install-autostart not implemented yet for ${opts.platform} (Phase D slice).`
  );
}
