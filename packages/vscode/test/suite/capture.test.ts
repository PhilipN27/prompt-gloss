import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { CardStore } from "@prompt-gloss/core";
import * as vscode from "vscode";
import { captureSelection } from "../../src/capture.js";
import { CardService } from "../../src/cardService.js";
import { ProvenanceTracker } from "../../src/provenance.js";
import { workspaceRoot } from "./helpers.js";

function createProvenance(): {
  tracker: ProvenanceTracker;
  subscriptions: vscode.Disposable[];
} {
  const subscriptions: vscode.Disposable[] = [];
  const context = { subscriptions } as vscode.ExtensionContext;
  return { tracker: new ProvenanceTracker(context), subscriptions };
}

suite("Capture and card persistence", () => {
  setup(async () => {
    await rm(join(workspaceRoot(), ".gloss"), { recursive: true, force: true });
  });

  test("restores the seeded clipboard and saves the captured span via core", async () => {
    const cardService = new CardService();
    const originalClipboard = await vscode.env.clipboard.readText();
    const span = "federated brewing";
    const provenance = createProvenance();

    try {
      await vscode.env.clipboard.writeText(span);

      // Boundary rule: the harness intentionally does not create or select text
      // in a terminal. copySelection leaves this seed untouched, making it the
      // captured span while still exercising VS Code's real clipboard API.
      const draft = await captureSelection(provenance.tracker, cardService);

      assert.ok(draft);
      assert.equal(draft.slug, null);
      assert.equal(draft.term, span);
      assert.equal(draft.source.span, span);
      assert.equal(await vscode.env.clipboard.readText(), span);

      const saved = await cardService.save(
        {
          slug: draft.slug,
          term: draft.term,
          aliases: ["brew federation"],
          body: "Captured context body"
        },
        draft.source
      );

      assert.equal(saved.source.origin, "vscode-terminal");
      const cardPath = join(workspaceRoot(), ".gloss", "cards", `${saved.slug}.md`);
      const cardFile = await readFile(cardPath, "utf8");
      assert.match(cardFile, /^term: federated brewing$/m);
      assert.match(cardFile, /^\s+origin: vscode-terminal$/m);
      assert.ok(cardFile.includes("\nCaptured context body\n"));

      const persisted = await new CardStore(workspaceRoot()).get(saved.slug);
      assert.ok(persisted);
      assert.equal(persisted.term, span);
      assert.equal(persisted.body, "Captured context body");
      assert.equal(persisted.source.origin, "vscode-terminal");
    } finally {
      for (const subscription of provenance.subscriptions.reverse())
        subscription.dispose();
      await vscode.env.clipboard.writeText(originalClipboard);
    }
  });

  test("opens an existing term in edit mode and updates without duplication", async () => {
    const root = workspaceRoot();
    const store = new CardStore(root);
    const existing = await store.create({
      term: "shared glossary",
      aliases: ["old alias"],
      body: "Old body",
      source: { span: "shared glossary", message: "seed", origin: "cli" }
    });
    const originalClipboard = await vscode.env.clipboard.readText();
    const provenance = createProvenance();

    try {
      await vscode.env.clipboard.writeText(existing.term);
      const cardService = new CardService();
      const draft = await captureSelection(provenance.tracker, cardService);

      assert.ok(draft);
      assert.equal(draft.slug, existing.slug);
      assert.equal(draft.body, "Old body");

      const updated = await cardService.save(
        {
          slug: draft.slug,
          term: draft.term,
          aliases: ["new alias"],
          body: "Updated body"
        },
        draft.source
      );

      assert.equal(updated.slug, existing.slug);
      assert.equal(updated.body, "Updated body");
      assert.equal(updated.source.origin, "vscode-terminal");
      assert.equal((await store.list()).length, 1);
      assert.deepEqual(await readdir(join(root, ".gloss", "cards")), [
        `${existing.slug}.md`
      ]);
    } finally {
      for (const subscription of provenance.subscriptions.reverse())
        subscription.dispose();
      await vscode.env.clipboard.writeText(originalClipboard);
    }
  });
});
