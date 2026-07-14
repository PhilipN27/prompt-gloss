# Gloss (`prompt-gloss`)

> Gloss any word in your prompt. Claude remembers what it means, forever.

Gloss lets a user highlight any span of text in a chat with Claude Code — in
their own draft prompt or in a previous response — and attach context to it as
a named, file-backed **context card**. Whenever that term (or an alias) appears
in a later message, the card is automatically injected into the agent's
context: this session and every future one, without bloating the visible
prompt. A "gloss" is an explanatory note attached to a specific word in a text —
the historical name for exactly this feature.

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
- Codex/GPT agents read **AGENTS.md** — it mirrors this file. **Any change to
  the shared content of one MUST be applied to the other in the same commit.**

## Repo layout

pnpm workspace monorepo, TypeScript strict everywhere, Node ≥ 20:

```
packages/
  core/     # @prompt-gloss/core — card store, matcher, injection budget.
            # Pure Node, zero UI deps, no Agent SDK dep. The crown jewels.
  server/   # Fastify server: Claude Agent SDK session, REST + SSE API,
            # wires core's matcher/injector into every user message.
  web/      # Vite + React chat UI: chat pane, highlight affordance,
            # card panel, injection indicator.

  # v2 terminal surfaces (planned — spec in TERMINAL.md §10/§11):
  hook/     # @prompt-gloss/hook — Claude Code UserPromptSubmit/SessionStart
            # pipeline; ships as a single esbuild CJS bundle.
  cli/      # prompt-gloss — the published CLI: init / uninstall / add / log /
            # doctor / companion / web. (Root workspace package renames to
            # @prompt-gloss/monorepo so this can take the npm name.)
  vscode/   # gloss-terminal — VS Code/Cursor extension (Marketplace + OpenVSX).
  panel-ui/ # shared React card panel, extracted from web/ (web e2e stays green).
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
   — see TESTING.md).
2. **Matcher eval is a merge gate.** The golden set in `packages/core/eval/`
   runs in CI; any regression fails the build. New matcher behavior lands with
   new golden cases in the same PR.
3. **CI from day one.** `.github/workflows/ci.yml`: lint, typecheck, unit,
   eval, e2e — all required checks.
4. **TypeScript strict everywhere.** No `any` escapes in `packages/core`.
5. **Small commits, conventional messages.** `feat(core): …`, `fix(web): …`,
   `test(core): …`, `docs: …`. One logical change per commit; tests travel
   with the code they test.
6. **Privacy.** Cards can contain sensitive project context. They are never
   transmitted anywhere except into the local agent session. The server binds
   to localhost only. No telemetry. Whether a user project commits or
   gitignores its `.gloss/` directory is the user's choice — document it,
   don't decide it. (This repo DOES commit its test-fixture `.gloss/` cards
   for the matcher eval.)
7. **Cross-review.** Every PR is reviewed by the other agent lane before
   merge; findings are logged in PR notes. Claude holds the final review gate
   on every merge.

## Division of labor (implementation sessions)

- **Claude (Fable 5):** architecture-sensitive work — `packages/core` (store,
  matcher, injection budget), Agent SDK integration in `packages/server`, and
  the final review gate on every merge. **v2 terminal:** the hook pipeline and
  bundle (`packages/hook`), the CLI with the settings merge/unmerge logic
  (`packages/cli`), and the companion's capture architecture (the
  `SelectionSource` adapters and per-OS mechanisms — TERMINAL.md §8).
- **GPT-5.6 / Codex:** UI components in `packages/web`, Playwright tests, docs
  polish — working from the same specs (ARCHITECTURE.md, TESTING.md).
  **v2 terminal:** the VS Code/Cursor extension UX (`packages/vscode` —
  contributions, capture command, webview wiring per TERMINAL.md §7), the
  `panel-ui` extraction, extension-harness tests, and companion panel UX.
- Interface contracts between the lanes (hook stdin/stdout, `CardSource.origin`,
  the `SelectionSource` interface, the `<gloss-context>` format) are pinned by
  TERMINAL.md + the golden set — changing one is a Claude-lane,
  spec-edit-in-same-PR change, exactly like `packages/core` contracts.
- Both work from this file + AGENTS.md; cross-review each other's diffs before
  merge.

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
  memory store (bulk fact import, auto-remember-everything) dissolve the
  product. Card creation always starts from a highlighted span.
- **Keep the chat plumbing thin.** Prefer the simplest Agent SDK usage that
  supports the loop. Complexity budget goes to the interaction, not the client.
- **Terminal surfaces follow TERMINAL.md.** The capture ladder, the
  never-fork-the-matcher rule, the hook's never-break-the-prompt failure
  policy, and the rejected alternatives (§13 — notably: no PTY wrapper, no
  TUI fork) are binding. No generic terminal tooling (ROADMAP.md non-goals).
- **v2 scope is fixed.** Embeddings, global scope, and card suggestions are
  v3 (ROADMAP.md). Do not implement them early "while we're in there".
- **No AGPL code.** Do not copy code from CloudCLI or other AGPL projects into
  this MIT repo.
