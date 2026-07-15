import type { Card } from "@prompt-gloss/core";
import { describe, expect, it } from "vitest";
import { toCardSummary } from "./messaging.js";

function card(term: string, body: string, aliases: string[] = []): Card {
  return {
    slug: term.toLowerCase().replace(/\s+/g, "-"),
    term,
    aliases,
    created: "2026-07-15T00:00:00.000Z",
    updated: "2026-07-15T00:00:00.000Z",
    scope: "project",
    source: { span: term, message: "", origin: "vscode-terminal" },
    body
  };
}

describe("toCardSummary", () => {
  it("carries slug, term, and aliases through", () => {
    const summary = toCardSummary(card("reconciliation", "body", ["recon"]));
    expect(summary.slug).toBe("reconciliation");
    expect(summary.term).toBe("reconciliation");
    expect(summary.aliases).toEqual(["recon"]);
  });

  it("previews the first non-empty line and collapses whitespace", () => {
    const summary = toCardSummary(
      card("recon", "\n\n  matching   invoices\nagainst payments\n")
    );
    expect(summary.preview).toBe("matching invoices");
  });

  it("truncates a long preview with an ellipsis", () => {
    const long = "word ".repeat(60).trim();
    const summary = toCardSummary(card("recon", long));
    expect(summary.preview.length).toBeLessThanOrEqual(120);
    expect(summary.preview.endsWith("…")).toBe(true);
  });

  it("yields an empty preview for a blank body", () => {
    expect(toCardSummary(card("recon", "   \n\n")).preview).toBe("");
  });
});
