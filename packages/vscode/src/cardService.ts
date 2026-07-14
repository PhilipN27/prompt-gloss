import { CardStore, matchMessage, type Card, type CardSource, type NewCardInput } from "@prompt-gloss/core";
import * as vscode from "vscode";
import type { SaveCardInput } from "./messaging.js";

export interface CardSaveInput extends SaveCardInput {
  slug: string | null;
}

export class CardService {
  private readonly stores = new Map<string, CardStore>();

  private workspaceFolderForActiveTerminal(): vscode.WorkspaceFolder {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) {
      throw new Error("Gloss needs an open workspace folder to save context cards.");
    }

    const cwd = vscode.window.activeTerminal?.shellIntegration?.cwd;
    if (cwd !== undefined) {
      const matchingFolder = vscode.workspace.getWorkspaceFolder(cwd);
      if (matchingFolder !== undefined) return matchingFolder;
    }

    return folders[0]!;
  }

  private storeForActiveTerminal(): CardStore {
    const folder = this.workspaceFolderForActiveTerminal();
    const key = folder.uri.toString();
    let store = this.stores.get(key);
    if (store === undefined) {
      store = new CardStore(folder.uri.fsPath);
      this.stores.set(key, store);
    }
    return store;
  }

  public async matchExisting(span: string): Promise<Card | null> {
    const store = this.storeForActiveTerminal();
    const index = await store.getIndex();
    const slug = matchMessage(span, index)[0];
    return slug === undefined ? null : store.get(slug);
  }

  public async save(input: CardSaveInput, source: CardSource): Promise<Card> {
    const store = this.storeForActiveTerminal();
    const stampedSource: CardSource = { ...source, origin: "vscode-terminal" };

    if (input.slug !== null) {
      const updated = await store.update(input.slug, {
        term: input.term,
        aliases: input.aliases,
        body: input.body,
        source: stampedSource
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
      source: stampedSource
    };
    return store.create(newCard);
  }

  public async remove(slug: string): Promise<void> {
    await this.storeForActiveTerminal().delete(slug);
  }
}
