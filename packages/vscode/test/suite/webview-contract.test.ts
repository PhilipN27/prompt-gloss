import assert from "node:assert/strict";
import * as vscode from "vscode";
import { isWebviewToHostMessage } from "../../src/messaging.js";
import { buildWebviewHtml } from "../../src/webview/html.js";
import { activateExtension } from "./helpers.js";

suite("Webview to host contract", () => {
  test("accepts every valid webview message and rejects malformed payloads", () => {
    const valid: unknown[] = [
      { type: "ready" },
      { type: "close", id: 1 },
      { type: "delete", id: 2, slug: "federated-brewing" },
      {
        type: "save",
        id: 3,
        input: { term: "federated brewing", aliases: ["brew"], body: "Context" }
      }
    ];
    const malformed: unknown[] = [
      null,
      {},
      { type: "unknown" },
      { type: "close" },
      { type: "close", id: 0 },
      { type: "delete" },
      { type: "delete", id: 1, slug: 42 },
      { type: "save" },
      {
        type: "save",
        id: 1,
        input: { term: "term", aliases: "alias", body: "body" }
      },
      {
        type: "save",
        id: 1,
        input: { term: "term", aliases: ["alias", 42], body: "body" }
      }
    ];

    for (const message of valid) assert.equal(isWebviewToHostMessage(message), true);
    for (const message of malformed) assert.equal(isWebviewToHostMessage(message), false);
  });

  test("builds CSP-protected HTML with nonced resources and VS Code theme mappings", async () => {
    const extension = await activateExtension();
    const cspSource = "vscode-webview://gloss-test";
    const webview = {
      cspSource,
      asWebviewUri: (uri: vscode.Uri): vscode.Uri =>
        vscode.Uri.parse(`vscode-test-resource:${uri.path}`)
    } as vscode.Webview;

    const html = buildWebviewHtml(webview, extension.extensionUri);
    const script = html.match(
      /<script nonce="([a-f0-9]{32})" src="([^"]*webview\.js)"><\/script>/
    );

    assert.ok(script);
    const resourceNonce = script[1];
    assert.ok(resourceNonce);
    assert.ok(html.includes('http-equiv="Content-Security-Policy"'));
    assert.ok(html.includes(`style-src ${cspSource} 'nonce-${resourceNonce}'`));
    assert.ok(html.includes(`script-src 'nonce-${resourceNonce}'`));
    assert.ok(html.includes(`<style nonce="${resourceNonce}">`));
    assert.ok(html.includes("webview.css"));

    const mappings = [
      "--gloss-bg: var(--vscode-editor-background)",
      "--gloss-border: var(--vscode-panel-border)",
      "--gloss-text: var(--vscode-foreground)",
      "--gloss-text-muted: var(--vscode-descriptionForeground)",
      "--gloss-accent: var(--vscode-button-background)",
      "--gloss-danger: var(--vscode-errorForeground)"
    ];
    for (const mapping of mappings) assert.ok(html.includes(mapping));

    // A real iframe postMessage round trip is beyond @vscode/test-electron's
    // extension-host boundary; protocol validation is asserted above instead.
  });
});
