import type { Card } from "@prompt-gloss/core";
import * as vscode from "vscode";
import { captureSelection, type CaptureContext } from "./capture.js";
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

class CardPanelController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private viewSubscriptions: vscode.Disposable | undefined;
  private ready = false;
  private activeContextId: number | null = null;
  private readonly captureContexts = new Map<number, CaptureContext>();

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly cardService: CardService
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.disposeViewSubscriptions();
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
        this.activeContextId = null;
        this.captureContexts.clear();
        this.disposeViewSubscriptions();
      }
    });
    this.viewSubscriptions = vscode.Disposable.from(
      messageSubscription,
      disposeSubscription
    );
  }

  public async openPanel(captureContext: CaptureContext): Promise<void> {
    this.captureContexts.set(captureContext.id, captureContext);
    this.activeContextId = captureContext.id;
    const focus = vscode.commands.executeCommand(`${CARD_PANEL_VIEW}.focus`);
    if (this.ready) await this.postContext(captureContext.id);
    await focus;
  }

  private async postContext(id: number): Promise<void> {
    if (!this.ready || this.view === undefined) return;
    const captureContext = this.captureContexts.get(id);
    if (captureContext === undefined) return;
    const message: HostToWebviewMessage = {
      type: "open",
      id,
      draft: captureContext.draft
    };
    await this.view.webview.postMessage(message);
  }

  private savedFeedback(card: Card): void {
    const message = `Gloss: card '${card.term}' saved to .gloss/`;
    void vscode.window.showInformationMessage(message);
    vscode.window.setStatusBarMessage(`$(check) ${message}`, 3000);
  }

  private forgetContext(id: number): void {
    this.captureContexts.delete(id);
    if (this.activeContextId === id) this.activeContextId = null;
  }

  private async save(id: number, input: SaveCardInput): Promise<void> {
    const captureContext = this.captureContexts.get(id);
    if (captureContext === undefined) return;

    try {
      const card = await this.cardService.save(
        { ...input, slug: captureContext.draft.slug },
        captureContext.folderUri,
        captureContext.source
      );
      this.forgetContext(id);
      this.savedFeedback(card);
    } catch (error) {
      captureContext.draft = {
        ...captureContext.draft,
        term: input.term,
        aliases: input.aliases.join(", "),
        body: input.body
      };
      this.activeContextId = id;
      await vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
      await this.postContext(id);
    }
  }

  private async remove(id: number, slug: string): Promise<void> {
    const captureContext = this.captureContexts.get(id);
    if (captureContext === undefined || captureContext.draft.slug !== slug) return;

    try {
      await this.cardService.remove(slug, captureContext.folderUri);
      this.forgetContext(id);
    } catch (error) {
      this.activeContextId = id;
      await vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
      await this.postContext(id);
    }
  }

  private disposeViewSubscriptions(): void {
    const subscriptions = this.viewSubscriptions;
    this.viewSubscriptions = undefined;
    subscriptions?.dispose();
  }

  public dispose(): void {
    this.disposeViewSubscriptions();
    this.captureContexts.clear();
    this.view = undefined;
    this.ready = false;
    this.activeContextId = null;
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isWebviewToHostMessage(message)) return;

    switch (message.type) {
      case "ready":
        this.ready = true;
        if (this.activeContextId !== null) {
          await this.postContext(this.activeContextId);
        }
        return;
      case "save":
        await this.save(message.id, message.input);
        return;
      case "delete":
        await this.remove(message.id, message.slug);
        return;
      case "close":
        this.forgetContext(message.id);
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  let nextCaptureId = 1;
  const cardService = new CardService();
  const provenance = new ProvenanceTracker(context);
  const panelController = new CardPanelController(
    context.extensionUri,
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
        const captureId = nextCaptureId;
        nextCaptureId += 1;
        const captureContext = await captureSelection(
          provenance,
          cardService,
          captureId
        );
        if (captureContext !== null) {
          await panelController.openPanel(captureContext);
        }
      } catch (error) {
        await vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
      }
    }
  );

  context.subscriptions.push(
    panelController,
    viewRegistration,
    commandRegistration
  );
}

export function deactivate(): void {}
