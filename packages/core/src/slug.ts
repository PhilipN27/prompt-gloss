// Slug generation for card files. A slug is the card's stable ID and file
// basename (ARCHITECTURE.md §4): kebab-cased term, Unicode-folded, lowercased,
// non-alphanumerics collapsed to `-`; collisions append `-2`, `-3`, ...

const FALLBACK_SLUG = "card";

// Combining diacritical marks left behind by NFKD decomposition (U+0300–U+036F).
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Derive a kebab-case slug from a term. Unicode-folds accents to ASCII,
 * lowercases, and collapses any run of non-alphanumeric characters to a single
 * dash, trimming leading/trailing dashes. Never returns an empty string.
 */
export function slugify(term: string): string {
  const folded = term.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase();

  const slug = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  return slug.length > 0 ? slug : FALLBACK_SLUG;
}

/**
 * Return `base` if unused, else the first free `base-N` (N starting at 2).
 * `used` is the set of slugs already taken.
 */
export function dedupeSlug(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
