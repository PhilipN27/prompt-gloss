// Core domain types for Gloss. These are the pinned contracts referenced by
// ARCHITECTURE.md §4 (file formats) and §5-6 (matcher, budget). Changing them
// is an architecture-sensitive change.

/**
 * Card scope. v1 stores and injects `project` scope only; `global` is
 * schema-reserved for v2 (ROADMAP.md) so hand-authored/imported files carrying
 * it parse without error.
 */
export type CardScope = "project" | "global";

/**
 * Provenance of a card: the highlighted span and a short excerpt of the message
 * it was selected in. Not used for matching (ARCHITECTURE.md §4).
 */
export interface CardSource {
  span: string;
  /** <= 200-char excerpt of the message the span was selected in. */
  message: string;
  /**
   * Which surface created the card (TERMINAL.md §5). Optional and
   * backward-compatible: absent = v1 web card. Never read by the matcher.
   */
  origin?: CardOrigin;
}

/** Card-creating surfaces (TERMINAL.md §5). */
export type CardOrigin = "web" | "vscode-terminal" | "companion" | "cli";

/**
 * A context card as it lives on disk plus its slug (the stable ID derived from
 * the file name). `body` is the free-markdown context that gets injected.
 */
export interface Card {
  /** Stable ID = the card's file basename without extension. Never changes on rename. */
  slug: string;
  term: string;
  aliases: string[];
  /** ISO 8601 UTC. */
  created: string;
  /** ISO 8601 UTC. */
  updated: string;
  scope: CardScope;
  source: CardSource;
  /** Free markdown — this is what gets injected. */
  body: string;
}

/** The frontmatter fields of a card file (everything in `Card` except slug + body). */
export type CardFrontmatter = Omit<Card, "slug" | "body">;

/** One entry in the generated `.gloss/index.json`. */
export interface IndexEntry {
  slug: string;
  /** Path relative to the `.gloss/` root, e.g. `cards/xyz.md`. */
  file: string;
  term: string;
  aliases: string[];
  updated: string;
  scope: CardScope;
  /** Estimated tokens of the card body (ceil(chars/4)); drives the budget. */
  bodyTokens: number;
}

/** The generated `.gloss/index.json` document. */
export interface Index {
  version: 1;
  generatedAt: string;
  cards: IndexEntry[];
}
