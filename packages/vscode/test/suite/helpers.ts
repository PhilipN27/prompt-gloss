import assert from "node:assert/strict";
import * as vscode from "vscode";

export const EXTENSION_ID = "prompt-gloss.gloss-terminal";

export async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Expected ${EXTENSION_ID} to be installed in the test host.`);
  await extension.activate();
  return extension;
}

export function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "Expected the test host to open its temporary workspace folder.");
  return folder.uri.fsPath;
}
