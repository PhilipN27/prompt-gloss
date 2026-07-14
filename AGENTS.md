# Gloss (`prompt-gloss`) — agent guide

> Gloss any word in your prompt. Claude remembers what it means, forever.

This file is the project context for GPT-5.6 / Codex-style agents. It mirrors
**CLAUDE.md** (the same content for Claude agents). **Any change to the shared
content of one MUST be applied to the other in the same commit** — if you edit
this file, edit CLAUDE.md too, and say so in the commit message.

## What Gloss is

Gloss lets a user highlight any span of text in a chat with Claude Code — in
their own draft prompt or in a previous response — and attach context to it as
a named, file-backed **context card**. Whenever that term (or an alias) appears
in a later message, the card is automatically injected into the agent's
context: this session and every future one, without bloating the visible
prompt. A "gloss" is an explanatory note attached to a specific word in a text.

**The span-anchored interaction is the product.** The chat pane is disposable
plumbing. Read the [Guardrails](#guardrails) before adding anything.

- npm package: `prompt-gloss` (`gloss` is taken — verified July 2026). License: MIT.
- Architecture decision + evidence, data flow, file formats: **ARCHITECTURE.md**
- Terminal surfaces (Claude Code hook, IDE extension, OS companion) — the v2
  spec, gate evidence, capture ladder, install story: **TERMINAL.md**
  (binding with the same authority as ARCHITECTURE.md)
- What ships in v1 / v2 / v3 / never: **ROADMAP.md**
- Test layers, golden set, Playwright scenarios, hook/extension plans, live
  smoke: **TESTING.md**

## Your lane (division of labor)

- **You (GPT-5.6 / Codex):** UI components in `packages/web` (chat pane,
  highlight affordance, card panel, injection indicator), Playwright tests in
  `packages/web/e2e/`, and docs polish — working from ARCHITECTURE.md and
  TESTING.md as specs. **v2 terminal:** the VS Code/Cursor extension UX
  (`packages/vscode` — contributions, capture command, webview wiring per
  TERMINAL.md §7), the `panel-ui` extraction from `packages/web` (v1 e2e must
  stay green), extension-harness tests (TESTING.md), and companion panel UX.
- **Claude (Fable 5):** architecture-sensitive work — `packages/core` (store,
  matcher, injection budget), Agent SDK integration in `packages/server`, and
  the **final review gate on every merge**. **v2 terminal:** the hook pipeline
  and bundle (`packages/hook`), the CLI with settings merge/unmerge
  (`packages/cli`), and the companion capture architecture (TERMINAL.md §8).
- **Cross-review:** you review Claude's diffs, Claude reviews yours, before
  merge; findings are logged in PR notes. Do not merge unreviewed work.
- If your task requires changing `packages/core` interfaces, the injection
  format, the hook stdin/stdout contract, `CardSource.origin`, or the
  `SelectionSource` interface, stop and flag it for the Claude lane instead of
  changing it unilaterally — those contracts are pinned by ARCHITECTURE.md,
  TERMINAL.md, and the golden set.

## Repo layout

pnpm workspace monorepo, TypeScript strict everywhere, Node ≥ 20:

```
packages/
  core/     # @prompt-gloss/core — card store, matcher, injection budget.
            # Pure Node, zero UI deps, no Agent SDK dep. Claude's lane.
  server/   # Fastify server: Claude Agent SDK session, REST + SSE API,
            # wires core's matcher/injector into every user message. Claude's lane.
  web/      # Vite + React chat UI: chat pane, highlight affordance,
            # card panel, injection indicator. Your lane.

  # v2 terminal surfaces (planned — spec in TERMINAL.md §10/§11):
  hook/     # @prompt-gloss/hook — Claude Code UserPromptSubmit/SessionStart
            # pipeline; single esbuild CJS bundle. Claude's lane.
  cli/      # prompt-gloss — published CLI: init / uninstall / add / log /
            # doctor / companion / web. Claude's lane. (Root workspace package
            # renames to @prompt-gloss/monorepo so this can take the npm name.)
  vscode/   # gloss-terminal — VS Code/Cursor extension. Your lane.
  panel-ui/ # shared React card panel, extracted from web/. Your lane.
```

## Commands

```bash
pnpm install                            # workspace install (corepack enable first)
pnpm dev                                # server + web, watch mode
pnpm lint / pnpm typecheck              # eslint / tsc -b (strict)
pnpm test                               # vitest unit tests
pnpm eval:matcher                       # matcher golden-set eval (merge gate)
pnpm test:e2e                           # playwright; self-contained, fake-agent mode
pnpm check                              # lint + typecheck + test + eval — run before every commit
```

v2 adds (once the terminal packages land — TERMINAL.md §11, TESTING.md):
`pnpm test:hook` (hook-contract suite against the built bundle; CI runs it on
a 3-OS matrix) and the `packages/vscode` extension-harness suite.

## Architecture summary

Standalone local web app (**Path B** — the CloudCLI plugin API is tab-only and
cannot host the interaction; evidence in ARCHITECTURE.md).

Data flow: user selects a span → panel saves a card to
`.gloss/cards/<slug>.md` (YAML frontmatter: `term`, `aliases`, `created`,
`updated`, `scope`, `source`; markdown body = the context) → store rebuilds
`.gloss/index.json` → on each user message the matcher (exact +
case-insensitive + simple stemming, word-boundary anchored) selects cards →
the injector packs them most-recently-updated-first under a token budget and
injects them with `<gloss-context>` delimiters via the Agent SDK, once per card
per session → the UI shows which cards were injected on that message.

Cards are human-editable and git-committable by design. No database. The index
is generated and disposable; card files are the source of truth.

## Engineering standards (non-negotiable)

1. **TDD for the core.** Tests for the store, matcher, and injection budget
   are written BEFORE their implementation. Never mock away the unit under
   test: store tests hit a real temp-dir filesystem; matcher/budget tests run
   the real algorithms. Only the LLM itself may be faked (`GLOSS_FAKE_AGENT=1`
   — see TESTING.md). The same discipline applies to your lane: Playwright
   tests exercise the real UI against the real server in fake-agent mode.
2. **Matcher eval is a merge gate.** The golden set in `packages/core/eval/`
   runs in CI; any regression fails the build.
3. **CI from day one.** `.github/workflows/ci.yml`: lint, typecheck, unit,
   eval, e2e — all required checks.
4. **TypeScript strict everywhere.** No `any` escapes in `packages/core`.
5. **Small commits, conventional messages.** `feat(web): …`, `fix(web): …`,
   `test(e2e): …`, `docs: …`. One logical change per commit; tests travel
   with the code they test.
6. **Privacy.** Cards can contain sensitive project context. They are never
   transmitted anywhere except into the local agent session. The server binds
   to localhost only. No telemetry. Whether a user project commits or
   gitignores its `.gloss/` directory is the user's choice — document it,
   don't decide it. (This repo DOES commit its test-fixture `.gloss/` cards
   for the matcher eval.)

## UI interaction contract (your acceptance spec)

From ARCHITECTURE.md — the panel and affordance you build must satisfy:

- Selecting text in the draft input **or** any rendered message shows a small
  floating affordance near the selection; clicking it opens the panel.
- The panel is non-modal and must not steal focus from typing.
- Panel fields: term (pre-filled from the selection, editable), aliases,
  context body, scope toggle (disabled in v1 — "global scope: v2"), Save;
  Delete when editing an existing card.
- Selecting a span whose term/alias already has a card opens it in edit mode.
- Each user message that triggered injection shows a subtle indicator listing
  the injected cards.
- Draft-input selection (`selectionStart`/`selectionEnd`) and rendered-message
  selection (DOM ranges) are different code paths — both are covered by the
  Playwright scenarios in TESTING.md, which are the acceptance tests.

## v1 definition of done (met 2026-07-14)

A user can: run the app against a real project, highlight a span in a draft
prompt or prior message, save a context card, see it injected on matching
messages (with indicator), restart entirely, and have the same knowledge apply
in a fresh session. CI green, matcher eval passing, MIT LICENSE and complete
.gitignore in place, README with a 60-second GIF demo and an honest comparison
to mem0 / CloudCLI / cui explaining the span-anchored difference.

The **v2 (terminal) definition of done** is recorded verbatim in
TERMINAL.md §14.

## Guardrails

- **No scope creep into generic chat features.** No threads, model pickers,
  file browsers, git panes, terminals, agents dashboards. If a feature would
  make sense in any Claude chat UI, it does not belong here. ROADMAP.md
  non-goals are binding.
- **Don't decouple cards from spans.** Features that turn Gloss into a generic
  memory store dissolve the product. Card creation always starts from a
  highlighted span.
- **Keep the chat plumbing thin.** Complexity budget goes to the interaction,
  not the client.
- **Terminal surfaces follow TERMINAL.md.** The capture ladder, the
  never-fork-the-matcher rule, the hook's never-break-the-prompt failure
  policy, and the rejected alternatives (§13 — notably: no PTY wrapper, no
  TUI fork) are binding. No generic terminal tooling (ROADMAP.md non-goals).
- **v2 scope is fixed.** Embeddings, global scope, and card suggestions are
  v3 (ROADMAP.md). Do not implement them early.
- **No AGPL code.** Do not copy code from CloudCLI or other AGPL projects into
  this MIT repo.
