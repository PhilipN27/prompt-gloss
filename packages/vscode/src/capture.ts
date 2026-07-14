import { draftFromCard, draftFromSelection, type PanelDraft } from "@prompt-gloss/panel-ui";
import * as vscode from "vscode";
import type { CardService } from "./cardService.js";
import type { ProvenanceTracker } from "./provenance.js";

export async function captureSelection(
  provenance: ProvenanceTracker,
  cardService: CardService
): Promise<PanelDraft | null> {
  const saved = await vscode.env.clipboard.readText();
  let span: string;

  try {
    await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
    span = await vscode.env.clipboard.readText();
  } finally {
    await vscode.env.clipboard.writeText(saved);
  }

  span = span.trim();
  if (span.length === 0) {
    await vscode.window.showInformationMessage("Select terminal text first");
    return null;
  }

  const message = provenance.excerptFor(vscode.window.activeTerminal, span);
  const existing = await cardService.matchExisting(span);
  if (existing === null) return draftFromSelection(span, message);

  return {
    ...draftFromCard(existing),
    source: { span, message }
  };
}
