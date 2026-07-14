// The injection pipeline: match a user message against the project's cards and
// pack them under the budget. This is the SINGLE place matching+budget happen;
// both the real SDK UserPromptSubmit hook and the fake agent call it, so the
// integration/e2e tests exercise the identical pipeline up to the Injector
// boundary (ARCHITECTURE.md §9).

import {
  CardStore,
  InjectionLog,
  matchMessage,
  packInjection,
  type BudgetOptions,
  type Card
} from "@prompt-gloss/core";

export interface InjectionResult {
  /** The `<gloss-context>` payload, or "" when nothing was injected. */
  payload: string;
  /** Slugs actually injected (drives the SSE indicator). */
  slugs: string[];
}

/**
 * Compute the injection for one user message: rebuild the index from disk (so
 * hand edits are picked up), match, resolve slugs to full cards, and pack under
 * the budget. Mutates `log` to record what was injected (session dedup).
 */
export async function computeInjection(
  message: string,
  store: CardStore,
  log: InjectionLog,
  budget: BudgetOptions
): Promise<InjectionResult> {
  const index = await store.buildIndex();
  const slugs = matchMessage(message, index);
  if (slugs.length === 0) return { payload: "", slugs: [] };

  const cards: Card[] = [];
  for (const slug of slugs) {
    const card = await store.get(slug);
    if (card) cards.push(card);
  }

  const packed = packInjection(cards, log, budget);
  return { payload: packed.payload, slugs: packed.injectedSlugs };
}
