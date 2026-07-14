# Gloss Roadmap

> Gloss any word in your prompt. Claude remembers what it means, forever.

This roadmap is normative: v1 ships **exactly** what is listed under v1. Anything not
listed there is out of scope for v1, even if it seems small. When in doubt, check the
[Non-goals](#non-goals) section — protecting the core interaction from scope creep is
the point of this file.

## v1 — the span-anchored context loop (shipped 2026-07-14)

The single loop that must work end to end:

**highlight a span → save a context card → card auto-injects on matching messages →
survives restart.**

### Included

**Chat (thin plumbing, not the product)**
- Local Node server wrapping one `@anthropic-ai/claude-agent-sdk` session per
  project directory, with streaming responses relayed to the browser.
- Minimal React chat pane: message list, draft input, streaming render,
  session resume across server restarts. No chat bells and whistles
  (no threads, no model picker, no file browser, no git UI — see Non-goals).

**Context cards**
- Card store: one markdown file per card in `.gloss/cards/<slug>.md` with YAML
  frontmatter (`term`, `aliases`, `created`, `updated`, `scope`, `source`).
  Human-editable, git-committable. No database.
- Generated index (`.gloss/index.json`) mapping normalized terms/aliases → card
  files; rebuilt automatically when cards change on disk.
- `scope` field exists in the schema with default `project`. **v1 implements
  project scope only.** The panel's scope toggle renders disabled with a
  "global scope: v2" hint.

**Highlight interaction**
- Text selection in the draft input **or** in any rendered message (user or
  assistant) shows a small floating affordance; clicking it opens a non-modal
  panel that does not steal focus from typing.
- Panel: term (pre-filled from selection, editable), aliases, context body,
  disabled scope toggle, Save; Delete appears when editing an existing card.
- Selecting a span whose term (or alias) already has a card opens that card in
  edit mode.

**Injection**
- On every user message: match message text against terms + aliases
  (exact, case-insensitive, simple stemming — see ARCHITECTURE.md).
- Matched cards injected into the agent's context with clear delimiters, under
  a token budget; most-recently-updated wins on overflow; at most one injection
  per card per session (re-injected if the card was updated mid-session).
- Visible indicator on each user message listing which cards were injected.

**Engineering**
- TypeScript strict everywhere; pnpm workspace monorepo
  (`packages/core`, `packages/server`, `packages/web`).
- TDD for core: store, matcher, and injection-budget tests written before
  implementation (Vitest). Playwright covers the highlight interaction.
- Matcher golden set (message → expected cards) committed and run in CI;
  regressions fail the build.
- GitHub Actions from day one: lint, typecheck, unit, matcher eval, e2e.
- MIT license, complete .gitignore, README with a 60-second GIF demo and an
  honest comparison to mem0 / CloudCLI / cui explaining the span-anchored
  difference.

### v1 definition of done

A user can: run the app against a real project, highlight a span in a draft
prompt or a prior message, save a context card, see it injected on matching
messages (with the indicator), restart everything, and have the same knowledge
apply in a fresh session. CI green, matcher eval passing, LICENSE and
.gitignore in place, README with GIF demo and comparison section.

## v2 — Gloss in the terminal (restructured 2026-07-14)

**What moved and why:** v2 was previously "smarter matching, wider reach"
(embeddings, global cards, suggestions). Those items are now **v3**. The
terminal surfaces displace them because v1 proved the loop but hosts it in a
separate browser app, while the people Gloss is for run Claude Code in IDE
terminals and plain terminals all day. Embeddings improve match quality on an
interaction most users can't reach yet; the terminal feature makes the proven
interaction reachable where users already are. Distribution of a working loop
beats refinement of a niche one — and nothing in v3 gets harder by waiting
(the matcher/store contracts they extend are frozen by the golden set either
way).

Full spec with gate evidence: **TERMINAL.md**. Ships as one arc, phased
(TERMINAL.md §11):

1. **Claude Code hook + install story.** `UserPromptSubmit`/`SessionStart`
   settings hooks (single-file bundle reusing the v1 matcher/budget, verified
   against the live CLI), file-backed session dedup in `.gloss/.state/`,
   `systemMessage` injection indicator, `npx prompt-gloss init` /
   `uninstall` (merge, never clobber; clean removal), `add` / `log` /
   `doctor` CLI, npm publish of the reserved `prompt-gloss` name.
2. **VS Code / Cursor extension.** Highlight in the integrated terminal →
   keybinding or context menu → card panel (shared React panel in a webview
   beside the terminal) → save; provenance from the shell-integration
   stream; Marketplace + OpenVSX.
3. **OS companion.** Global hotkey + per-OS selection capture (X11 PRIMARY /
   macOS synthesized copy / Windows & Wayland copy-then-hotkey) for any
   terminal outside an IDE; panel via the local server; honest per-OS support
   matrix.

v2's definition of done is recorded verbatim in TERMINAL.md §14.

## v3 — smarter matching, wider reach (was v2; unchanged in content)

Ordered by expected value; none of these start before v2's definition of done
is met.

1. **Embedding-based matching.** Semantic similarity between message spans and
   card terms/bodies, so "the analytics dashboard" can match a card anchored to
   "xyz metrics panel". Local embeddings preferred (no card content leaves the
   machine — this is a hard privacy requirement carried over from v1). The
   golden-set eval gains a semantic section; the exact-match eval must keep
   passing (embeddings extend, not replace, v1 matching).
2. **Global cards across projects.** Implement the `scope: global` value:
   global cards live in `~/.gloss/cards/`, are merged into matching at inject
   time (project cards win term collisions), and the panel's scope toggle
   becomes active. (The terminal hook makes this *more* valuable — one
   injection path across every project — which is exactly why it must wait
   for the hook to exist.)
3. **Card suggestions from conversation.** After a session, Gloss proposes
   cards for recurring unexplained terms ("you explained 'xyz' twice — save it
   as a card?"). Suggestions are drafts requiring explicit user confirmation;
   nothing is saved automatically.
4. **Quality-of-life follow-ups** (candidates, not commitments): card browser
   page, import/export, per-card injection stats, compaction-aware
   re-injection, JetBrains terminal plugin (feasibility noted in TERMINAL.md
   §2.3), Electron/Tauri companion packaging (always-on-top panel, tray,
   login item), macOS `AXSelectedText` capture upgrade, Windows UIA capture
   upgrade.

## Non-goals

These are permanently out of scope unless this file is deliberately revised:

- **A general-purpose Claude Code web UI.** CloudCLI (~11k stars), cui,
  agents-ui and others already exist. Gloss's chat pane exists only to host the
  highlight interaction; feature requests that generalize the chat client
  (tabs, git integration, file trees, terminals, multi-agent dashboards) are
  rejected on principle.
- **A generic memory layer.** mem0, supermemory, and MCP memory servers store
  global facts. Gloss's differentiator is anchoring context to highlighted
  spans inside a prompt/response; features that decouple cards from spans
  dissolve the product.
- **Cloud sync / accounts / telemetry.** Cards never leave the user's machine
  except into the local agent session. No hosted service in v1 or v2.
- **A database.** Files + generated index. If files stop scaling, that's a
  v3 conversation with benchmarks, not a v1/v2 drift.
- **Non-Claude agents in v1/v2.** The store/matcher core is agent-agnostic by
  design (see ARCHITECTURE.md), but only Claude integrations ship (Agent SDK
  in the web app, Claude Code hooks in the terminal).
- **A PTY wrapper or TUI fork.** Gloss never spawns, wraps, or proxies the
  Claude Code TUI to capture selections (rejected with rationale in
  TERMINAL.md §13). Selection capture uses the layers that own selection:
  the IDE and the OS.
- **Generic terminal tooling.** No scrollback search, no terminal theming, no
  shell history features, no command palettes. The extension and companion
  exist to capture a highlighted span and open the card panel — the same
  "would this make sense in any terminal tool?" test as the chat-UI non-goal.

## Path A watchpoint

Gloss is a standalone app (Path B) because the CloudCLI plugin API is tab-only —
plugins cannot touch the chat pane, capture selections, or inject context
(verified July 2026; see ARCHITECTURE.md for evidence). If CloudCLI ever ships
chat-pane extension points (selection events, message decorations, prompt
middleware), revisit shipping Gloss as a plugin: `packages/core` is deliberately
UI-free and both paths can share it. Check
[cloudcli.ai/docs/plugin-overview](https://cloudcli.ai/docs/plugin-overview)
when planning any major version.

## Terminal.selection watchpoint

The VS Code extension captures terminal selections via the stable
copy-selection → clipboard round-trip because `Terminal.selection` is still a
**proposed** API (tracking issue
[microsoft/vscode#188173](https://github.com/microsoft/vscode/issues/188173);
evidence in TERMINAL.md §2.3). If it stabilizes, upgrade the capture path to
a direct read (no clipboard involvement) — check the issue when planning any
extension release.
