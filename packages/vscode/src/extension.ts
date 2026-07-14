import type { Card } from "@prompt-gloss/core";
import type { PanelDraft } from "@prompt-gloss/panel-ui";
import * as vscode from "vscode";
import { captureSelection } from "./capture.js";
import { CardService } from "./cardService.js";
import {
  isWebviewToHostMessage,
  type HostToWebviewMessage,
  type SaveCardInput
} from "./messaging.js";
import { ProvenanceTracker } from "./provenance.js";
import { buildWebviewHtml } from "./webview/html.js";

const CAPTURE_COMMAND = "gloss.captureSelection";
const CARD_PANEL_VIEW = "gloss.cardPanel";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class CardPanelController implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private ready = false;
  private pendingDraft: PanelDraft | null = null;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly cardService: CardService
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist");
    this.view = webviewView;
    this.ready = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [distUri]
    };
    webviewView.webview.html = buildWebviewHtml(webviewView.webview, this.extensionUri);

    const messageSubscription = webviewView.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this.handleMessage(message).catch((error: unknown) => {
          void vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
        });
      }
    );
    const disposeSubscription = webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.ready = false;
        this.pendingDraft = null;
      }
    });
    this.context.subscriptions.push(messageSubscription, disposeSubscription);
  }

  public async openPanel(draft: PanelDraft): Promise<void> {
    this.pendingDraft = draft;
    const focus = vscode.commands.executeCommand(`${CARD_PANEL_VIEW}.focus`);
    if (this.ready) await this.postPendingDraft();
    await focus;
  }

  private async postPendingDraft(): Promise<void> {
    if (!this.ready || this.view === undefined || this.pendingDraft === null) return;
    const message: HostToWebviewMessage = {
      type: "open",
      draft: this.pendingDraft
    };
    await this.view.webview.postMessage(message);
  }

  private savedFeedback(card: Card): void {
    const message = `Gloss: card '${card.term}' saved to .gloss/`;
    void vscode.window.showInformationMessage(message);
    this.context.subscriptions.push(
      vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000)
    );
  }

  private async save(input: SaveCardInput): Promise<void> {
    const draft = this.pendingDraft;
    if (draft === null) return;

    try {
      const card = await this.cardService.save(
        { ...input, slug: draft.slug },
        draft.source
      );
      this.pendingDraft = null;
      this.savedFeedback(card);
    } catch (error) {
      await vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
      await this.postPendingDraft();
    }
  }

  private async remove(slug: string): Promise<void> {
    try {
      await this.cardService.remove(slug);
      this.pendingDraft = null;
    } catch (error) {
      await vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
      await this.postPendingDraft();
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isWebviewToHostMessage(message)) return;

    switch (message.type) {
      case "ready":
        this.ready = true;
        await this.postPendingDraft();
        return;
      case "save":
        await this.save(message.input);
        return;
      case "delete":
        await this.remove(message.slug);
        return;
      case "close":
        this.pendingDraft = null;
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const cardService = new CardService();
  const provenance = new ProvenanceTracker(context);
  const panelController = new CardPanelController(
    context.extensionUri,
    context,
    cardService
  );
  const viewRegistration = vscode.window.registerWebviewViewProvider(
    CARD_PANEL_VIEW,
    panelController,
    { webviewOptions: { retainContextWhenHidden: true } }
  );
  const commandRegistration = vscode.commands.registerCommand(
    CAPTURE_COMMAND,
    async (): Promise<void> => {
      try {
        const draft = await captureSelection(provenance, cardService);
        if (draft !== null) await panelController.openPanel(draft);
      } catch (error) {
        await vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
      }
    }
  );

  context.subscriptions.push(viewRegistration, commandRegistration);
}

export function deactivate(): void {}
