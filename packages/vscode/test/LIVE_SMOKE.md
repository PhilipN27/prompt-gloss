# VS Code extension live-smoke boundary

The Electron harness cannot select text in a real integrated terminal. It uses
the documented pre-seeded-clipboard technique and relies on
`workbench.action.terminal.copySelection` leaving that seed unchanged.

Before release, run the live-smoke items from `TESTING.md` in both VS Code and
Cursor:

- Select actual integrated-terminal text, invoke the keybinding and context-menu
  command, save the card, and verify later injection.
- Run a shell with shell integration enabled and confirm capture provenance uses
  the recent execution-output excerpt.

Neither behavior is simulated by this harness.
