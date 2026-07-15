import { CardPanel, type PanelDraft } from "@prompt-gloss/panel-ui";
import "@prompt-gloss/panel-ui/card-panel.css";
import "./card-list.css";
import { useEffect, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import type {
  CardSummary,
  HostToWebviewMessage,
  WebviewToHostMessage
} from "../messaging.js";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

type View =
  | { mode: "loading" }
  | { mode: "list"; project: string; cards: CardSummary[] }
  | { mode: "edit"; id: number; draft: PanelDraft };

function CardList({
  project,
  cards,
  onEdit
}: {
  project: string;
  cards: CardSummary[];
  onEdit: (slug: string) => void;
}): JSX.Element {
  return (
    <div className="gloss-list">
      <div className="gloss-list__header">
        <span className="gloss-list__title">Gloss cards</span>
        {project.length > 0 ? (
          <span className="gloss-list__project" title={project}>
            {project}
          </span>
        ) : null}
      </div>
      {cards.length === 0 ? (
        <p className="gloss-list__empty">
          {project.length > 0
            ? "No cards in this project yet. Highlight text in the terminal and press the Gloss key (Ctrl+Alt+G) to add one."
            : "Open a project folder to see its Gloss cards."}
        </p>
      ) : (
        <ul className="gloss-list__items">
          {cards.map((card) => (
            <li key={card.slug}>
              <button
                className="gloss-list__item"
                type="button"
                onClick={() => onEdit(card.slug)}
              >
                <span className="gloss-list__term">{card.term}</span>
                {card.aliases.length > 0 ? (
                  <span className="gloss-list__aliases">{card.aliases.join(", ")}</span>
                ) : null}
                {card.preview.length > 0 ? (
                  <span className="gloss-list__preview">{card.preview}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WebviewApp(): JSX.Element | null {
  const [view, setView] = useState<View>({ mode: "loading" });

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HostToWebviewMessage>): void => {
      const data = event.data;
      if (data.type === "open") {
        setView({ mode: "edit", id: data.id, draft: data.draft });
      } else if (data.type === "list") {
        setView({ mode: "list", project: data.project, cards: data.cards });
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (view.mode === "loading") return null;

  if (view.mode === "list") {
    return (
      <CardList
        project={view.project}
        cards={view.cards}
        onEdit={(slug) => vscode.postMessage({ type: "edit", slug })}
      />
    );
  }

  return (
    <CardPanel
      draft={view.draft}
      onSave={(input) => {
        setView({ mode: "loading" });
        vscode.postMessage({ type: "save", id: view.id, input });
      }}
      onDelete={() => {
        if (view.draft.slug === null) return;
        setView({ mode: "loading" });
        vscode.postMessage({ type: "delete", id: view.id, slug: view.draft.slug });
      }}
      onClose={() => {
        setView({ mode: "loading" });
        vscode.postMessage({ type: "close", id: view.id });
      }}
    />
  );
}

const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<WebviewApp />);
