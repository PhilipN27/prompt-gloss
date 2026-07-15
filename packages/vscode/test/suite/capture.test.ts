import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CardStore } from "@prompt-gloss/core";
import { draftFromCard } from "@prompt-gloss/panel-ui";
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

function workspaceFolderUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "Expected the test host to open its temporary workspace folder.");
  return folder.uri;
}

async function showTerminal(terminal: vscode.Terminal): Promise<void> {
  terminal.show();
  if (vscode.window.activeTerminal === terminal) return;

  await new Promise<void>((resolve, reject) => {
    const subscription = vscode.window.onDidChangeActiveTerminal((activeTerminal) => {
      if (activeTerminal !== terminal) return;
      clearTimeout(timeout);
      subscription.dispose();
      resolve();
    });
    const timeout = setTimeout(() => {
      subscription.dispose();
      reject(new Error("Timed out waiting for the test terminal to become active."));
    }, 5000);

    if (vscode.window.activeTerminal === terminal) {
      clearTimeout(timeout);
      subscription.dispose();
      resolve();
    }
  });
}

suite("Capture and card persistence", () => {
  setup(async () => {
    await rm(join(workspaceRoot(), ".gloss"), { recursive: true, force: true });
  });

  test("uses the clipboard as the span when the terminal has no native selection", async () => {
    // Claude Code's mouse-mode TUI never yields a native terminal selection; it
    // auto-copies the user's drag-selection to the clipboard. With no native
    // selection, that clipboard content is the span — and the clipboard is left
    // untouched afterward.
    const cardService = new CardService();
    const originalClipboard = await vscode.env.clipboard.readText();
    const selection = "reconciliation";
    const provenance = createProvenance();
    const terminal = vscode.window.createTerminal("Gloss clipboard-selection test");

    try {
      await showTerminal(terminal);
      await vscode.env.clipboard.writeText(selection);

      const captureContext = await captureSelection(
        provenance.tracker,
        cardService,
        1
      );

      assert.ok(captureContext, "expected a capture context from the clipboard selection");
      assert.equal(captureContext.source.span, selection);
      assert.equal(captureContext.source.origin, "vscode-terminal");
      assert.equal(captureContext.draft.term, selection);
      assert.equal(await vscode.env.clipboard.readText(), selection);
      // Capture only builds the draft; nothing is persisted until the panel saves.
      assert.deepEqual(await new CardStore(workspaceRoot()).list(), []);
    } finally {
      terminal.dispose();
      for (const subscription of provenance.subscriptions.reverse()) {
        subscription.dispose();
      }
      await vscode.env.clipboard.writeText(originalClipboard);
    }
  });

  test("returns null when there is neither a native selection nor clipboard text", async () => {
    const cardService = new CardService();
    const originalClipboard = await vscode.env.clipboard.readText();
    const provenance = createProvenance();
    const terminal = vscode.window.createTerminal("Gloss empty-capture test");

    try {
      await showTerminal(terminal);
      await vscode.env.clipboard.writeText("");

      const captureContext = await captureSelection(
        provenance.tracker,
        cardService,
        1
      );

      assert.equal(captureContext, null);
      assert.equal(await vscode.env.clipboard.readText(), "");
      assert.deepEqual(await new CardStore(workspaceRoot()).list(), []);
    } finally {
      terminal.dispose();
      for (const subscription of provenance.subscriptions.reverse()) {
        subscription.dispose();
      }
      await vscode.env.clipboard.writeText(originalClipboard);
    }
  });

  test("saves a captured terminal source to the pinned workspace folder", async () => {
    const root = workspaceRoot();
    const folderUri = workspaceFolderUri();
    const cardService = new CardService();
    const span = "federated brewing";
    const source = {
      span,
      message: "terminal output containing federated brewing",
      origin: "vscode-terminal"
    } as const;

    const saved = await cardService.save(
      {
        slug: null,
        term: span,
        aliases: ["brew federation"],
        body: "Captured context body"
      },
      folderUri,
      source
    );

    assert.equal(saved.source.origin, "vscode-terminal");
    const cardPath = join(root, ".gloss", "cards", `${saved.slug}.md`);
    const cardFile = await readFile(cardPath, "utf8");
    assert.match(cardFile, /^term: federated brewing$/m);
    assert.match(cardFile, /^\s+origin: vscode-terminal$/m);
    assert.ok(cardFile.includes("\nCaptured context body\n"));

    const persisted = await new CardStore(root).get(saved.slug);
    assert.ok(persisted);
    assert.equal(persisted.term, span);
    assert.equal(persisted.body, "Captured context body");
    assert.deepEqual(persisted.source, source);
  });

  test("editing a web card preserves its original source and origin", async () => {
    const root = workspaceRoot();
    const folderUri = workspaceFolderUri();
    const store = new CardStore(root);
    const originalSource = {
      span: "shared glossary",
      message: "Original web message excerpt",
      origin: "web"
    } as const;
    const existing = await store.create({
      term: "shared glossary",
      aliases: ["old alias"],
      body: "Old body",
      source: originalSource
    });
    const cardService = new CardService();
    const matched = await cardService.matchExisting(existing.term, folderUri);

    assert.ok(matched);
    const draft = draftFromCard(matched);
    assert.deepEqual(draft.source, originalSource);

    const updated = await cardService.save(
      {
        slug: draft.slug,
        term: draft.term,
        aliases: ["new alias"],
        body: "Updated body"
      },
      folderUri,
      {
        span: existing.term,
        message: "Fresh terminal output must not replace creation provenance",
        origin: "vscode-terminal"
      }
    );

    assert.equal(updated.slug, existing.slug);
    assert.equal(updated.body, "Updated body");
    assert.deepEqual(updated.source, originalSource);
    assert.deepEqual((await store.get(existing.slug))?.source, originalSource);
    assert.equal((await store.list()).length, 1);
    assert.deepEqual(await readdir(join(root, ".gloss", "cards")), [
      `${existing.slug}.md`
    ]);
  });

  test("rebuilds a stale index before matching an out-of-band core card", async () => {
    const root = workspaceRoot();
    const folderUri = workspaceFolderUri();
    const cardService = new CardService();

    assert.equal(await cardService.matchExisting("out-of-band card", folderUri), null);

    const externalStore = new CardStore(root);
    const existing = await externalStore.create({
      term: "out-of-band card",
      aliases: [],
      body: "Created outside the extension service",
      source: {
        span: "out-of-band card",
        message: "created via another core consumer",
        origin: "cli"
      }
    });

    await writeFile(
      join(root, ".gloss", "index.json"),
      `${JSON.stringify({
        version: 1,
        generatedAt: new Date(0).toISOString(),
        cards: []
      })}\n`,
      "utf8"
    );

    const matched = await cardService.matchExisting(existing.term, folderUri);
    assert.ok(matched);
    assert.equal(matched.slug, existing.slug);
    assert.equal(draftFromCard(matched).slug, existing.slug);
  });
});
