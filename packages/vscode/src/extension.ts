import type { Card } from "@prompt-gloss/core";
import { draftFromCard } from "@prompt-gloss/panel-ui";
import * as vscode from "vscode";
import { captureSelection, type CaptureContext } from "./capture.js";
import { CardService } from "./cardService.js";
import {
  isWebviewToHostMessage,
  toCardSummary,
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

/** Last path segment of a workspace folder — the project label shown in the list. */
function projectName(folderUri: vscode.Uri): string {
  const segments = folderUri.path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? folderUri.path;
}

class CardPanelController implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private viewSubscriptions: vscode.Disposable | undefined;
  private ready = false;
  private activeContextId: number | null = null;
  private nextId = 1;
  private readonly captureContexts = new Map<number, CaptureContext>();

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly cardService: CardService
  ) {}

  public allocateId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

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
    const visibilitySubscription = webviewView.onDidChangeVisibility(() => {
      // Re-scope the browse list to the active project each time the panel is
      // revealed — unless a capture/edit form is currently open.
      if (webviewView.visible && this.activeContextId === null) {
        void this.postList();
      }
    });
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
      visibilitySubscription,
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

  /** Refresh the browse list for the active project (no-op while an edit is open). */
  public async refreshList(): Promise<void> {
    if (this.activeContextId === null) await this.postList();
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

  private async postList(): Promise<void> {
    if (!this.ready || this.view === undefined) return;
    const folderUri = this.cardService.resolveActiveFolderUri();
    const message: HostToWebviewMessage =
      folderUri === null
        ? { type: "list", project: "", cards: [] }
        : {
            type: "list",
            project: projectName(folderUri),
            cards: (await this.cardService.list(folderUri)).map(toCardSummary)
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
      await this.postList();
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
      await this.postList();
    } catch (error) {
      this.activeContextId = id;
      await vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
      await this.postContext(id);
    }
  }

  /** Open an existing project card from the browse list in the edit form. */
  private async editCard(slug: string): Promise<void> {
    const folderUri = this.cardService.resolveActiveFolderUri();
    if (folderUri === null) return;
    const card = await this.cardService.get(slug, folderUri);
    if (card === null) {
      // Deleted out of band — refresh so the stale row disappears.
      await this.postList();
      return;
    }
    await this.openPanel({
      id: this.allocateId(),
      draft: draftFromCard(card),
      folderUri,
      source: { ...card.source, origin: "vscode-terminal" }
    });
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
        } else {
          await this.postList();
        }
        return;
      case "save":
        await this.save(message.id, message.input);
        return;
      case "delete":
        await this.remove(message.id, message.slug);
        return;
      case "edit":
        await this.editCard(message.slug);
        return;
      case "refresh":
        await this.postList();
        return;
      case "close":
        this.forgetContext(message.id);
        await this.postList();
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
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
        const captureContext = await captureSelection(
          provenance,
          cardService,
          panelController.allocateId()
        );
        if (captureContext !== null) {
          await panelController.openPanel(captureContext);
        }
      } catch (error) {
        await vscode.window.showErrorMessage(`Gloss: ${errorMessage(error)}`);
      }
    }
  );
  // Switching the active terminal can change which project is in focus — keep
  // the browse list scoped to it.
  const terminalChange = vscode.window.onDidChangeActiveTerminal(() => {
    void panelController.refreshList();
  });

  context.subscriptions.push(
    panelController,
    viewRegistration,
    commandRegistration,
    terminalChange
  );
}

export function deactivate(): void {}
