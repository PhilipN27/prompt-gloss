import type { Card } from "@prompt-gloss/core";
import type { PanelDraft } from "@prompt-gloss/panel-ui";

export interface SaveCardInput {
  term: string;
  aliases: string[];
  body: string;
}

/** A card as shown in the panel's browse list (project-scoped). */
export interface CardSummary {
  slug: string;
  term: string;
  aliases: string[];
  preview: string;
}

const PREVIEW_MAX_CHARS = 120;

/** Collapse a card body to a one-line preview for the browse list. */
export function toCardSummary(card: Card): CardSummary {
  const firstLine = card.body.split("\n").find((line) => line.trim().length > 0) ?? "";
  const collapsed = firstLine.trim().replace(/\s+/g, " ");
  const preview =
    collapsed.length > PREVIEW_MAX_CHARS
      ? `${collapsed.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`
      : collapsed;
  return { slug: card.slug, term: card.term, aliases: card.aliases, preview };
}

/** Messages sent by the extension host to the card-panel webview. */
export type HostToWebviewMessage =
  | { type: "open"; id: number; draft: PanelDraft }
  | { type: "list"; project: string; cards: CardSummary[] };

/** Messages sent by the card-panel webview to the extension host. */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "save"; id: number; input: SaveCardInput }
  | { type: "delete"; id: number; slug: string }
  | { type: "close"; id: number }
  | { type: "edit"; slug: string }
  | { type: "refresh" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSaveCardInput(value: unknown): value is SaveCardInput {
  return (
    isRecord(value) &&
    typeof value.term === "string" &&
    Array.isArray(value.aliases) &&
    value.aliases.every((alias) => typeof alias === "string") &&
    typeof value.body === "string"
  );
}

function isCaptureId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "ready":
    case "refresh":
      return true;
    case "close":
      return isCaptureId(value.id);
    case "save":
      return isCaptureId(value.id) && isSaveCardInput(value.input);
    case "delete":
      return isCaptureId(value.id) && typeof value.slug === "string";
    case "edit":
      return typeof value.slug === "string" && value.slug.length > 0;
    default:
      return false;
  }
}
