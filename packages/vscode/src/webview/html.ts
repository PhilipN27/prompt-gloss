import * as vscode from "vscode";

function nonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const distUri = vscode.Uri.joinPath(extensionUri, "dist");
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, "webview.css"));
  const resourceNonce = nonce();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${resourceNonce}'; script-src 'nonce-${resourceNonce}';">
    <style nonce="${resourceNonce}">
      *,*::before,*::after{box-sizing:border-box}
      :root {
        --gloss-bg: var(--vscode-editor-background);
        --gloss-border: var(--vscode-panel-border);
        --gloss-text: var(--vscode-foreground);
        --gloss-text-muted: var(--vscode-descriptionForeground);
        --gloss-input-bg: var(--vscode-input-background);
        --gloss-input-text: var(--vscode-input-foreground);
        --gloss-accent: var(--vscode-button-background);
        --gloss-danger: var(--vscode-errorForeground);
      }
      body { margin: 0; }
    </style>
    <link rel="stylesheet" href="${styleUri}">
    <title>Gloss Card</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${resourceNonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
