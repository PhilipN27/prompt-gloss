import type { PanelDraft } from "@prompt-gloss/panel-ui";

export interface SaveCardInput {
  term: string;
  aliases: string[];
  body: string;
}

/** Messages sent by the extension host to the card-panel webview. */
export type HostToWebviewMessage = { type: "open"; id: number; draft: PanelDraft };

/** Messages sent by the card-panel webview to the extension host. */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "save"; id: number; input: SaveCardInput }
  | { type: "delete"; id: number; slug: string }
  | { type: "close"; id: number };

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
      return true;
    case "close":
      return isCaptureId(value.id);
    case "save":
      return isCaptureId(value.id) && isSaveCardInput(value.input);
    case "delete":
      return isCaptureId(value.id) && typeof value.slug === "string";
    default:
      return false;
  }
}
