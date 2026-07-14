// Injection budget (ARCHITECTURE.md §6). Given the matched cards for one user
// message, drop session-duplicates, sort most-recently-updated first, greedily
// pack under a token budget (truncating any single oversized card at the
// per-card cap), and emit the exact `<gloss-context>` wrapper. The wrapper is
// snapshot-tested so format drift is always a visible diff.

import { estimateTokens } from "./store.js";
import type { Card } from "./types.js";

export interface BudgetOptions {
  /** Total token budget per message. */
  budget: number;
  /** Per-card token cap; a larger card is truncated at this cap. */
  cardCap: number;
}

/**
 * Defaults per ARCHITECTURE.md §6 (env-overridable by the server, which reads
 * GLOSS_INJECT_BUDGET / GLOSS_CARD_CAP and passes them in — core stays env-free).
 */
export const DEFAULT_BUDGET: BudgetOptions = { budget: 2000, cardCap: 800 };

const TRUNCATION_MARKER = "\n…[truncated by Gloss]";

const CONTEXT_PREAMBLE =
  "The user has attached the following context cards to terms in their message.\n" +
  "Treat them as authoritative background provided by the user.";

export interface PackResult {
  /** The full `<gloss-context>…</gloss-context>` block, or "" if nothing packed. */
  payload: string;
  /** Slugs actually injected, in packing (most-recently-updated-first) order. */
  injectedSlugs: string[];
  /** Estimated tokens the payload contributes (headers + bodies of packed cards). */
  usedTokens: number;
}

/**
 * In-memory, server-process-scoped log of what has been injected this session.
 * Maps slug → the `updated` timestamp at last injection. A restart resets it
 * (accepted in v1 — §6.4: worst case one duplicate injection per card).
 */
export class InjectionLog {
  private readonly lastInjectedUpdated = new Map<string, string>();

  /** Should this card be injected now? Yes if unseen or updated since last time. */
  shouldInject(card: Pick<Card, "slug" | "updated">): boolean {
    const last = this.lastInjectedUpdated.get(card.slug);
    if (last === undefined) return true;
    return new Date(card.updated).getTime() > new Date(last).getTime();
  }

  /** Record that a card was injected at its current `updated`. */
  record(card: Pick<Card, "slug" | "updated">): void {
    this.lastInjectedUpdated.set(card.slug, card.updated);
  }

  /** Plain slug → updated-ISO map, the file-backed twin's payload (TERMINAL.md §4.2). */
  toJSON(): Record<string, string> {
    return Object.fromEntries(this.lastInjectedUpdated);
  }

  /**
   * Rebuild a log from a parsed JSON value. Total: corrupted input (non-object,
   * non-string entries) degrades to skipping the bad parts — a broken session
   * state file must never break the hook.
   */
  static fromJSON(value: unknown): InjectionLog {
    const log = new InjectionLog();
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return log;
    }
    for (const [slug, updated] of Object.entries(value)) {
      if (typeof updated === "string") {
        log.lastInjectedUpdated.set(slug, updated);
      }
    }
    return log;
  }
}

function cardHeader(card: Card): string {
  const aliasAttr =
    card.aliases.length > 0 ? ` aliases="${card.aliases.join(", ")}"` : "";
  return `<card term="${card.term}"${aliasAttr} file=".gloss/cards/${card.slug}.md">`;
}

/** Body truncated at the per-card cap (in tokens), with a marker when cut. */
function bodyWithinCap(
  body: string,
  cardCap: number
): { text: string; truncated: boolean } {
  if (estimateTokens(body) <= cardCap) return { text: body, truncated: false };
  // Cap is in tokens (ceil(chars/4)); reserve room for the marker.
  const maxChars = Math.max(0, cardCap * 4 - TRUNCATION_MARKER.length);
  return { text: body.slice(0, maxChars) + TRUNCATION_MARKER, truncated: true };
}

/** Render one `<card>…</card>` block. */
function renderCard(card: Card, cardCap: number): string {
  const { text } = bodyWithinCap(card.body, cardCap);
  return `${cardHeader(card)}\n${text}\n</card>`;
}

/**
 * Pack the matched cards into a `<gloss-context>` payload under the budget,
 * mutating `log` to record what was injected. Order: drop session-duplicates,
 * sort updated-desc, greedy pack (skip-and-continue on overflow), truncate any
 * single card exceeding the cap.
 */
export function packInjection(
  matched: Card[],
  log: InjectionLog,
  options: BudgetOptions = DEFAULT_BUDGET
): PackResult {
  const empty: PackResult = { payload: "", injectedSlugs: [], usedTokens: 0 };

  // 1. Drop cards already injected this session (unless updated since).
  const fresh = matched.filter((c) => log.shouldInject(c));
  if (fresh.length === 0) return empty;

  // 2. Sort most-recently-updated first (stable on ties by original order).
  const sorted = [...fresh].sort(
    (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
  );

  // 3. Greedy pack. The budget accounts for each card's rendered header+body;
  // the wrapper preamble/tags are framing overhead outside the per-card budget.
  const blocks: string[] = [];
  const injectedSlugs: string[] = [];
  let usedTokens = 0;

  for (const card of sorted) {
    const block = renderCard(card, options.cardCap);
    const blockTokens = estimateTokens(block);
    if (usedTokens + blockTokens > options.budget) {
      // Skip this card and keep going — a smaller/older card may still fit.
      continue;
    }
    blocks.push(block);
    injectedSlugs.push(card.slug);
    usedTokens += blockTokens;
    log.record(card);
  }

  if (blocks.length === 0) return empty;

  const payload = [
    `<gloss-context>`,
    CONTEXT_PREAMBLE,
    ...blocks,
    `</gloss-context>`
  ].join("\n");
  return { payload, injectedSlugs, usedTokens };
}
