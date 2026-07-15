import { CardStore, matchMessage, type Card, type CardSource, type NewCardInput } from "@prompt-gloss/core";
import * as vscode from "vscode";
import type { SaveCardInput } from "./messaging.js";

export interface CardSaveInput extends SaveCardInput {
  slug: string | null;
}

export class CardService {
  private readonly stores = new Map<string, CardStore>();

  public resolveFolderUri(terminal: vscode.Terminal): vscode.Uri {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) {
      throw new Error("Gloss needs an open workspace folder to save context cards.");
    }

    const cwd = terminal.shellIntegration?.cwd;
    if (cwd !== undefined) {
      const matchingFolder = vscode.workspace.getWorkspaceFolder(cwd);
      if (matchingFolder !== undefined) return matchingFolder.uri;
    }

    if (folders.length === 1) return folders[0]!.uri;

    throw new Error(
      "Gloss could not determine which workspace folder owns the active terminal."
    );
  }

  /**
   * The project whose cards the panel should browse when opened without a
   * capture. Prefers the active terminal's folder (matches capture scoping),
   * then the active editor's folder, then the single workspace folder. Returns
   * null when no folder is open. In a multi-root workspace with no active
   * terminal/editor it falls back to the first folder.
   */
  public resolveActiveFolderUri(): vscode.Uri | null {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) return null;

    const cwd = vscode.window.activeTerminal?.shellIntegration?.cwd;
    if (cwd !== undefined) {
      const folder = vscode.workspace.getWorkspaceFolder(cwd);
      if (folder !== undefined) return folder.uri;
    }

    const activeDoc = vscode.window.activeTextEditor?.document.uri;
    if (activeDoc !== undefined) {
      const folder = vscode.workspace.getWorkspaceFolder(activeDoc);
      if (folder !== undefined) return folder.uri;
    }

    return folders[0]!.uri;
  }

  private storeForFolder(folderUri: vscode.Uri): CardStore {
    const key = folderUri.toString();
    let store = this.stores.get(key);
    if (store === undefined) {
      store = new CardStore(folderUri.fsPath);
      this.stores.set(key, store);
    }
    return store;
  }

  public async matchExisting(span: string, folderUri: vscode.Uri): Promise<Card | null> {
    const store = this.storeForFolder(folderUri);
    const index = await store.rebuildIndex();
    const slug = matchMessage(span, index)[0];
    return slug === undefined ? null : store.get(slug);
  }

  /** Every card in `folderUri`'s `.gloss/` — the browse list is scoped per project. */
  public async list(folderUri: vscode.Uri): Promise<Card[]> {
    return this.storeForFolder(folderUri).list();
  }

  public async get(slug: string, folderUri: vscode.Uri): Promise<Card | null> {
    return this.storeForFolder(folderUri).get(slug);
  }

  public async save(
    input: CardSaveInput,
    folderUri: vscode.Uri,
    source: CardSource
  ): Promise<Card> {
    const store = this.storeForFolder(folderUri);

    if (input.slug !== null) {
      const updated = await store.update(input.slug, {
        term: input.term,
        aliases: input.aliases,
        body: input.body
      });
      if (updated === null) {
        throw new Error(`Gloss card '${input.slug}' no longer exists.`);
      }
      return updated;
    }

    const newCard: NewCardInput = {
      term: input.term,
      aliases: input.aliases,
      body: input.body,
      source: { ...source, origin: "vscode-terminal" }
    };
    return store.create(newCard);
  }

  public async remove(slug: string, folderUri: vscode.Uri): Promise<void> {
    await this.storeForFolder(folderUri).delete(slug);
  }
}
