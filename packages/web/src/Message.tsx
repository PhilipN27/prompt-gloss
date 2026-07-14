import type { JSX } from "react";
import type { ChatMessage } from "./types.js";

interface MessageProps {
  message: ChatMessage;
  onOpenCard: (slug: string) => void;
}

// A single chat row. Rendered text is selectable (the highlight layer reads
// window.getSelection() against the `data-message-id` host below). User
// messages that triggered injection show a quiet chip row (AGENTS.md →
// injection indicator); clicking a chip opens that card in the panel.
export function Message({ message, onOpenCard }: MessageProps): JSX.Element {
  return (
    <div className={`gloss-message gloss-message--${message.role}`} data-message-id={message.id}>
      <div className="gloss-message__role">{message.role === "user" ? "You" : "Claude"}</div>
      <div className="gloss-message__text">
        {message.text}
        {message.pending ? <span className="gloss-message__cursor" aria-hidden="true" /> : null}
      </div>
      {message.injectedSlugs.length > 0 ? (
        <div className="gloss-injection-chips" data-testid="injection-chips">
          {message.injectedSlugs.map((slug) => (
            <button
              key={slug}
              type="button"
              className="gloss-injection-chip"
              data-testid={`injection-chip-${slug}`}
              onClick={() => onOpenCard(slug)}
            >
              {slug}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
