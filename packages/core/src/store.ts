// CardStore: CRUD over `.gloss/cards/*.md`, with a generated `.gloss/index.json`
// (ARCHITECTURE.md §3-4). Card files are the source of truth; the index is
// derived and disposable. Hand-edited files are first-class: the store re-reads
// on mtime change and skips malformed files with a warning instead of crashing.

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCardFile, serializeCard } from "./frontmatter.js";
import { dedupeSlug, slugify } from "./slug.js";
import type { Card, CardScope, CardSource, Index, IndexEntry } from "./types.js";

/** Fields accepted when creating a card. `created`/`updated`/`slug` are managed. */
export interface NewCardInput {
  term: string;
  aliases?: string[];
  body: string;
  scope?: CardScope;
  source: CardSource;
}

/** Fields accepted when updating a card. All optional; `slug`/`created` are immutable. */
export interface UpdateCardInput {
  term?: string;
  aliases?: string[];
  body?: string;
  scope?: CardScope;
  source?: CardSource;
}

/** Estimate tokens as ceil(chars/4) — the documented heuristic (ARCHITECTURE.md §6). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface CacheEntry {
  card: Card;
  /** mtimeMs + size fingerprint; a change means re-read from disk. */
  fingerprint: string;
}

export class CardStore {
  readonly glossDir: string;
  readonly cardsDir: string;
  readonly indexFile: string;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(projectDir: string) {
    this.glossDir = join(projectDir, ".gloss");
    this.cardsDir = join(this.glossDir, "cards");
    this.indexFile = join(this.glossDir, "index.json");
  }

  private cardPath(slug: string): string {
    return join(this.cardsDir, `${slug}.md`);
  }

  private static fingerprint(mtimeMs: number, size: number): string {
    return `${mtimeMs}:${size}`;
  }

  /** List the slugs present on disk (card file basenames). */
  private async listSlugs(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.cardsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return names.filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3));
  }

  /**
   * Read one card from disk, using the in-memory cache when the file's
   * fingerprint is unchanged. Returns null if the file is missing; returns
   * null AND warns if the file is malformed (never throws for bad content).
   */
  private async readCard(slug: string): Promise<Card | null> {
    const path = this.cardPath(slug);
    let info;
    try {
      info = await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache.delete(slug);
        return null;
      }
      throw err;
    }

    const fingerprint = CardStore.fingerprint(info.mtimeMs, info.size);
    const cached = this.cache.get(slug);
    if (cached && cached.fingerprint === fingerprint) {
      return cached.card;
    }

    const text = await readFile(path, "utf8");
    const result = parseCardFile(text, slug);
    if (!result.ok) {
      console.warn(`[gloss] skipping malformed card ${slug}.md: ${result.reason}`);
      this.cache.delete(slug);
      return null;
    }

    this.cache.set(slug, { card: result.card, fingerprint });
    return result.card;
  }

  /** Read a card by slug, or null if missing/malformed. */
  async get(slug: string): Promise<Card | null> {
    return this.readCard(slug);
  }

  /** All valid cards on disk. Malformed files are skipped (with a warning). */
  async list(): Promise<Card[]> {
    const slugs = await this.listSlugs();
    const cards: Card[] = [];
    for (const slug of slugs) {
      const card = await this.readCard(slug);
      if (card) cards.push(card);
    }
    return cards;
  }

  /** Create a new card, allocating a unique slug, then rebuild the index. */
  async create(input: NewCardInput): Promise<Card> {
    await mkdir(this.cardsDir, { recursive: true });
    const used = new Set(await this.listSlugs());
    const slug = dedupeSlug(slugify(input.term), used);

    const now = new Date().toISOString();
    const card: Card = {
      slug,
      term: input.term,
      aliases: input.aliases ?? [],
      created: now,
      updated: now,
      scope: input.scope ?? "project",
      source: input.source,
      body: input.body
    };

    await this.writeCard(card);
    await this.rebuildIndex();
    return card;
  }

  /**
   * Update an existing card. Bumps `updated`, keeps `created` and `slug`
   * (files don't move on rename — the slug is an ID). Returns null if missing.
   */
  async update(slug: string, patch: UpdateCardInput): Promise<Card | null> {
    const existing = await this.readCard(slug);
    if (!existing) return null;

    const next: Card = {
      ...existing,
      ...(patch.term !== undefined ? { term: patch.term } : {}),
      ...(patch.aliases !== undefined ? { aliases: patch.aliases } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      updated: new Date().toISOString()
    };

    await this.writeCard(next);
    await this.rebuildIndex();
    return next;
  }

  /** Delete a card file and rebuild the index. Returns false if it was absent. */
  async delete(slug: string): Promise<boolean> {
    const path = this.cardPath(slug);
    try {
      await rm(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
    this.cache.delete(slug);
    await this.rebuildIndex();
    return true;
  }

  private async writeCard(card: Card): Promise<void> {
    await mkdir(this.cardsDir, { recursive: true });
    const path = this.cardPath(card.slug);
    await writeFile(path, serializeCard(card), "utf8");
    // Refresh the cache fingerprint for the just-written file.
    const info = await stat(path);
    this.cache.set(card.slug, {
      card,
      fingerprint: CardStore.fingerprint(info.mtimeMs, info.size)
    });
  }

  /** Build the index document from the cards currently on disk. */
  async buildIndex(): Promise<Index> {
    const cards = await this.list();
    const entries: IndexEntry[] = cards.map((card) => ({
      slug: card.slug,
      file: `cards/${card.slug}.md`,
      term: card.term,
      aliases: card.aliases,
      updated: card.updated,
      scope: card.scope,
      bodyTokens: estimateTokens(card.body)
    }));
    return { version: 1, generatedAt: new Date().toISOString(), cards: entries };
  }

  /** Rebuild and persist `.gloss/index.json` from the card files. */
  async rebuildIndex(): Promise<Index> {
    const index = await this.buildIndex();
    await mkdir(this.glossDir, { recursive: true });
    await writeFile(this.indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    return index;
  }

  /**
   * Read the persisted index, rebuilding it if it is missing or stale relative
   * to the card files. The index is disposable — the card files are truth.
   */
  async getIndex(): Promise<Index> {
    try {
      const text = await readFile(this.indexFile, "utf8");
      const parsed = JSON.parse(text) as Index;
      if (parsed.version === 1 && Array.isArray(parsed.cards)) return parsed;
    } catch {
      // Missing or corrupt index — rebuild it below.
    }
    return this.rebuildIndex();
  }
}
