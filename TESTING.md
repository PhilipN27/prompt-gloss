# Gloss Testing Guide

How Gloss is tested, what "tested" means for each layer, and exactly how agents
run the suite. The engineering standards behind this file are in CLAUDE.md /
AGENTS.md; the architecture terms used here (store, matcher, injector, budget)
are defined in ARCHITECTURE.md.

## Ground rules (non-negotiable)

1. **TDD for the core.** For `packages/core` (store, matcher, injection
   budget): write the failing test first, then the implementation, in the same
   PR. A core PR whose tests were written after the fact — or worse, whose
   tests merely mirror the implementation — fails review.
2. **Never mock away the unit under test.**
   - Store tests use the **real filesystem** (a fresh temp dir per test via
     `fs.mkdtemp`), never an fs mock.
   - Matcher tests run the **real matcher** against real card fixtures.
   - Budget tests run the **real packing algorithm** with constructed cards.
   - The only thing that may ever be faked is the LLM itself (see
     [Fake agent mode](#fake-agent-mode)) — Claude's responses are not the unit
     under test; Gloss's behavior is.
3. **The matcher eval is a merge gate.** The golden set (below) runs in CI on
   every push/PR. Any case regression fails the build. New matcher behavior
   requires new golden cases in the same PR.
4. **Deterministic tests only.** No network, no live API calls, no timing
   sleeps in unit tests. Playwright uses web-first assertions (auto-waiting),
   not fixed timeouts.

## Test layers

| Layer | Tool | Lives in | What it covers |
|---|---|---|---|
| Unit | Vitest | `packages/*/src/**/*.test.ts` (colocated) | store, matcher, budget, slug/frontmatter utils, server route handlers |
| Matcher eval | Vitest (separate project) + golden set | `packages/core/eval/` | end-to-end matching quality against committed fixtures |
| E2E | Playwright | `packages/web/e2e/` | the highlight interaction, panel, indicator, persistence — real browser, real server, fake agent |
| Hook contract | Vitest, spawning the real bundle | `packages/hook/test/` | the terminal injection pipeline: synthetic stdin → real `gloss-hook.cjs` → stdout JSON contract (see [Terminal surfaces](#terminal-surfaces)) |
| CLI | Vitest, temp dirs + fixture settings | `packages/cli/test/` | `init`/`uninstall` settings merge, `add`/`log`/`doctor` |
| Extension | `@vscode/test-electron` | `packages/vscode/src/test/` | activation, commands, capture round-trip, webview save path |
| Companion | Vitest (flow), manual matrix (OS capture) | `packages/cli/test/companion/` | hotkey→capture→panel flow against scripted `SelectionSource`s |

### Unit tests — what must be covered

**Store (`packages/core`)** — written before implementation:
- create card → file exists at `.gloss/cards/<slug>.md`, frontmatter
  round-trips (parse(serialize(card)) deep-equals card).
- slug generation: kebab-case, Unicode folding, collision → `-2` suffix.
- update card → `updated` bumps, `created` stable, body replaced.
- delete card → file removed, index entry removed.
- index rebuild: cards edited by hand on disk (the supported workflow!) are
  picked up; malformed frontmatter produces a warning + skip, never a crash.
- scope defaults to `project` when absent.

**Matcher (`packages/core`)** — written before implementation:
- exact match, case-insensitive match, word-boundary anchoring
  (`xyz` must NOT match `xyzabc`).
- simple stemming (plural/possessive: `dashboards`/`dashboard's` match
  `dashboard`); multi-word phrase terms with whitespace normalization.
- alias matches resolve to the owning card; overlapping matches dedupe to one
  card; punctuation-adjacent terms (`xyz.`, `"xyz"`) match.
- non-matches: substrings, unrelated words, empty message.

**Injection budget (`packages/core`)** — written before implementation:
- packing in `updated`-desc order; greedy skip of cards that would exceed the
  budget; single oversized card truncated at the per-card cap with a
  truncation marker.
- session dedup: a card injects once per session; injects again only if
  `updated` changed since the last injection.
- delimiter format snapshot: the exact `<gloss-context>` wrapper (see
  ARCHITECTURE.md) is asserted, so injection-format drift is a visible diff.

**Server (`packages/server`)**:
- card CRUD routes against a temp project dir.
- message pipeline: POST message → matcher runs → injected slugs are returned
  in the message-accepted response (this is the data the indicator renders).

### Matcher eval — the golden set

**Location:** `packages/core/eval/`

```
packages/core/eval/
  fixtures/
    .gloss/
      cards/
        xyz.md            # committed fixture cards — these ARE checked in;
        billing-engine.md # the repo's .gitignore explicitly does not ignore them
        ...
  cases.jsonl
  run-eval.test.ts        # loads fixtures, runs matcher on every case
```

**Case format** — one JSON object per line in `cases.jsonl`:

```json
{"name": "exact term",            "message": "I want a dashboard that helps me build xyz", "expect": ["xyz"]}
{"name": "case-insensitive",      "message": "What is XYZ again?",                          "expect": ["xyz"]}
{"name": "plural stem",           "message": "clean up the billing engines",                "expect": ["billing-engine"]}
{"name": "alias resolves",        "message": "the metrics panel is slow",                   "expect": ["xyz"]}
{"name": "no substring match",    "message": "the xyzabc module",                           "expect": []}
{"name": "multiple cards",        "message": "wire xyz into the billing engine",            "expect": ["xyz", "billing-engine"]}
```

- `expect` is the **exact set** of card slugs (order-insensitive) the matcher
  must return for that message against the fixture cards.
- The eval asserts set equality per case and reports every failing case with
  its diff (missing/extra slugs). One failing case fails the suite, which
  fails CI.
- Adding matcher behavior = adding cases in the same PR. Removing or loosening
  a case requires a written justification in the PR description.
- v2's embedding matcher gets a **separate** section/file of semantic cases;
  the v1 exact/stem cases keep running and keep passing forever.

Run it alone: `pnpm eval:matcher` (alias for the Vitest project that contains
`run-eval.test.ts`).

## E2E — Playwright

**Scope:** the highlight interaction is the product; these tests are the
product's acceptance tests. Chromium-only in CI (v1); the suite must pass
headless.

### Fake agent mode

E2E must be hermetic: no API key, no network. The server supports
`GLOSS_FAKE_AGENT=1`, which replaces only the Claude Agent SDK call with a
scripted responder that (a) streams a canned response and (b) **records the
exact injected context payload** it received. Everything else — store, matcher,
budget, injection formatting, indicator data — is the real code path. A debug
endpoint (`GET /api/debug/last-injection`, enabled only in fake mode) exposes
the recorded payload so tests can assert on what would have reached Claude.

This is the permitted use of faking (the LLM is not under test). Do not stub
the matcher, store, or budget in E2E.

### Required scenarios

Each scenario runs against a throwaway temp project directory created in the
test's `beforeEach` (the server takes the project dir as config).

1. **Create card from draft input.** Type a prompt containing `xyz` → select
   the span `xyz` in the textarea → floating affordance appears near the
   selection → click → panel opens, term pre-filled `xyz`, focus NOT stolen
   from panel-opening click (typing continues to work if the user clicks back
   into the input) → fill body + aliases → Save → panel closes →
   `.gloss/cards/xyz.md` exists with correct frontmatter (assert via card-list
   API) → `source` frontmatter carries the span text and message excerpt.
2. **Create card from an assistant message.** Send a message (fake agent
   replies) → select a span inside the rendered assistant response → save a
   card → card exists and its `source` records the selected span + excerpt.
3. **Injection + indicator.** With card `xyz` saved: send a message containing
   `xyz` → the message row shows the injection indicator listing `xyz` → the
   debug endpoint shows the `<gloss-context>` payload containing the card body
   under budget.
4. **Edit existing card.** Select `xyz` again (in a new message or draft) →
   panel opens pre-populated in edit mode → change the body → Save →
   `updated` bumped, body replaced → Delete on a subsequent open removes the
   file and the indicator no longer fires for `xyz`.
5. **Persistence across restart.** Save a card → stop the server process →
   start a fresh server (new SDK session) on the same project dir → send a
   message containing the term → indicator fires and the debug payload
   contains the card. (This is the "restart entirely, knowledge survives"
   acceptance test from the v1 definition of done.)
6. **No match, no noise.** Send a message matching nothing → no indicator, and
   the debug endpoint shows no injected payload.
7. **Budget overflow.** Seed several large cards whose combined size exceeds
   the budget, send a message matching all of them → indicator lists only the
   most-recently-updated cards that fit; debug payload confirms the packing
   order.

Selection-in-textarea note for implementers: draft-input selection uses
`selectionStart`/`selectionEnd` (Playwright: `locator.evaluate` to set, or
keyboard `Shift+Arrow` selection); message-selection uses DOM ranges (`page.mouse`
drag or triple-click a word). Both paths must be exercised — they are different
code.

## Terminal surfaces

Test plans for the TERMINAL.md surfaces. The v1 ground rules apply verbatim,
with one principled extension of rule 2: alongside the LLM, the **OS/editor
input boundary** (a real human's terminal selection, a real global keypress)
may be faked, because CI cannot synthesize it — everything downstream of that
boundary (capture flow, matcher, budget, store, settings merge) runs real.
This mirrors the v1 `Injector` precedent exactly: fake the boundary, never
the pipeline, and cover the real boundary with a documented live smoke.

### Hook contract tests (`packages/hook`) — written before implementation

These spawn the **real built bundle** (`node dist/gloss-hook.cjs`) as a child
process with a synthetic stdin payload against a temp-dir `.gloss/` fixture —
the same payload shape captured from the live CLI probe (TERMINAL.md §2.1:
`session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`,
`hook_event_name`, `prompt`). Required cases:

- **Match → contract:** prompt containing a fixture term → stdout is exactly
  `{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } , systemMessage }`,
  exit 0; `additionalContext` matches the snapshot-locked `<gloss-context>`
  wrapper; `systemMessage` names the injected slugs.
- **No match → silence:** unrelated prompt → empty stdout, exit 0 (no
  systemMessage — no noise).
- **Session dedup across invocations:** same `session_id`, same term, two
  invocations → second emits nothing; bump the card's `updated` between
  invocations → second re-injects. Different `session_id` → injects fresh.
  State lands in `.gloss/.state/sessions/<session_id>.json` (atomic write:
  no partial file after a killed run).
- **Budget + cap:** oversized card set → packing honors the v1 budget rules;
  a payload that would exceed 9,500 chars is clamped with the
  `…[truncated by Gloss]` marker (Claude Code's 10,000-char hook-output cap,
  TERMINAL.md §2.1, must never be hit).
- **Never break the prompt:** malformed stdin JSON, missing `.gloss/`,
  unreadable index, corrupted session state file → empty stdout, **exit 0**
  (never exit 2 — that erases the user's prompt), error appended to
  `.gloss/.state/hook-errors.log`.
- **Skip switch (both modes):** `GLOSS_SKIP_HOOK=1` in the environment → empty
  stdout, exit 0, no state/log write — checked **before** parsing stdin, for
  **both** the normal `UserPromptSubmit` invocation **and** `--session-start`
  (no framing `additionalContext` either). This is what keeps the v1 web-app
  SDK session from double-injecting when the file hook is also installed
  (TERMINAL.md §4.5).
- **Concurrent append:** two hook processes injecting simultaneously into the
  same project → `injections.jsonl` contains both records with no interleaved
  or corrupted lines; both `sessions/*.json` files intact (TERMINAL.md §4.2).
- **SessionStart mode:** `--session-start` → framing `additionalContext`;
  prunes `sessions/*.json` older than 30 days; trims `injections.jsonl`.
- **Injection log:** every injection appends one line to
  `.gloss/.state/injections.jsonl` (drives `prompt-gloss log`).

Run: `pnpm test:hook` (bundle is built first — the tests exercise the
artifact that ships, not the TS sources). **CI runs this suite on the
ubuntu + windows + macos matrix** — it is the cross-platform merge gate for
the injection path.

### CLI tests (`packages/cli`)

Temp-dir projects with fixture `.claude/settings.json` files:

- `init` into: no settings file / empty file / existing unrelated hooks /
  existing Gloss entries (idempotent re-run) → Gloss entries present exactly
  once, **every pre-existing key byte-preserved**, hook bundle copied,
  `--dry-run` writes nothing. The same cases run against both targets:
  `.claude/settings.json` (default) and `.claude/settings.local.json`
  (`--local`).
- `uninstall` → Gloss entries removed from **both** `settings.json` and
  `settings.local.json` (whichever exist), `.gloss/hook/` + `.gloss/.state/`
  + `.claude/commands/gloss.md` removed; cards and unrelated settings
  untouched; running it twice is a no-op.
- `add` → card file identical in shape to a panel-created card
  (`origin: cli`); `log` renders the jsonl fixture; `doctor` flags a missing
  hook entry and a stale bundle.

### Extension tests (`packages/vscode`)

Via `@vscode/test-electron` (real VS Code, headless in CI with xvfb):

- Activation + command/keybinding/menu contributions registered (assert
  against the packaged `package.json`).
- Capture command with a **pre-seeded clipboard** (the harness cannot select
  text in a real terminal — that sits beyond the input boundary): saved
  user clipboard is restored after capture; panel opens prefilled; Save
  writes the card via core to the workspace `.gloss/` (assert on disk);
  editing an existing term opens edit mode.
- Webview ↔ host message contract (postMessage round-trip snapshot).
- Real-terminal selection capture and the shell-integration provenance
  buffer are **live-smoke items** (below) — documented as untestable in the
  harness, per the boundary rule.

### Companion tests (`packages/cli`, companion module)

- Capture adapters live behind the `SelectionSource` interface (one per
  OS/mechanism). Flow tests drive the real companion loop with a scripted
  `SelectionSource` (boundary fake): hotkey event → capture → panel URL
  opened → card saved via the real server route → OS notification emitted.
- Windows clipboard-freshness logic (accept fresh, reject stale with the
  "copy first" toast) is pure logic — unit-tested with constructed
  timestamps/snapshots.
- Real hotkey + real per-OS capture are live-smoke items.

### Live smoke — the release gate for terminal surfaces

Extends the v1 precedent (ARCHITECTURE.md §9: the real SDK hook is smoked,
not unit-tested). Run before any release touching hook/CLI/extension/
companion, and after any Claude Code CLI major bump. Record results in the
release PR description.

1. **Hook, scripted check (semi-automated):** in a scratch project after
   `npx prompt-gloss init` + one card:
   `claude -p "<prompt with the term>" --model haiku --output-format stream-json --include-hook-events`
   → assert the `hook_response` event for `UserPromptSubmit` has
   `outcome: "success"` and the reply uses card-only knowledge. (This exact
   flow was proven in the planning session against CLI 2.1.197.)
2. **Hook, interactive TUI:** same project, interactive `claude` — send the
   prompt, confirm the `systemMessage` line renders visibly and the answer
   uses the card; `/clear`, ask again — card re-injects (new session id);
   ask a third time in the same session — no re-injection (dedup).
3. **IDE:** VS Code and Cursor, integrated terminal running `claude`:
   highlight a word from the conversation → keybinding → panel → save →
   prompt with the term → answer uses the card + systemMessage visible; also
   verify the context-menu affordance with
   `terminal.integrated.rightClickBehavior: default`.
4. **Companion matrix:** Windows 11 (Windows Terminal + PowerShell), macOS
   (Terminal.app; note iTerm2/Warp results), Ubuntu GNOME X11, plus one
   Wayland session (GNOME ≥48 or KDE ≥6.3): highlight → (copy where the OS
   requires it) → hotkey → panel → save → injection verified as in (2).
5. **Restart durability:** fully restart terminal/IDE/`claude` → fresh
   session still injects (cards, not sessions, carry the knowledge).
6. **Cross-surface:** one card each from web app, extension, companion,
   `add`, and a hand-edited file → all five inject in one `claude` session.
7. **Uninstall:** `npx prompt-gloss uninstall` → no Gloss settings entries
   remain, cards intact, `claude` prompts run hook-free.
8. **SDK ↔ settings-hook coexistence (§4.5):** in a project where the v1 web
   app runs **and** `npx prompt-gloss init` has installed the file hook, send
   one web-app message with a matching term → the card injects **exactly once**
   (the in-process `SdkInjector` hook), and the settings file hook stays silent
   because `SdkInjector` armed `GLOSS_SKIP_HOOK=1` via `Options.env`. Phase 0
   proved the mechanism manually (2026-07-14, SDK 0.3.207); this is the standing
   regression check.

## How agents run the suite

Prerequisites: Node ≥ 20, pnpm ≥ 9 (`corepack enable`), then:

```bash
pnpm install                     # workspace install
pnpm exec playwright install chromium   # once, for e2e

pnpm lint                        # eslint, all packages
pnpm typecheck                   # tsc -b, strict
pnpm test                        # vitest run, all unit tests
pnpm eval:matcher                # golden-set eval only
pnpm test:e2e                    # playwright (starts server+web in fake-agent mode itself)
pnpm check                       # lint + typecheck + test + eval — run before every commit
```

- `pnpm test:e2e` must be self-contained: the Playwright config's `webServer`
  entry launches the server (with `GLOSS_FAKE_AGENT=1`) and the web app; no
  manual process juggling and **no API key required**.
- Watch mode for TDD: `pnpm test --watch` (Vitest) inside the package you're
  working on.
- A PR is mergeable only when `pnpm check` and `pnpm test:e2e` pass in CI
  (`.github/workflows/ci.yml` runs exactly these commands — keep the workflow
  and this file in sync).

## CI

`.github/workflows/ci.yml`, triggered on push and PR:

1. checkout, setup Node 22 (see the pnpm-11 note in the workflow) + pnpm cache
2. `pnpm install --frozen-lockfile`
3. `pnpm lint`
4. `pnpm typecheck`
5. `pnpm test`
6. `pnpm eval:matcher`
7. `pnpm exec playwright install --with-deps chromium && pnpm test:e2e`

All seven steps are required checks. The eval step is intentionally separate
from `pnpm test` so a matcher regression is identifiable at a glance in the
check list.

When the terminal surfaces land (TERMINAL.md §11), CI gains two jobs, both
required:

- **`hook-contract`** — matrix `[ubuntu-latest, windows-latest, macos-latest]`:
  build the hook bundle, run `pnpm test:hook` + the CLI suite. This is the
  only matrix job (the pipeline it guards is the one that runs on users'
  machines in three OS flavors); everything else stays ubuntu-only.
- **`extension`** — ubuntu with xvfb: `pnpm --filter gloss-terminal test`
  (`@vscode/test-electron`).

The existing seven steps are unchanged — v1 suites and the golden set remain
merge gates forever (TERMINAL.md definition of done, item 6).
