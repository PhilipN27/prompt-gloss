// Matcher (ARCHITECTURE.md §5). Input: message text + the index. Output: a
// deduplicated, sorted set of card slugs. Exact + case-insensitive + simple
// stemming, word-boundary anchored. The behavioral contract is the golden set
// (packages/core/eval/cases.jsonl).

import type { Index } from "./types.js";

/** NFKC, lowercase, collapse all whitespace runs to a single space, trim. */
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// A token is a maximal run of Unicode letters/numbers, optionally carrying an
// apostrophe + suffix (so "engine's" survives as one token for the stemmer).
const TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Tokenize normalized-or-raw text on Unicode word boundaries. */
export function tokenize(text: string): string[] {
  return normalize(text).match(TOKEN_RE) ?? [];
}

/**
 * Stem-fold a single token (ARCHITECTURE.md §5.3): strip a trailing possessive
 * `'s`, then strip a trailing plural `s` when the token is longer than 3 chars
 * and does not end in `ss`, `us`, or `is`. This is the entirety of v1 stemming.
 */
export function stemFold(token: string): string {
  let t = token;
  // Strip possessive 's / ’s.
  t = t.replace(/['’]s$/u, "");
  // Also handle a bare trailing apostrophe (e.g. plural possessive "engines'").
  t = t.replace(/['’]$/u, "");
  if (t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) {
    t = t.slice(0, -1);
  }
  return t;
}

function stemTokens(tokens: string[]): string[] {
  return tokens.map(stemFold);
}

/** True if `needle` occurs as a consecutive run inside `haystack`. */
function containsSubsequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let hit = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/** Terms containing non-word characters (e.g. `foo.bar`) aren't tokenizable as
 * a phrase; match them by literal substring guarded by non-alphanumeric edges. */
function hasNonWordChar(term: string): boolean {
  const stripped = term.replace(/\s+/g, "");
  return /[^\p{L}\p{N}]/u.test(stripped);
}

// For boundary-guarding, `_` counts as a word character even though it is not
// alphanumeric: it is the canonical identifier joiner, so a term like
// `analytics_rollup` must NOT match inside `my_analytics_rollup_v2`. The spec
// (§5.4) says "non-alphanumeric boundaries"; treating `_` as word-internal is
// the reading that serves the intent (don't fire inside a larger identifier).
function isBoundaryWordChar(ch: string): boolean {
  return ch !== "" && /[\p{L}\p{N}_]/u.test(ch);
}

function literalGuardedMatch(normalizedMessage: string, normalizedTerm: string): boolean {
  let from = 0;
  for (;;) {
    const idx = normalizedMessage.indexOf(normalizedTerm, from);
    if (idx === -1) return false;
    const before = idx === 0 ? "" : normalizedMessage[idx - 1]!;
    const afterIdx = idx + normalizedTerm.length;
    const after =
      afterIdx >= normalizedMessage.length ? "" : normalizedMessage[afterIdx]!;
    if (!isBoundaryWordChar(before) && !isBoundaryWordChar(after)) return true;
    // This occurrence was inside a larger identifier; keep scanning.
    from = idx + 1;
  }
}

interface Surface {
  slug: string;
  /** The term/alias string as authored. */
  text: string;
}

/** Match a message against the index, returning a sorted, deduped slug list. */
export function matchMessage(message: string, index: Index): string[] {
  if (message.trim().length === 0 || index.cards.length === 0) return [];

  const normalizedMessage = normalize(message);
  const messageStems = stemTokens(tokenize(message));
  const matched = new Set<string>();

  // Every term and alias is a "surface" that resolves to its owning card slug.
  const surfaces: Surface[] = [];
  for (const card of index.cards) {
    surfaces.push({ slug: card.slug, text: card.term });
    for (const alias of card.aliases) surfaces.push({ slug: card.slug, text: alias });
  }

  for (const surface of surfaces) {
    if (matched.has(surface.slug)) {
      // Still worth continuing other surfaces of other cards, but this card is
      // already in — skip its remaining surfaces cheaply.
      continue;
    }
    if (hasNonWordChar(surface.text)) {
      if (literalGuardedMatch(normalizedMessage, normalize(surface.text))) {
        matched.add(surface.slug);
      }
      continue;
    }
    const termStems = stemTokens(tokenize(surface.text));
    if (containsSubsequence(messageStems, termStems)) {
      matched.add(surface.slug);
    }
  }

  return [...matched].sort();
}
