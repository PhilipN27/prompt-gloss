import type { CardSource } from "@prompt-gloss/core";
import { draftFromCard, draftFromSelection, type PanelDraft } from "@prompt-gloss/panel-ui";
import * as vscode from "vscode";
import type { CardService } from "./cardService.js";
import type { ProvenanceTracker } from "./provenance.js";

export interface CaptureContext {
  id: number;
  draft: PanelDraft;
  folderUri: vscode.Uri;
  source: CardSource & { origin: "vscode-terminal" };
}

export async function captureSelection(
  provenance: ProvenanceTracker,
  cardService: CardService,
  id: number
): Promise<CaptureContext | null> {
  const terminal = vscode.window.activeTerminal;
  if (terminal === undefined) {
    void vscode.window.showInformationMessage("Open an integrated terminal first");
    return null;
  }

  const saved = await vscode.env.clipboard.readText();
  const sentinel = `__prompt_gloss_no_selection_${globalThis.crypto.randomUUID()}__`;
  let copied: string;

  try {
    await vscode.env.clipboard.writeText(sentinel);
    await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
    copied = await vscode.env.clipboard.readText();
  } finally {
    await vscode.env.clipboard.writeText(saved);
  }

  if (copied === sentinel) {
    void vscode.window.showInformationMessage("Select terminal text first");
    return null;
  }

  const span = copied.trim();
  if (span.length === 0) {
    void vscode.window.showInformationMessage("Select terminal text first");
    return null;
  }

  const folderUri = cardService.resolveFolderUri(terminal);
  const message = provenance.excerptFor(terminal, span);
  const source = { span, message, origin: "vscode-terminal" } as const;
  const existing = await cardService.matchExisting(span, folderUri);
  return {
    id,
    draft:
      existing === null ? draftFromSelection(span, message) : draftFromCard(existing),
    folderUri,
    source
  };
}
