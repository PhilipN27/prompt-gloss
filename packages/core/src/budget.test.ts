import { describe, expect, it } from "vitest";
import { InjectionLog, packInjection, DEFAULT_BUDGET } from "./budget.js";
import type { Card } from "./types.js";

let seq = 0;
function card(partial: Partial<Card> & { slug: string }): Card {
  seq += 1;
  return {
    term: partial.slug,
    aliases: [],
    created: "2026-07-13T00:00:00.000Z",
    updated: partial.updated ?? `2026-07-13T00:00:${String(seq).padStart(2, "0")}.000Z`,
    scope: "project",
    source: { span: partial.slug, message: "" },
    body: "body",
    ...partial
  };
}

/** A body of exactly `tokens * 4` chars, so estimateTokens(body) === tokens. */
function bodyOfTokens(tokens: number): string {
  return "x".repeat(tokens * 4);
}

describe("InjectionLog — toJSON / fromJSON (file-backed twin, TERMINAL.md §4.2)", () => {
  it("round-trips: fromJSON(toJSON(log)) preserves dedup behavior", () => {
    const log = new InjectionLog();
    const a = { slug: "a", updated: "2026-07-13T01:00:00.000Z" };
    const b = { slug: "b", updated: "2026-07-13T02:00:00.000Z" };
    log.record(a);
    log.record(b);

    const twin = InjectionLog.fromJSON(log.toJSON());
    expect(twin.shouldInject(a)).toBe(false);
    expect(twin.shouldInject(b)).toBe(false);
    // Updated bump still re-injects after the round trip.
    expect(twin.shouldInject({ slug: "a", updated: "2026-07-13T03:00:00.000Z" })).toBe(true);
    // Unseen card injects.
    expect(twin.shouldInject({ slug: "c", updated: a.updated })).toBe(true);
  });

  it("toJSON returns a plain slug → updated-ISO map", () => {
    const log = new InjectionLog();
    log.record({ slug: "a", updated: "2026-07-13T01:00:00.000Z" });
    expect(log.toJSON()).toEqual({ a: "2026-07-13T01:00:00.000Z" });
  });

  it("toJSON survives JSON.stringify/parse round trip", () => {
    const log = new InjectionLog();
    log.record({ slug: "a", updated: "2026-07-13T01:00:00.000Z" });
    const twin = InjectionLog.fromJSON(JSON.parse(JSON.stringify(log.toJSON())));
    expect(twin.shouldInject({ slug: "a", updated: "2026-07-13T01:00:00.000Z" })).toBe(false);
  });

  it("fromJSON tolerates corrupted input: non-objects yield an empty log", () => {
    for (const bad of [null, undefined, 42, "nope", [], true]) {
      const log = InjectionLog.fromJSON(bad);
      expect(log.shouldInject({ slug: "a", updated: "2026-07-13T01:00:00.000Z" })).toBe(true);
      expect(log.toJSON()).toEqual({});
    }
  });

  it("an unparseable stored timestamp fails open (card injects again)", () => {
    const log = InjectionLog.fromJSON({ a: "not-a-date" });
    expect(log.shouldInject({ slug: "a", updated: "2026-07-13T01:00:00.000Z" })).toBe(true);
  });

  it("fromJSON skips non-string entry values, keeping the valid ones", () => {
    const log = InjectionLog.fromJSON({
      good: "2026-07-13T01:00:00.000Z",
      bad: 42,
      worse: { nested: true },
      alsoBad: null
    });
    expect(log.toJSON()).toEqual({ good: "2026-07-13T01:00:00.000Z" });
  });
});

describe("packInjection — ordering", () => {
  it("packs most-recently-updated first", () => {
    const cards = [
      card({ slug: "old", updated: "2026-07-13T00:00:00.000Z" }),
      card({ slug: "new", updated: "2026-07-13T09:00:00.000Z" }),
      card({ slug: "mid", updated: "2026-07-13T05:00:00.000Z" })
    ];
    const result = packInjection(cards, new InjectionLog());
    expect(result.injectedSlugs).toEqual(["new", "mid", "old"]);
  });
});

describe("packInjection — budget skip-and-continue", () => {
  it("skips a card that would overflow but keeps packing smaller/older ones", () => {
    const cards = [
      card({ slug: "big", updated: "2026-07-13T09:00:00.000Z", body: bodyOfTokens(700) }),
      card({
        slug: "huge",
        updated: "2026-07-13T08:00:00.000Z",
        body: bodyOfTokens(700)
      }),
      card({ slug: "small", updated: "2026-07-13T07:00:00.000Z", body: bodyOfTokens(50) })
    ];
    // budget 2000: big(~700+hdr) + huge(~700+hdr) fit ~1400; a second 700 would
    // exceed if header pushes over — but a 50-token card still fits after a skip.
    const result = packInjection(cards, new InjectionLog(), {
      budget: 1500,
      cardCap: 800
    });
    // big fits (700), huge would push to ~1400 fits, but let's assert small is
    // reachable even if a larger one is skipped: small must be present.
    expect(result.injectedSlugs).toContain("small");
  });

  it("skips the overflowing card rather than stopping at it", () => {
    const cards = [
      card({ slug: "a", updated: "2026-07-13T09:00:00.000Z", body: bodyOfTokens(400) }),
      card({
        slug: "toobig",
        updated: "2026-07-13T08:00:00.000Z",
        body: bodyOfTokens(400)
      }),
      card({ slug: "c", updated: "2026-07-13T07:00:00.000Z", body: bodyOfTokens(10) })
    ];
    // budget 500: a(400) fits; toobig(400) would exceed 500 -> skip; c(10) fits.
    const result = packInjection(cards, new InjectionLog(), {
      budget: 500,
      cardCap: 800
    });
    expect(result.injectedSlugs).toEqual(["a", "c"]);
  });
});

describe("packInjection — per-card truncation", () => {
  it("truncates a single oversized card at the cap with a marker", () => {
    const cards = [card({ slug: "big", body: bodyOfTokens(2000) })];
    const result = packInjection(cards, new InjectionLog(), {
      budget: 5000,
      cardCap: 800
    });
    expect(result.injectedSlugs).toEqual(["big"]);
    expect(result.payload).toContain("[truncated by Gloss]");
    // The truncated card's contribution is capped near cardCap, not the full 2000.
    expect(result.usedTokens).toBeLessThanOrEqual(900);
  });

  it("does not add a truncation marker to a card under the cap", () => {
    const cards = [card({ slug: "small", body: bodyOfTokens(10) })];
    const result = packInjection(cards, new InjectionLog(), {
      budget: 5000,
      cardCap: 800
    });
    expect(result.payload).not.toContain("[truncated by Gloss]");
  });
});

describe("packInjection — session dedup", () => {
  it("injects a card once per session", () => {
    const log = new InjectionLog();
    const c = card({ slug: "xyz", updated: "2026-07-13T00:00:00.000Z" });
    const first = packInjection([c], log);
    const second = packInjection([c], log);
    expect(first.injectedSlugs).toEqual(["xyz"]);
    expect(second.injectedSlugs).toEqual([]);
  });

  it("re-injects a card whose updated is newer than the last injection", () => {
    const log = new InjectionLog();
    const c1 = card({ slug: "xyz", updated: "2026-07-13T00:00:00.000Z" });
    packInjection([c1], log);
    const c2 = card({ slug: "xyz", updated: "2026-07-13T10:00:00.000Z" });
    const again = packInjection([c2], log);
    expect(again.injectedSlugs).toEqual(["xyz"]);
  });

  it("does not re-inject when updated is unchanged", () => {
    const log = new InjectionLog();
    const c = card({ slug: "xyz", updated: "2026-07-13T00:00:00.000Z" });
    packInjection([c], log);
    const again = packInjection([{ ...c }], log);
    expect(again.injectedSlugs).toEqual([]);
  });

  it("returns an empty result (no payload) when everything is deduped", () => {
    const log = new InjectionLog();
    const c = card({ slug: "xyz" });
    packInjection([c], log);
    const again = packInjection([c], log);
    expect(again.payload).toBe("");
    expect(again.injectedSlugs).toEqual([]);
  });
});

describe("packInjection — empty input", () => {
  it("returns empty payload and no slugs for no matched cards", () => {
    const result = packInjection([], new InjectionLog());
    expect(result.payload).toBe("");
    expect(result.injectedSlugs).toEqual([]);
    expect(result.usedTokens).toBe(0);
  });
});

describe("packInjection — <gloss-context> wrapper snapshot", () => {
  it("emits the exact documented wrapper", () => {
    const cards = [
      card({
        slug: "xyz",
        term: "xyz",
        aliases: ["metrics panel", "xyz dashboard"],
        updated: "2026-07-13T09:00:00.000Z",
        body: "xyz is the metrics panel."
      }),
      card({
        slug: "billing-engine",
        term: "billing engine",
        aliases: [],
        updated: "2026-07-13T08:00:00.000Z",
        body: "the billing engine handles invoices."
      })
    ];
    const result = packInjection(cards, new InjectionLog());
    expect(result.payload).toMatchInlineSnapshot(`
      "<gloss-context>
      The user has attached the following context cards to terms in their message.
      Treat them as authoritative background provided by the user.
      <card term="xyz" aliases="metrics panel, xyz dashboard" file=".gloss/cards/xyz.md">
      xyz is the metrics panel.
      </card>
      <card term="billing engine" file=".gloss/cards/billing-engine.md">
      the billing engine handles invoices.
      </card>
      </gloss-context>"
    `);
  });
});

describe("constants", () => {
  it("exposes the documented default budget and cap", () => {
    expect(DEFAULT_BUDGET.budget).toBe(2000);
    expect(DEFAULT_BUDGET.cardCap).toBe(800);
  });
});
