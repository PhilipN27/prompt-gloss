import { describe, expect, it } from "vitest";
import { matchMessage, stemFold, normalize, tokenize } from "./matcher.js";
import type { Index, IndexEntry } from "./types.js";

function entry(
  partial: Partial<IndexEntry> & { slug: string; term: string }
): IndexEntry {
  return {
    file: `cards/${partial.slug}.md`,
    aliases: [],
    updated: "2026-07-13T00:00:00.000Z",
    scope: "project",
    bodyTokens: 10,
    ...partial
  };
}

function indexOf(...entries: IndexEntry[]): Index {
  return { version: 1, generatedAt: "2026-07-13T00:00:00.000Z", cards: entries };
}

describe("normalize", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalize("  The   Billing\tEngine ")).toBe("the billing engine");
  });
  it("applies NFKC (full-width forms fold to ASCII)", () => {
    expect(normalize("ｘｙｚ")).toBe("xyz");
  });
});

describe("tokenize", () => {
  it("splits on non-word boundaries, keeping alphanumerics together", () => {
    expect(tokenize("wire xyz into the billing-engine!")).toEqual([
      "wire",
      "xyz",
      "into",
      "the",
      "billing",
      "engine"
    ]);
  });
  it("keeps possessive apostrophes attached for the stemmer", () => {
    expect(tokenize("the engine's speed")).toEqual(["the", "engine's", "speed"]);
  });
});

describe("stemFold", () => {
  it("strips a trailing possessive 's", () => {
    expect(stemFold("engine's")).toBe("engine");
    expect(stemFold("dashboard's")).toBe("dashboard");
  });
  it("strips a trailing plural s on tokens longer than 3 chars", () => {
    expect(stemFold("dashboards")).toBe("dashboard");
    expect(stemFold("engines")).toBe("engine");
  });
  it("does not strip s from words ending in ss/us/is", () => {
    expect(stemFold("class")).toBe("class");
    expect(stemFold("status")).toBe("status");
    expect(stemFold("analysis")).toBe("analysis");
  });
  it("does not strip s from short tokens (<= 3 chars)", () => {
    expect(stemFold("cs")).toBe("cs");
    expect(stemFold("gas")).toBe("gas");
  });
});

describe("matchMessage — exact and case-insensitive", () => {
  const idx = indexOf(entry({ slug: "xyz", term: "xyz" }));

  it("matches an exact single-token term", () => {
    expect(matchMessage("I want a dashboard for xyz", idx)).toEqual(["xyz"]);
  });
  it("matches case-insensitively", () => {
    expect(matchMessage("What is XYZ again?", idx)).toEqual(["xyz"]);
  });
  it("matches a term adjacent to punctuation", () => {
    expect(matchMessage('the "xyz".', idx)).toEqual(["xyz"]);
    expect(matchMessage("xyz, please", idx)).toEqual(["xyz"]);
  });
});

describe("matchMessage — word-boundary anchoring", () => {
  const idx = indexOf(entry({ slug: "xyz", term: "xyz" }));
  it("does NOT match a term embedded in a longer token", () => {
    expect(matchMessage("the xyzabc module", idx)).toEqual([]);
    expect(matchMessage("prefixxyz here", idx)).toEqual([]);
  });
});

describe("matchMessage — stemming", () => {
  const idx = indexOf(entry({ slug: "billing-engine", term: "billing engine" }));
  it("matches a plural of a multi-word term", () => {
    expect(matchMessage("clean up the billing engines", idx)).toEqual(["billing-engine"]);
  });
  it("matches a possessive", () => {
    const d = indexOf(entry({ slug: "dashboard", term: "dashboard" }));
    expect(matchMessage("the dashboard's layout", d)).toEqual(["dashboard"]);
  });
});

describe("matchMessage — multi-word phrases", () => {
  const idx = indexOf(entry({ slug: "billing-engine", term: "billing engine" }));
  it("matches a consecutive token phrase", () => {
    expect(matchMessage("wire the billing engine now", idx)).toEqual(["billing-engine"]);
  });
  it("does NOT match when the phrase tokens are non-consecutive", () => {
    expect(matchMessage("billing then engine", idx)).toEqual([]);
  });
  it("normalizes internal whitespace in the term", () => {
    const spaced = indexOf(entry({ slug: "billing-engine", term: "billing   engine" }));
    expect(matchMessage("the billing engine", spaced)).toEqual(["billing-engine"]);
  });
});

describe("matchMessage — aliases", () => {
  const idx = indexOf(
    entry({ slug: "xyz", term: "xyz", aliases: ["metrics panel", "xyz dashboard"] })
  );
  it("resolves an alias hit to the owning card slug", () => {
    expect(matchMessage("the metrics panel is slow", idx)).toEqual(["xyz"]);
  });
  it("dedupes when both term and alias appear", () => {
    expect(matchMessage("xyz and the metrics panel", idx)).toEqual(["xyz"]);
  });
});

describe("matchMessage — non-word-character terms", () => {
  const idx = indexOf(entry({ slug: "foo-bar", term: "foo.bar" }));
  it("matches a dotted term by guarded literal search", () => {
    expect(matchMessage("call foo.bar() please", idx)).toEqual(["foo-bar"]);
  });
  it("does NOT match the dotted term inside a longer identifier", () => {
    expect(matchMessage("myfoo.barbaz", idx)).toEqual([]);
  });
});

describe("matchMessage — snake_case identifiers (underscore is word-internal)", () => {
  it("does NOT match a word term inside a snake_case identifier", () => {
    const idx = indexOf(entry({ slug: "gateway", term: "gateway" }));
    expect(matchMessage("call api_gateway_v2 now", idx)).toEqual([]);
    expect(matchMessage("the _gateway helper", idx)).toEqual([]);
    expect(matchMessage("use gateway_config here", idx)).toEqual([]);
  });
  it("matches an underscore term as a whole token", () => {
    const idx = indexOf(entry({ slug: "analytics-rollup", term: "analytics_rollup" }));
    expect(matchMessage("run the analytics_rollup job", idx)).toEqual([
      "analytics-rollup"
    ]);
    expect(matchMessage("my_analytics_rollup_v2 shadow", idx)).toEqual([]);
  });
});

describe("matchMessage — multiple cards and negatives", () => {
  const idx = indexOf(
    entry({ slug: "xyz", term: "xyz" }),
    entry({ slug: "billing-engine", term: "billing engine" })
  );
  it("returns all matched cards", () => {
    expect(matchMessage("wire xyz into the billing engine", idx).sort()).toEqual([
      "billing-engine",
      "xyz"
    ]);
  });
  it("returns [] for an empty message", () => {
    expect(matchMessage("", idx)).toEqual([]);
  });
  it("returns [] when nothing matches", () => {
    expect(matchMessage("completely unrelated words here", idx)).toEqual([]);
  });
});
