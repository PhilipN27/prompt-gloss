import { useEffect, useState, type JSX } from "react";
import type { Card } from "@prompt-gloss/core";

export interface PanelDraft {
  /** Present when editing an existing card; absent when creating. */
  slug: string | null;
  term: string;
  aliases: string;
  body: string;
  source: { span: string; message: string };
}

interface CardPanelProps {
  draft: PanelDraft;
  onSave: (input: { term: string; aliases: string[]; body: string }) => void;
  onDelete: () => void;
  onClose: () => void;
}

function toAliasesInput(aliases: string[]): string {
  return aliases.join(", ");
}

function parseAliases(raw: string): string[] {
  return raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

export function draftFromCard(card: Card): PanelDraft {
  return {
    slug: card.slug,
    term: card.term,
    aliases: toAliasesInput(card.aliases),
    body: card.body,
    source: card.source
  };
}

export function draftFromSelection(span: string, message: string): PanelDraft {
  return { slug: null, term: span, aliases: "", body: "", source: { span, message } };
}

// The card panel: non-modal (plain positioned div, no dialog/backdrop, no
// focus trap) so it never steals focus from the draft input (AGENTS.md → UI
// interaction contract). Term is pre-filled from the selection but editable.
// Scope toggle is rendered disabled per v1 scope (ARCHITECTURE.md §8 decision 5).
export function CardPanel({ draft, onSave, onDelete, onClose }: CardPanelProps): JSX.Element {
  const [term, setTerm] = useState(draft.term);
  const [aliases, setAliases] = useState(draft.aliases);
  const [body, setBody] = useState(draft.body);

  // Re-seed local state when a different draft is opened (e.g. switching from
  // create-mode to edit-mode after a match, or opening a different card).
  useEffect(() => {
    setTerm(draft.term);
    setAliases(draft.aliases);
    setBody(draft.body);
  }, [draft]);

  const isEditing = draft.slug !== null;

  return (
    <aside className="gloss-panel" data-testid="gloss-panel" aria-label="Gloss card panel">
      <div className="gloss-panel__header">
        <span>{isEditing ? "Edit card" : "New card"}</span>
        <button
          type="button"
          className="gloss-panel__close"
          aria-label="Close panel"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <label className="gloss-panel__field">
        <span>Term</span>
        <input
          data-testid="panel-term"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </label>

      <label className="gloss-panel__field">
        <span>Aliases (comma-separated)</span>
        <input
          data-testid="panel-aliases"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
        />
      </label>

      <label className="gloss-panel__field">
        <span>Context</span>
        <textarea
          data-testid="panel-body"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <label className="gloss-panel__field gloss-panel__field--disabled">
        <span>Scope</span>
        <select data-testid="panel-scope" disabled value="project" onChange={() => {}}>
          <option value="project">project</option>
        </select>
        <span className="gloss-panel__hint">global scope: v2</span>
      </label>

      <div className="gloss-panel__actions">
        {isEditing ? (
          <button
            type="button"
            className="gloss-panel__delete"
            data-testid="panel-delete"
            onClick={onDelete}
          >
            Delete
          </button>
        ) : null}
        <button
          type="button"
          className="gloss-panel__save"
          data-testid="panel-save"
          disabled={term.trim().length === 0}
          onClick={() => onSave({ term: term.trim(), aliases: parseAliases(aliases), body })}
        >
          Save
        </button>
      </div>
    </aside>
  );
}
