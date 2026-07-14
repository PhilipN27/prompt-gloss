import type { JSX } from "react";

export interface AffordanceTarget {
  /** Viewport-relative position (from a DOMRect) to anchor the button above. */
  top: number;
  left: number;
  width: number;
}

interface HighlightAffordanceProps {
  target: AffordanceTarget;
  onClick: () => void;
}

// A single small floating button that appears near a text selection (draft
// input or rendered message) and opens the card panel on click. Positioned
// fixed so it tracks the selection regardless of which scroll container it's
// in. mousedown (not click) + preventDefault so it never steals the current
// text selection before the panel reads it.
export function HighlightAffordance({ target, onClick }: HighlightAffordanceProps): JSX.Element {
  return (
    <button
      type="button"
      className="gloss-affordance"
      data-testid="gloss-affordance"
      style={{
        top: Math.max(target.top - 36, 4),
        left: target.left + target.width / 2
      }}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={onClick}
    >
      + Gloss
    </button>
  );
}
