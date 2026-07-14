import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "./store.js";
import { parseCardFile } from "./frontmatter.js";
import type { NewCardInput } from "./store.js";

let projectDir: string;
let store: CardStore;

const sampleInput: NewCardInput = {
  term: "xyz",
  aliases: ["metrics panel", "xyz dashboard"],
  body: "xyz is our internal name for the customer-facing metrics panel.",
  scope: "project",
  source: { span: "xyz", message: "I want a dashboard for xyz" }
};

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "gloss-store-"));
  store = new CardStore(projectDir);
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const glossDir = () => join(projectDir, ".gloss");
const cardsDir = () => join(glossDir(), "cards");

describe("CardStore.create", () => {
  it("writes .gloss/cards/<slug>.md and returns the card with a slug", async () => {
    const card = await store.create(sampleInput);
    expect(card.slug).toBe("xyz");
    expect(existsSync(join(cardsDir(), "xyz.md"))).toBe(true);
  });

  it("round-trips: the file on disk parses back to the returned card", async () => {
    const card = await store.create(sampleInput);
    const text = await readFile(join(cardsDir(), "xyz.md"), "utf8");
    const parsed = parseCardFile(text, "xyz");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.card).toEqual(card);
  });

  it("sets created == updated on a new card (ISO 8601 UTC)", async () => {
    const card = await store.create(sampleInput);
    expect(card.created).toBe(card.updated);
    expect(card.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it("defaults scope to project when omitted", async () => {
    const { scope: _omit, ...noScope } = sampleInput;
    const card = await store.create(noScope);
    expect(card.scope).toBe("project");
  });

  it("appends -2 on a slug collision instead of overwriting", async () => {
    const first = await store.create({ ...sampleInput, term: "billing engine" });
    const second = await store.create({ ...sampleInput, term: "Billing Engine" });
    expect(first.slug).toBe("billing-engine");
    expect(second.slug).toBe("billing-engine-2");
    expect(existsSync(join(cardsDir(), "billing-engine.md"))).toBe(true);
    expect(existsSync(join(cardsDir(), "billing-engine-2.md"))).toBe(true);
  });
});

describe("CardStore.get / list", () => {
  it("get returns a created card by slug", async () => {
    await store.create(sampleInput);
    const got = await store.get("xyz");
    expect(got?.term).toBe("xyz");
  });

  it("get returns null for an unknown slug", async () => {
    expect(await store.get("nope")).toBeNull();
  });

  it("list returns all cards", async () => {
    await store.create({ ...sampleInput, term: "one" });
    await store.create({ ...sampleInput, term: "two" });
    const all = await store.list();
    expect(all.map((c) => c.slug).sort()).toEqual(["one", "two"]);
  });

  it("list is empty for a project with no .gloss dir", async () => {
    expect(await store.list()).toEqual([]);
  });
});

describe("CardStore.update", () => {
  it("bumps updated, keeps created, replaces body", async () => {
    const created = await store.create(sampleInput);
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.update("xyz", { body: "new body" });
    expect(updated?.created).toBe(created.created);
    expect(updated?.body).toBe("new body");
    expect(new Date(updated!.updated).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updated).getTime()
    );
  });

  it("keeps the slug stable when the term is renamed (files don't move)", async () => {
    await store.create(sampleInput);
    const updated = await store.update("xyz", { term: "renamed thing" });
    expect(updated?.slug).toBe("xyz");
    expect(updated?.term).toBe("renamed thing");
    expect(existsSync(join(cardsDir(), "xyz.md"))).toBe(true);
    expect(existsSync(join(cardsDir(), "renamed-thing.md"))).toBe(false);
  });

  it("returns null when updating a nonexistent card", async () => {
    expect(await store.update("nope", { body: "x" })).toBeNull();
  });
});

describe("CardStore.delete", () => {
  it("removes the file and the index entry", async () => {
    await store.create(sampleInput);
    const ok = await store.delete("xyz");
    expect(ok).toBe(true);
    expect(existsSync(join(cardsDir(), "xyz.md"))).toBe(false);
    const index = await store.getIndex();
    expect(index.cards.find((c) => c.slug === "xyz")).toBeUndefined();
  });

  it("returns false when deleting a nonexistent card", async () => {
    expect(await store.delete("nope")).toBe(false);
  });
});

describe("CardStore index", () => {
  it("writes .gloss/index.json after a create", async () => {
    await store.create(sampleInput);
    expect(existsSync(join(glossDir(), "index.json"))).toBe(true);
    const index = await store.getIndex();
    expect(index.version).toBe(1);
    const entry = index.cards.find((c) => c.slug === "xyz");
    expect(entry?.file).toBe("cards/xyz.md");
    expect(entry?.aliases).toEqual(sampleInput.aliases);
    expect(entry?.bodyTokens).toBeGreaterThan(0);
  });

  it("bodyTokens estimates ceil(chars/4) of the body", async () => {
    const body = "x".repeat(40); // 40 chars -> 10 tokens
    await store.create({ ...sampleInput, body });
    const index = await store.getIndex();
    expect(index.cards.find((c) => c.slug === "xyz")?.bodyTokens).toBe(10);
  });
});

describe("CardStore hand-edit tolerance (the supported workflow)", () => {
  it("picks up a card file written by hand on disk", async () => {
    await mkdir(cardsDir(), { recursive: true });
    const text = [
      "---",
      "term: handmade",
      "created: 2026-07-13T00:00:00.000Z",
      "updated: 2026-07-13T00:00:00.000Z",
      "---",
      "",
      "written by a human"
    ].join("\n");
    await writeFile(join(cardsDir(), "handmade.md"), text, "utf8");
    const got = await store.get("handmade");
    expect(got?.term).toBe("handmade");
    expect(got?.body).toBe("written by a human");
  });

  it("re-reads a card when its file mtime changes on disk", async () => {
    await store.create(sampleInput);
    expect((await store.get("xyz"))?.body).toContain("internal name");

    const file = join(cardsDir(), "xyz.md");
    const edited = [
      "---",
      "term: xyz",
      "created: 2026-07-13T00:00:00.000Z",
      "updated: 2026-07-14T00:00:00.000Z",
      "---",
      "",
      "edited on disk"
    ].join("\n");
    await writeFile(file, edited, "utf8");
    const future = new Date(Date.now() + 10_000);
    await utimes(file, future, future);

    expect((await store.get("xyz"))?.body).toBe("edited on disk");
  });

  it("skips a malformed card file with a warning, never crashing, and still lists the good ones", async () => {
    await store.create(sampleInput);
    await mkdir(cardsDir(), { recursive: true });
    await writeFile(
      join(cardsDir(), "broken.md"),
      "---\nterm: [unclosed\n---\nbody",
      "utf8"
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const all = await store.list();
    expect(all.map((c) => c.slug)).toContain("xyz");
    expect(all.map((c) => c.slug)).not.toContain("broken");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
