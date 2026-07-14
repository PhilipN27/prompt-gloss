// (De)serialization of card files: YAML frontmatter + markdown body
// (ARCHITECTURE.md §4). Parsing is total — it returns a discriminated result
// instead of throwing — so the store can skip a malformed hand-edited file with
// a warning rather than crashing (a first-class requirement).

import matter from "gray-matter";
import type { Card, CardFrontmatter, CardScope } from "./types.js";

export type ParseResult = { ok: true; card: Card } | { ok: false; reason: string };

const VALID_SCOPES: readonly CardScope[] = ["project", "global"];

function coerceScope(value: unknown): CardScope {
  return typeof value === "string" && (VALID_SCOPES as readonly string[]).includes(value)
    ? (value as CardScope)
    : "project";
}

function coerceAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  // A hand-editor may write `aliases: just-one` (a scalar). Accept it.
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function coerceString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Coerce a frontmatter date field to an ISO 8601 string. YAML parses an
 * *unquoted* ISO timestamp (as ARCHITECTURE.md's own card example and
 * hand-edited files often write it) into a JS `Date`, not a string — accept
 * that and re-stringify, so hand edits don't silently reset created/updated to
 * "now". A `Date` drives the injection budget's most-recently-updated ordering,
 * so losing it would be a real bug.
 */
function coerceDate(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return fallback;
}

function coerceSource(value: unknown): Card["source"] {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return { span: coerceString(v.span), message: coerceString(v.message) };
  }
  return { span: "", message: "" };
}

/**
 * Parse a card file's text into a Card. `slug` is supplied by the caller (it is
 * the file basename, the card's ID — not stored in the frontmatter). Returns
 * `{ ok: false }` for malformed YAML or a missing required `term`; never throws.
 */
export function parseCardFile(text: string, slug: string): ParseResult {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `malformed frontmatter/yaml: ${detail}` };
  }

  // gray-matter returns {} for empty frontmatter, but a scalar/null document
  // body (e.g. `--- \n null \n ---`) can yield a non-object `data`; guard it so
  // property access below can't throw.
  const data: Record<string, unknown> =
    parsed.data && typeof parsed.data === "object"
      ? (parsed.data as Record<string, unknown>)
      : {};
  const term = data.term;
  if (typeof term !== "string" || term.trim().length === 0) {
    return { ok: false, reason: "missing required 'term' field" };
  }

  const now = new Date().toISOString();
  const card: Card = {
    slug,
    term,
    aliases: coerceAliases(data.aliases),
    created: coerceDate(data.created, now),
    updated: coerceDate(data.updated, now),
    scope: coerceScope(data.scope),
    source: coerceSource(data.source),
    // serializeCard writes a blank line after `---` and a trailing newline
    // (gray-matter's canonical form). Strip exactly those to recover the body.
    body: parsed.content.replace(/^\n/, "").replace(/\n$/, "")
  };

  return { ok: true, card };
}

/**
 * Serialize a Card to file text: YAML frontmatter (canonical field order) then
 * the markdown body. Deterministic so the round-trip and any snapshot are stable.
 */
export function serializeCard(card: Card): string {
  const fm: CardFrontmatter = {
    term: card.term,
    aliases: card.aliases,
    created: card.created,
    updated: card.updated,
    scope: card.scope,
    source: card.source
  };

  // gray-matter.stringify writes the frontmatter with js-yaml, then a blank
  // line, then the body, then a trailing newline. parseCardFile strips the
  // blank line and trailing newline to recover the exact body.
  return matter.stringify(card.body, fm as Record<string, unknown>);
}
