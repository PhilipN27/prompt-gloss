# Gloss Architecture

Status: **accepted** (planning session, 2026-07-13). This document records the
Path A/B decision with evidence, the component design, the data flow from
selection to injection, the on-disk file formats, and the injection budget
algorithm. Implementation sessions treat this as the spec; deviations require
editing this file in the same PR.

---

## 1. The Path A/B decision

### Gate question

Does the CloudCLI plugin API allow a plugin to hook into the **chat pane** —
capture text-selection events on the input box and message history, and render
an overlay/panel — or does it only allow adding separate tabs?

### Evidence (gathered 2026-07-13)

From [cloudcli.ai/docs/plugin-overview](https://cloudcli.ai/docs/plugin-overview):

> "Plugins are scoped to their own tab. They **cannot**: Modify the Chat,
> Shell, Files, Git, or Tasks tabs — plugins don't have access to the built-in
> UI."

The documented extension surface is exactly three capabilities: (1) context
access (`api.context` / `api.onContextChange()` — theme, project name, path,
session ID), (2) backend communication (`api.rpc(...)` and a WebSocket at
`/plugin-ws/:name`), and (3) DOM rendering **inside the plugin's own tab
container**. There are no extension points for selection events, chat overlays,
message middleware, message interception, or system-prompt/context injection.

From [github.com/cloudcli-ai/cloudcli-plugin-starter](https://github.com/cloudcli-ai/cloudcli-plugin-starter):
the manifest supports `"slot": "tab"` as the **only** slot; the starter states
plugins cannot "modify built-in tabs or appear outside the tab area" or
"interact with Claude's chat system". (The starter itself is MIT, but that is
moot given the capability gap.)

### Decision: **Path B** — standalone minimal web app

The gate question fails outright, not marginally: every load-bearing part of
Gloss (selection capture in the chat input and message history, a floating
panel over the chat, per-message context injection) is explicitly impossible
in a CloudCLI plugin. A Path A build would reduce Gloss to a disconnected
"cards" tab with no span anchoring — the differentiator would be gone.

Consequences:

- Gloss is a **local Node server + React front end** built on
  `@anthropic-ai/claude-agent-sdk`. The chat plumbing stays as thin as the SDK
  allows; the product is the interaction.
- **License:** MIT throughout (LICENSE at repo root, © Philip Nora). No AGPL
  code is adopted; nothing is copied from CloudCLI. The AGPL question that
  would have complicated Path A does not arise.
- **Hedge:** `packages/core` (store, matcher, budget) has zero UI and zero
  Agent SDK dependencies, so if CloudCLI ever ships chat-pane extension
  points, a plugin could reuse it (see ROADMAP.md → Path A watchpoint).

### Naming

`npm view gloss` → taken (`gloss@2.8.23`, a styling library).
`npm view prompt-gloss` → 404, free. **Package name: `prompt-gloss`**; the
core package publishes as `@prompt-gloss/core`. Product name remains "Gloss".

---

## 2. System overview

```
┌─────────────────────────── Browser ────────────────────────────┐
│  packages/web  (Vite + React)                                  │
│  ┌────────────┐  ┌──────────────────┐  ┌─────────────────────┐ │
│  │ Chat pane  │  │ Highlight layer  │  │ Card panel          │ │
│  │ + injection│  │ selection →      │  │ create / edit /     │ │
│  │   indicator│  │ floating button  │  │ delete              │ │
│  └─────┬──────┘  └────────┬─────────┘  └─────────┬───────────┘ │
└────────┼──────────────────┼──────────────────────┼─────────────┘
     SSE + REST        opens panel           REST /api/cards
         │                                         │
┌────────▼─────────────────────────────────────────▼─────────────┐
│  packages/server  (Fastify, binds 127.0.0.1 only)              │
│                                                                │
│   Claude Agent SDK session          Injection pipeline         │
│   query() streaming input   ◄────   UserPromptSubmit hook:     │
│   + resume across restarts          matcher → budget →         │
│         │                           <gloss-context> block      │
│         │                                   │                  │
│         │            ┌──────────────────────┴───────────────┐  │
│         │            │  @prompt-gloss/core  (packages/core) │  │
│         │            │  store · index · matcher · budget    │  │
│         │            └──────────────────────┬───────────────┘  │
└─────────┼───────────────────────────────────┼──────────────────┘
          ▼                                   ▼
   Anthropic API                 .gloss/  in the user's project
   (via Agent SDK)               ├─ cards/*.md      (source of truth)
                                 ├─ index.json      (generated)
                                 └─ .state/         (machine-local, self-gitignored)
```

Package responsibilities:

| Package | Owns | Must not contain |
|---|---|---|
| `packages/core` | card model, slugging, frontmatter (de)serialization, store CRUD on `.gloss/`, index generation, matcher, injection budget/formatting | UI code, HTTP, Agent SDK imports |
| `packages/server` | Agent SDK session lifecycle, REST + SSE API, wiring core into the `UserPromptSubmit` hook, fake-agent mode | matching/budget logic (delegates to core) |
| `packages/web` | chat pane, selection capture, floating affordance, card panel, injection indicator | direct fs access, matching logic |

---

## 3. Data flow: selection → card → store → matcher → injection

1. **Selection.** The user selects a span either in the draft `<textarea>`
   (`selectionStart`/`selectionEnd`) or in a rendered message
   (`window.getSelection()` + DOM ranges). The highlight layer normalizes both
   into `{ spanText, messageExcerpt, origin }` and positions a small floating
   affordance at the selection's bounding rect. These are two distinct code
   paths — both covered by Playwright (TESTING.md).
2. **Panel.** Clicking the affordance opens a non-modal panel (does not steal
   focus from typing). Term is pre-filled from the span (editable), plus
   aliases, body, disabled scope toggle (v1), Save/Delete. If the selected
   span already resolves to a card (via `POST /api/match` on the span text),
   the panel opens in **edit mode** with that card loaded.
3. **Store.** Save calls `POST /api/cards` (or `PUT /api/cards/:slug`). Core
   writes `.gloss/cards/<slug>.md` (format §4), then rebuilds
   `.gloss/index.json`. Cards edited by hand on disk are equally valid — the
   store re-reads and re-indexes when card files' mtimes change.
4. **Message send.** The user sends a chat message: `POST /api/messages`
   pushes it into the SDK session's streaming-input generator.
5. **Match + inject (inside the SDK turn).** The server registers a
   `UserPromptSubmit` hook with the Agent SDK. On each user prompt the hook:
   runs the core matcher over the prompt text → applies the injection budget
   (§6) → returns
   `{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "<gloss-context>…</gloss-context>" } }`.
   The SDK appends that context to the agent's conversation **without
   changing the visible user message**.
6. **Indicator.** The hook records `{ messageId, injectedSlugs }`; the server
   emits an `injection` SSE event, and the chat pane renders a subtle chip row
   on that user message listing the injected cards (click → open card in the
   panel). If nothing matched, no event and no chip.
7. **Persistence.** Knowledge durability comes from the card files, not the
   session: a fresh session in a fresh process re-runs steps 5–6 against the
   same `.gloss/` directory. SDK session `resume` (§7) is a convenience for
   conversational continuity, not the persistence mechanism.

### Why the `UserPromptSubmit` hook (and not the alternatives)

Verified against the Agent SDK (July 2026): `query()` accepts
`options.hooks.UserPromptSubmit`, whose hook return shape
`hookSpecificOutput.additionalContext: string` injects context invisibly for
exactly this use case.

- **vs. `systemPrompt` append** (`{ type: "preset", preset: "claude_code", append }`):
  the append is per-`query()` configuration, not per-message; mutating it
  every turn both misrepresents card context as standing instructions and
  churns the system-prompt prefix (cache-hostile). We still use a small static
  `append` to tell the agent what `<gloss-context>` blocks mean (one
  sentence, set once at session start).
- **vs. wrapping the user message content** in the streaming input: works, but
  the injected text becomes part of the user message proper (echoed in
  transcripts/history as user-authored). Kept as the documented **fallback**
  if a future SDK version changes hook semantics: append a
  `<gloss-context>` block as an additional content block on the outgoing user
  message, and render only the typed text in the UI.

---

## 4. File formats

### Card file — `.gloss/cards/<slug>.md`

```markdown
---
term: xyz
aliases:
  - metrics panel
  - xyz dashboard
created: 2026-07-13T20:15:00Z
updated: 2026-07-13T20:15:00Z
scope: project
source:
  span: "xyz"
  message: "I want a dashboard that helps me build xyz"
---

xyz is our internal name for the customer-facing metrics panel. It reads from
the `analytics_rollup` table, must stay under 200ms p95, and is owned by the
growth team. Do not add new queries without an index review.
```

Rules:

- `term` (string, required): the anchor term. `aliases` (string[], default
  `[]`). `created`/`updated`: ISO 8601 UTC. `scope`: `project` (default) |
  `global` (schema-reserved; v1 stores and injects project scope only —
  ROADMAP.md). `source`: the span text and a ≤200-char excerpt of the message
  it was selected in (provenance; not used for matching).
- Body: free markdown — this is what gets injected.
- Slug: kebab-cased `term` (Unicode-folded, lowercased, non-alphanumerics →
  `-`); collision appends `-2`, `-3`, …. Renaming a term keeps the slug
  (files don't move); the slug is an ID, not a display value.
- Human edits are first-class: the store tolerates hand-edited files,
  re-indexes on mtime change, and skips (with a logged warning, never a crash)
  files with malformed frontmatter.

### Index — `.gloss/index.json` (generated, disposable)

```json
{
  "version": 1,
  "generatedAt": "2026-07-13T21:04:00Z",
  "cards": [
    {
      "slug": "xyz",
      "file": "cards/xyz.md",
      "term": "xyz",
      "aliases": ["metrics panel", "xyz dashboard"],
      "updated": "2026-07-13T20:15:00Z",
      "scope": "project",
      "bodyTokens": 74
    }
  ]
}
```

Derived entirely from card files; rebuilt whenever cards change (and on server
start). Safe to delete. Users may commit it or not — it regenerates either way.

### Machine-local state — `.gloss/.state/`

`session.json` (`{ "sessionId": "…", "updatedAt": "…" }`) for SDK session
resume. On creation, the store writes `.gloss/.state/.gitignore` containing
`*`, so committing `.gloss/` never commits machine state (the Terraform
trick). Everything else in `.gloss/` is the user's choice to commit or ignore
— cards can contain sensitive context; Gloss documents the tradeoff and never
decides it (see CLAUDE.md → Privacy).

---

## 5. Matcher (v1)

Input: message text + the index. Output: a deduplicated set of card slugs.

1. **Normalize** both message and terms/aliases: Unicode NFKC, lowercase,
   collapse whitespace.
2. **Tokenize** on Unicode word boundaries.
3. **Stem-fold** each token (both sides, message and term):
   strip trailing `'s`; then strip trailing `s` when the token is longer than
   3 chars and doesn't end in `ss`, `us`, or `is`. (Folds `dashboards`,
   `engine's` → `dashboard`, `engine`; leaves `class`, `status`, `analysis`
   alone.) This is the entirety of v1 "simple stemming" — anything smarter is
   the v2 embeddings item.
4. **Match:** a single-token term matches on stem-folded token equality; a
   multi-word term/alias matches as a consecutive stem-folded token phrase.
   Terms containing non-word characters (e.g. `foo.bar`) match by
   case-insensitive literal search guarded by non-alphanumeric boundaries.
   Token equality gives word-boundary anchoring for free: `xyz` never matches
   `xyzabc`.
5. **Resolve + dedupe:** alias hits resolve to their owning card; overlapping
   hits collapse to one entry per card.

The behavioral contract for all of this is the golden set
(`packages/core/eval/cases.jsonl`) — see TESTING.md. Matcher changes without
golden-set changes in the same PR fail review.

## 6. Injection budget algorithm

Constants (env-overridable): `GLOSS_INJECT_BUDGET` = 2000 tokens total per
message, `GLOSS_CARD_CAP` = 800 tokens per card. Token estimate =
`ceil(chars / 4)` (documented heuristic; no tokenizer dependency in v1).

Given the matched cards for one user message:

1. Drop cards already injected this session, **unless** the card's `updated`
   is newer than when it was last injected (session dedup — the agent already
   has unchanged cards in context; re-sending bloats the conversation).
2. Sort survivors by `updated` descending (most-recently-updated wins —
   per the product spec).
3. Greedy pack in that order: for each card, estimate
   `tokens(header + body)`; if a single card exceeds `GLOSS_CARD_CAP`,
   truncate its body at the cap and append `\n…[truncated by Gloss]`. Include
   the card if the running total stays ≤ `GLOSS_INJECT_BUDGET`; otherwise
   **skip it and keep going** (a smaller, older card may still fit).
4. Record `{ slug, updated }` for every injected card in the session's
   injection log (drives step 1 and the UI indicator). The log is in-memory
   and scoped to the server process: a restart resets dedup, so a card may be
   injected once more into a resumed conversation. Accepted for v1 — worst
   case is one duplicate injection per card, and a resumed session may have
   been compacted anyway.
5. Emit the payload:

```text
<gloss-context>
The user has attached the following context cards to terms in their message.
Treat them as authoritative background provided by the user.
<card term="xyz" aliases="metrics panel, xyz dashboard" file=".gloss/cards/xyz.md">
…card body…
</card>
<card term="billing engine" file=".gloss/cards/billing-engine.md">
…card body…
</card>
</gloss-context>
```

The exact wrapper is snapshot-tested (TESTING.md) so format drift is always a
visible diff. Cards are user-authored and injected as user-provided background
— Gloss adds no instructions beyond the one framing sentence.

## 7. Agent session (server ↔ SDK)

Verified SDK surface (July 2026, `@anthropic-ai/claude-agent-sdk`; auth via
`ANTHROPIC_API_KEY` pass-through):

- One SDK session per server process per project dir:
  `query({ prompt: streamingInput(), options })` where `streamingInput()` is an
  async generator the server pushes user messages into
  (`{ type: "user", message: { role: "user", content } }`); the returned
  `Query` async-iterates assistant/tool/system events which the server relays
  to the browser over SSE.
- `options` (initial): `systemPrompt: { type: "preset", preset: "claude_code",
  append: <one sentence explaining <gloss-context>> }`,
  `hooks: { UserPromptSubmit: [ { hooks: [glossInjectionHook] } ] }`,
  `permissionMode` and `allowedTools` passed through from server config
  (default: SDK defaults — Gloss does not restrict the agent's coding tools;
  it is a Claude Code UI, not a sandbox).
- Session ID arrives on the first `{ type: "system", subtype: "init",
  session_id }` event → persisted to `.gloss/.state/session.json`. On server
  start, if a session ID exists, pass `options.resume = sessionId`; if resume
  fails, start fresh (cards make knowledge durable regardless — §3.7).
- Fake-agent mode (`GLOSS_FAKE_AGENT=1`): the SDK call is replaced by a
  scripted responder that records the injected payload (exposed at
  `GET /api/debug/last-injection`); everything else runs the real code path.
  For hermetic e2e/CI — see TESTING.md.

### Server API

| Route | Purpose |
|---|---|
| `GET /api/session` | current session info (id, project dir, resumed?) |
| `POST /api/messages` `{ text }` | enqueue user message → `{ messageId }` |
| `GET /api/events` (SSE) | stream: assistant deltas, tool events, `injection` events (`{ messageId, slugs }`), errors |
| `GET /api/cards` / `GET /api/cards/:slug` | list / read cards |
| `POST /api/cards` / `PUT /api/cards/:slug` / `DELETE /api/cards/:slug` | create / update / delete |
| `POST /api/match` `{ text }` | → `{ slugs }`; UI uses it to open edit mode on selection |
| `GET /api/debug/last-injection` | fake-agent mode only |

Server binds `127.0.0.1` only. No auth in v1 (localhost, single user); do not
add remote-access features (ROADMAP.md non-goals).

---

## 8. Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1 | Path B (standalone app), not CloudCLI plugin | Plugin API is tab-only; chat-pane hooks impossible (§1 evidence) |
| 2 | npm name `prompt-gloss`; core as `@prompt-gloss/core` | `gloss` taken on npm (verified 2026-07-13) |
| 3 | Injection via `UserPromptSubmit` hook `additionalContext` | Per-message, invisible in the visible prompt, cache-friendly; fallback documented (§3) |
| 4 | pnpm workspaces; Fastify; Vite + React; SSE (not WebSocket) | Boring, typed, minimal; SSE is sufficient for one-way streaming + REST for actions |
| 5 | `scope: global` reserved in schema, implemented in v2 | Bootstrap spec lists global-across-projects under v2; panel toggle ships disabled (ROADMAP.md) |
| 6 | Session dedup: one injection per card per session unless updated | Balances context bloat vs. freshness; compaction-caused loss accepted in v1 |
| 7 | Token estimate = `ceil(chars/4)` | No tokenizer dep; budget is a guardrail, not billing |
| 8 | `.gloss/.state/` self-gitignores via inner `.gitignore` | Cards committable, machine state never accidentally committed |
| 9 | Fake-agent mode for e2e | Hermetic CI without API keys; the LLM is not the unit under test |

## 9. Risks and open questions (for the implementation session)

- **Hook contract drift.** The `UserPromptSubmit` `additionalContext` shape is
  verified against current docs but the SDK moves fast — implement the hook
  behind a small `Injector` interface in `packages/server` so the fallback
  (§3) is a one-file swap. Be precise about what each test layer proves: the
  fake agent implements the **same `Injector` boundary**, so integration/e2e
  tests verify the pipeline up to that boundary — they cannot exercise the
  real SDK hook, which never fires in fake mode. The real hook wiring is
  covered by a manual smoke check against the live SDK (real API key, one
  message, confirm the card content influenced the response) — run it before
  any release and after any Agent SDK version bump.
- **Selection UX edge cases.** Selections spanning multiple messages, inside
  code blocks, or collapsing on scroll — v1 policy: single-message selections
  only; the affordance hides on empty/cross-message selections.
- **Very large card sets.** Index + matcher are in-memory and O(message
  tokens × terms) — fine for hundreds of cards; revisit only with evidence
  (ROADMAP.md non-goals: no database).
- **`messageExcerpt` privacy.** `source.message` stores a ≤200-char excerpt in
  the card file; users committing `.gloss/` should know excerpts of prompts
  land in git history — call this out in the README.
