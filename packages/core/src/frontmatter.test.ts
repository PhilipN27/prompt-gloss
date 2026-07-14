import { describe, expect, it } from "vitest";
import { parseCardFile, serializeCard } from "./frontmatter.js";
import type { Card } from "./types.js";

const baseCard: Card = {
  slug: "xyz",
  term: "xyz",
  aliases: ["metrics panel", "xyz dashboard"],
  created: "2026-07-13T20:15:00.000Z",
  updated: "2026-07-13T20:15:00.000Z",
  scope: "project",
  source: {
    span: "xyz",
    message: "I want a dashboard that helps me build xyz"
  },
  body: "xyz is our internal name for the customer-facing metrics panel."
};

describe("serializeCard / parseCardFile round-trip", () => {
  it("parse(serialize(card)) deep-equals the card (minus slug, which is the filename)", () => {
    const text = serializeCard(baseCard);
    const parsed = parseCardFile(text, "xyz");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card).toEqual(baseCard);
  });

  it("emits YAML frontmatter delimited by --- and a markdown body", () => {
    const text = serializeCard(baseCard);
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("term: xyz");
    expect(text).toContain("- metrics panel");
    expect(text).toContain(baseCard.body);
  });

  it("round-trips an empty aliases list", () => {
    const card: Card = { ...baseCard, aliases: [] };
    const parsed = parseCardFile(serializeCard(card), card.slug);
    expect(parsed.ok && parsed.card.aliases).toEqual([]);
  });

  it("round-trips terms and excerpts with YAML-hostile characters", () => {
    const card: Card = {
      ...baseCard,
      slug: "colon-term",
      term: "billing: engine",
      aliases: ['the "main" pipeline', "a, b, c"],
      source: {
        span: "billing: engine",
        message: 'He said: "wire it in", then #hashtag - done.'
      },
      body: "Body with: colons, #hashes, and - dashes.\nSecond line."
    };
    const parsed = parseCardFile(serializeCard(card), card.slug);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card).toEqual(card);
  });

  it("round-trips source.origin when present (TERMINAL.md §5)", () => {
    const card: Card = {
      ...baseCard,
      source: { span: "xyz", message: "excerpt", origin: "vscode-terminal" }
    };
    const parsed = parseCardFile(serializeCard(card), card.slug);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card).toEqual(card);
    expect(parsed.card.source.origin).toBe("vscode-terminal");
  });

  it("omits origin entirely when absent (v1 card files stay byte-identical)", () => {
    const text = serializeCard(baseCard);
    expect(text).not.toContain("origin");
    const parsed = parseCardFile(text, baseCard.slug);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect("origin" in parsed.card.source).toBe(false);
  });

  it("drops an unknown origin value instead of failing the parse", () => {
    const text = [
      "---",
      "term: xyz",
      "source:",
      "  span: xyz",
      "  message: m",
      "  origin: teleport",
      "---",
      "",
      "body"
    ].join("\n");
    const parsed = parseCardFile(text, "xyz");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card.source.origin).toBeUndefined();
  });

  it("preserves a multi-paragraph markdown body verbatim", () => {
    const body = "# Heading\n\nPara one.\n\n- bullet\n- bullet\n\nPara two.";
    const card: Card = { ...baseCard, body };
    const parsed = parseCardFile(serializeCard(card), card.slug);
    expect(parsed.ok && parsed.card.body).toBe(body);
  });
});

describe("parseCardFile tolerance (hand-edited files)", () => {
  it("defaults scope to 'project' when the field is absent", () => {
    const text = [
      "---",
      "term: foo",
      "created: 2026-07-13T00:00:00.000Z",
      "updated: 2026-07-13T00:00:00.000Z",
      "---",
      "",
      "body"
    ].join("\n");
    const parsed = parseCardFile(text, "foo");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card.scope).toBe("project");
  });

  it("defaults aliases to [] when absent", () => {
    const text = [
      "---",
      "term: foo",
      "created: 2026-07-13T00:00:00.000Z",
      "updated: 2026-07-13T00:00:00.000Z",
      "---",
      "",
      "body"
    ].join("\n");
    const parsed = parseCardFile(text, "foo");
    expect(parsed.ok && parsed.card.aliases).toEqual([]);
  });

  it("tolerates a hand-written file with extra unknown frontmatter keys", () => {
    const text = [
      "---",
      "term: foo",
      "note: something a human typed",
      "created: 2026-07-13T00:00:00.000Z",
      "updated: 2026-07-13T00:00:00.000Z",
      "---",
      "",
      "hello"
    ].join("\n");
    const parsed = parseCardFile(text, "foo");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card.term).toBe("foo");
    expect(parsed.card.body).toBe("hello");
  });

  it("fails (does not throw) on malformed YAML frontmatter", () => {
    const text = ["---", "term: foo", "aliases: [unclosed", "---", "body"].join("\n");
    const parsed = parseCardFile(text, "foo");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/frontmatter|yaml|parse/i);
  });

  it("fails (does not throw) when the required 'term' field is missing", () => {
    const text = ["---", "created: 2026-07-13T00:00:00.000Z", "---", "body"].join("\n");
    const parsed = parseCardFile(text, "foo");
    expect(parsed.ok).toBe(false);
  });

  it("coerces a single-string aliases value into a one-element array", () => {
    const text = [
      "---",
      "term: foo",
      "aliases: just-one",
      "created: 2026-07-13T00:00:00.000Z",
      "updated: 2026-07-13T00:00:00.000Z",
      "---",
      "",
      "body"
    ].join("\n");
    const parsed = parseCardFile(text, "foo");
    expect(parsed.ok && parsed.card.aliases).toEqual(["just-one"]);
  });

  it("preserves UNQUOTED ISO timestamps (YAML parses them as Date, not string)", () => {
    // ARCHITECTURE.md's own example and typical hand-edits write timestamps
    // unquoted; YAML yields a Date. The parser must keep the real value, not
    // silently reset created/updated to now (which would break budget ordering).
    const text = [
      "---",
      "term: foo",
      "created: 2026-01-02T03:04:05Z",
      "updated: 2026-06-07T08:09:10Z",
      "---",
      "",
      "body"
    ].join("\n");
    const parsed = parseCardFile(text, "foo");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(new Date(parsed.card.created).toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(new Date(parsed.card.updated).toISOString()).toBe("2026-06-07T08:09:10.000Z");
  });

  it("does not throw when the frontmatter document is a bare scalar/null", () => {
    const text = ["---", "just a bare string", "---", "body"].join("\n");
    const parsed = parseCardFile(text, "foo");
    // No `term` -> not ok, but crucially it must not throw.
    expect(parsed.ok).toBe(false);
  });
});
