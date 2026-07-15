import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { activateExtension } from "./helpers.js";

interface CommandContribution {
  command: string;
}

interface KeybindingContribution extends CommandContribution {
  key: string;
  mac: string;
  when: string;
}

interface MenuContribution extends CommandContribution {
  when?: string;
}

interface ViewContribution {
  id: string;
  type?: string;
}

interface ExtensionManifest {
  activationEvents: string[];
  contributes: {
    commands: CommandContribution[];
    keybindings: KeybindingContribution[];
    menus: { "terminal/context": MenuContribution[] };
    views: { gloss: ViewContribution[] };
  };
}

suite("Activation and contributions", () => {
  test("activates and registers the capture command", async () => {
    const extension = await activateExtension();

    assert.equal(extension.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("gloss.captureSelection"));
  });

  test("declares the packaged command, affordances, and card-panel view", async () => {
    const extension = await activateExtension();
    const packageJson = await readFile(
      join(extension.extensionPath, "package.json"),
      "utf8"
    );
    const manifest = JSON.parse(packageJson) as ExtensionManifest;

    assert.ok(manifest.activationEvents.includes("onStartupFinished"));
    assert.ok(
      manifest.contributes.commands.some(
        (entry) => entry.command === "gloss.captureSelection"
      )
    );
    assert.ok(
      manifest.contributes.keybindings.some(
        (entry) =>
          entry.command === "gloss.captureSelection" &&
          entry.key === "ctrl+alt+g" &&
          entry.mac === "cmd+alt+g" &&
          entry.when === "terminalFocus"
      )
    );
    assert.ok(
      manifest.contributes.menus["terminal/context"].some(
        (entry) =>
          entry.command === "gloss.captureSelection" &&
          entry.when === "terminalFocus"
      )
    );
    assert.ok(
      manifest.contributes.views.gloss.some(
        (entry) => entry.id === "gloss.cardPanel" && entry.type === "webview"
      )
    );
  });
});
