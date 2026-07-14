// Selection capture (AGENTS.md → UI interaction contract; ARCHITECTURE.md §3.1).
// Two distinct origins feed the same shape so the rest of the UI (affordance,
// panel) doesn't care which path produced a selection:
//   - "draft": the textarea, via selectionStart/selectionEnd.
//   - "message": a rendered message, via window.getSelection() DOM ranges.

export interface SelectionInfo {
  origin: "draft" | "message";
  /** The selected text, trimmed. Never empty. */
  spanText: string;
  /** <=200-char excerpt of the message/draft the span was selected from. */
  messageExcerpt: string;
  /** Viewport-relative bounding rect, for positioning the floating affordance. */
  rect: DOMRect;
  /** For "message" origin, the id of the message the selection lives in. */
  messageId?: string;
}

const EXCERPT_MAX = 200;

export function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_MAX ? `${trimmed.slice(0, EXCERPT_MAX - 1)}…` : trimmed;
}

/**
 * Read the current selection from a draft <textarea> and, if non-empty,
 * return its SelectionInfo with a rect derived from a mirror-measured caret
 * position. Callers pass the rect explicitly (computed by the caller, which
 * owns the DOM) — this function is pure text/index logic reused by tests.
 */
export function draftSelectionText(
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null
): string | null {
  if (selectionStart === null || selectionEnd === null) return null;
  if (selectionStart === selectionEnd) return null;
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const text = value.slice(start, end).trim();
  return text.length > 0 ? text : null;
}

/**
 * Read the current window selection and, if it lies entirely inside a single
 * element bearing `data-message-id`, return its text + that id. Returns null
 * for empty, collapsed, or cross-message selections (v1 policy, ARCHITECTURE.md
 * §9 risks: "single-message selections only").
 */
export function messageSelectionInfo(): {
  text: string;
  messageId: string;
  rect: DOMRect;
} | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (text.length === 0) return null;

  const range = sel.getRangeAt(0);
  const container =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  const host = container?.closest<HTMLElement>("[data-message-id]");
  if (!host) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return { text, messageId: host.dataset.messageId ?? "", rect };
}
