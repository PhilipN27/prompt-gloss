import type { PanelDraft } from "@prompt-gloss/panel-ui";

export interface SaveCardInput {
  term: string;
  aliases: string[];
  body: string;
}

/** Messages sent by the extension host to the card-panel webview. */
export type HostToWebviewMessage = { type: "open"; draft: PanelDraft };

/** Messages sent by the card-panel webview to the extension host. */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "save"; input: SaveCardInput }
  | { type: "delete"; slug: string }
  | { type: "close" };

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

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "ready":
    case "close":
      return true;
    case "save":
      return isSaveCardInput(value.input);
    case "delete":
      return typeof value.slug === "string";
    default:
      return false;
  }
}
