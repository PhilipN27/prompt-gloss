// Local UI-only chat state. Distinct from the server's AgentEvent stream —
// ChatPane folds AgentEvents into this shape as they arrive.

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Card slugs injected on this message (user messages only; empty = none). */
  injectedSlugs: string[];
  /** True while an assistant message is still streaming. */
  pending: boolean;
}
