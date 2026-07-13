// @prompt-gloss/core — card store, matcher, injection budget.
export type {
  Card,
  CardFrontmatter,
  CardScope,
  CardSource,
  Index,
  IndexEntry
} from "./types.js";
export { slugify, dedupeSlug } from "./slug.js";
export { parseCardFile, serializeCard, type ParseResult } from "./frontmatter.js";
export {
  CardStore,
  estimateTokens,
  type NewCardInput,
  type UpdateCardInput
} from "./store.js";
