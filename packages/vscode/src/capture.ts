import type { CardSource } from "@prompt-gloss/core";
import { draftFromCard, draftFromSelection, type PanelDraft } from "@prompt-gloss/panel-ui";
import * as vscode from "vscode";
import { resolveCaptureSpan } from "./capture-span.js";
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

  // Claude Code's TUI enables mouse reporting, so a drag never yields a native
  // terminal selection — Claude consumes the mouse events and auto-copies the
  // selection to the clipboard. Read the clipboard first (that IS the user's
  // selection there), then probe for a native selection via copySelection for
  // plain shells / mouse-off TUIs. The sentinel dance tells the two apart
  // without clobbering the clipboard we just read.
  const clipboard = await vscode.env.clipboard.readText();
  const sentinel = `__prompt_gloss_no_selection_${globalThis.crypto.randomUUID()}__`;
  let copied: string;

  try {
    await vscode.env.clipboard.writeText(sentinel);
    await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
    copied = await vscode.env.clipboard.readText();
  } finally {
    await vscode.env.clipboard.writeText(clipboard);
  }

  const nativeSelection = copied === sentinel ? "" : copied;
  const span = resolveCaptureSpan({ nativeSelection, clipboard });
  if (span === null) {
    void vscode.window.showInformationMessage(
      "Select some terminal text first (drag to highlight in Claude, then press the Gloss key)"
    );
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
