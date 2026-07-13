import { describe, expect, it } from "vitest";
import { slugify, dedupeSlug } from "./slug.js";

describe("slugify", () => {
  it("kebab-cases a simple term", () => {
    expect(slugify("billing engine")).toBe("billing-engine");
  });

  it("lowercases", () => {
    expect(slugify("XYZ Dashboard")).toBe("xyz-dashboard");
  });

  it("collapses runs of non-alphanumerics into a single dash", () => {
    expect(slugify("foo   ---  bar")).toBe("foo-bar");
    expect(slugify("foo.bar/baz")).toBe("foo-bar-baz");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("  -hello- ")).toBe("hello");
    expect(slugify("!!!wat!!!")).toBe("wat");
  });

  it("Unicode-folds accented characters to ASCII", () => {
    expect(slugify("Café Métrics")).toBe("cafe-metrics");
    expect(slugify("naïve façade")).toBe("naive-facade");
  });

  it("keeps digits", () => {
    expect(slugify("p95 latency")).toBe("p95-latency");
  });

  it("produces a stable non-empty fallback for all-punctuation terms", () => {
    // Should never return an empty string (that would be an invalid filename).
    expect(slugify("!!!").length).toBeGreaterThan(0);
    expect(slugify("").length).toBeGreaterThan(0);
  });
});

describe("dedupeSlug", () => {
  it("returns the base slug when unused", () => {
    expect(dedupeSlug("xyz", new Set())).toBe("xyz");
  });

  it("appends -2 on first collision", () => {
    expect(dedupeSlug("xyz", new Set(["xyz"]))).toBe("xyz-2");
  });

  it("increments to the first free suffix", () => {
    expect(dedupeSlug("xyz", new Set(["xyz", "xyz-2", "xyz-3"]))).toBe("xyz-4");
  });
});
