import { CardPanel, type PanelDraft } from "@prompt-gloss/panel-ui";
import "@prompt-gloss/panel-ui/card-panel.css";
import { useEffect, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import type { HostToWebviewMessage, WebviewToHostMessage } from "../messaging.js";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

function WebviewApp(): JSX.Element | null {
  const [draft, setDraft] = useState<PanelDraft | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebviewMessage>): void => {
      if (event.data.type === "open") setDraft(event.data.draft);
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (draft === null) return null;

  return (
    <CardPanel
      draft={draft}
      onSave={(input) => {
        setDraft(null);
        vscode.postMessage({ type: "save", input });
      }}
      onDelete={() => {
        if (draft.slug === null) return;
        setDraft(null);
        vscode.postMessage({ type: "delete", slug: draft.slug });
      }}
      onClose={() => {
        setDraft(null);
        vscode.postMessage({ type: "close" });
      }}
    />
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<WebviewApp />);
