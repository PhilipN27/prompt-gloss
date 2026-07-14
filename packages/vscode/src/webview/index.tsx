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

interface OpenPanel {
  id: number;
  draft: PanelDraft;
}

function WebviewApp(): JSX.Element | null {
  const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebviewMessage>): void => {
      if (event.data.type === "open") {
        setOpenPanel({ id: event.data.id, draft: event.data.draft });
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (openPanel === null) return null;

  return (
    <CardPanel
      draft={openPanel.draft}
      onSave={(input) => {
        setOpenPanel(null);
        vscode.postMessage({ type: "save", id: openPanel.id, input });
      }}
      onDelete={() => {
        if (openPanel.draft.slug === null) return;
        setOpenPanel(null);
        vscode.postMessage({
          type: "delete",
          id: openPanel.id,
          slug: openPanel.draft.slug
        });
      }}
      onClose={() => {
        setOpenPanel(null);
        vscode.postMessage({ type: "close", id: openPanel.id });
      }}
    />
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<WebviewApp />);
