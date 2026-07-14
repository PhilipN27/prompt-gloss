// `prompt-gloss add` (TERMINAL.md §9.3): create a card via core — slug,
// dedup, frontmatter identical to every other surface; origin: cli.

import { CardStore } from "@prompt-gloss/core";

export interface AddOptions {
  projectDir: string;
  term: string;
  aliases?: string[];
  body: string;
  log?: (line: string) => void;
}

export async function runAdd(opts: AddOptions): Promise<void> {
  const store = new CardStore(opts.projectDir);
  const card = await store.create({
    term: opts.term,
    aliases: opts.aliases ?? [],
    body: opts.body,
    source: {
      span: opts.term,
      message: "(created via prompt-gloss add)",
      origin: "cli"
    }
  });
  opts.log?.(`Card saved: .gloss/cards/${card.slug}.md`);
}
