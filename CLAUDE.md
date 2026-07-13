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
- What ships in v1 / v2 / never: **ROADMAP.md**
- Test layers, golden set, Playwright scenarios: **TESTING.md**
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
  the final review gate on every merge.
- **GPT-5.6 / Codex:** UI components in `packages/web`, Playwright tests, docs
  polish — working from the same specs (ARCHITECTURE.md, TESTING.md).
- Both work from this file + AGENTS.md; cross-review each other's diffs before
  merge.

## v1 definition of done

A user can: run the app against a real project, highlight a span in a draft
prompt or prior message, save a context card, see it injected on matching
messages (with indicator), restart entirely, and have the same knowledge apply
in a fresh session. CI green, matcher eval passing, MIT LICENSE and complete
.gitignore in place, README with a 60-second GIF demo and an honest comparison
to mem0 / CloudCLI / cui explaining the span-anchored difference.

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
- **v1 scope is fixed.** Embeddings, global scope, and card suggestions are
  v2 (ROADMAP.md). Do not implement them early "while we're in there".
- **No AGPL code.** Do not copy code from CloudCLI or other AGPL projects into
  this MIT repo.
