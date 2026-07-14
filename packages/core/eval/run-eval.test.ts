// Matcher golden-set eval (the merge gate — TESTING.md). Loads the committed
// fixture cards, builds the real index via the real store, and runs the real
// matcher over every case in cases.jsonl, asserting exact set equality. One
// failing case fails the suite, which fails CI.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import { CardStore } from "../src/store.js";
import { matchMessage } from "../src/matcher.js";
import type { Index } from "../src/types.js";

interface Case {
  name: string;
  message: string;
  expect: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtureProjectDir = join(here, "fixtures");
const casesFile = join(here, "cases.jsonl");

function loadCases(): Case[] {
  const text = readFileSync(casesFile, "utf8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line, i) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new Error(`cases.jsonl line ${i + 1} is not valid JSON: ${String(err)}`);
      }
      const c = parsed as Case;
      if (
        typeof c.name !== "string" ||
        typeof c.message !== "string" ||
        !Array.isArray(c.expect)
      ) {
        throw new Error(`cases.jsonl line ${i + 1} is missing name/message/expect`);
      }
      return c;
    });
}

const sortedSet = (xs: string[]): string[] => [...new Set(xs)].sort();

describe("matcher golden set", () => {
  let index: Index;
  const cases = loadCases();

  beforeAll(async () => {
    // Build the index from the committed fixture cards via the real store.
    const store = new CardStore(fixtureProjectDir);
    index = await store.buildIndex();
    // Sanity: every expected slug in the golden set must exist as a fixture
    // card, else a passing "expect: []" could be hiding a typo'd slug.
    const known = new Set(index.cards.map((c) => c.slug));
    for (const c of cases) {
      for (const slug of c.expect) {
        if (!known.has(slug)) {
          throw new Error(`case "${c.name}" expects unknown fixture slug "${slug}"`);
        }
      }
    }
  });

  it("has a non-trivial number of cases including negatives", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    const negatives = cases.filter((c) => c.expect.length === 0);
    expect(negatives.length).toBeGreaterThanOrEqual(6);
  });

  it.each(cases)("$name", (c) => {
    const actual = sortedSet(matchMessage(c.message, index));
    const expected = sortedSet(c.expect);
    // Rich diff on failure: vitest prints expected vs. received arrays.
    expect(actual, `message: ${JSON.stringify(c.message)}`).toEqual(expected);
  });
});
