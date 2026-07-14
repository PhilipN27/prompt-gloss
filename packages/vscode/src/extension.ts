import * as vscode from "vscode";

const CAPTURE_COMMAND = "gloss.captureSelection";
const CARD_PANEL_VIEW = "gloss.cardPanel";

class CardPanelProvider implements vscode.WebviewViewProvider {
  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist");
    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, "webview.js")
    );
    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, "webview.css")
    );

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [distUri]
    };
    webviewView.webview.html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${styleUri}">
    <title>Gloss Card</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CardPanelProvider(context.extensionUri);
  const viewRegistration = vscode.window.registerWebviewViewProvider(
    CARD_PANEL_VIEW,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );
  const commandRegistration = vscode.commands.registerCommand(
    CAPTURE_COMMAND,
    async (): Promise<void> => {
      await vscode.commands.executeCommand(`${CARD_PANEL_VIEW}.focus`);
    }
  );

  context.subscriptions.push(viewRegistration, commandRegistration);
}

export function deactivate(): void {}
