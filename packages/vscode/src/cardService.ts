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
