# Terminal (v2) implementation — session prompts

One fresh Claude Code session per phase; paste the phase's block verbatim as
the opening prompt. Spec of record: **TERMINAL.md** (binding, same authority
as ARCHITECTURE.md). Ordering: **0 → A → B sequential; C and D in parallel
after A** (each in its own worktree — start those sessions with `claude -w`);
**E last**.

House rules baked into every prompt below (kept inline so each block is
self-contained for a fresh session): TDD per TESTING.md, small conventional
commits with a scope via `git commit -F <file>` (the commit-msg validator
rejects inline `-m` without scope), cross-review by the other lane before
merge, Claude holds the final review gate, `pnpm check` green before every
commit. Loop discipline: use `/loop` only with an explicit exit condition —
**never `/ralph-loop`** (it wanders and gets stuck; bounded `/loop` prompts
replace it).

Reusable CI-babysit loop — paste after any `gh pr create` / push:

```text
/loop 4m Run `gh pr checks --watch=false` (or `gh run list --branch <branch> -L 3`)
for the current branch. If any check failed: read the failing job log with
`gh run view --log-failed`, fix the cause, commit (scoped conventional message,
git commit -F), push, and continue looping. If checks are still running, just
report status. STOP the loop when every required check is green (report the
final check list) or after 3 consecutive fix attempts fail on the same job —
in that case stop and summarize the blocker instead of retrying.
```

---

## Phase 0 — contract verifications (Claude lane, ~half-day, solo)

```text
Phase 0 of TERMINAL.md §11 (repo: prompt-gloss, master @ bff27e6 or later).
Read TERMINAL.md fully first — it is binding. This phase is evidence-gathering
only: no feature code. Branch: feat/v2-verifications.

Resolve the four §11 Phase-0 items, each with primary evidence (run the probe
or fetch the source — no answering from memory):

1. Agent SDK parity (§2.1 last row): verify against the installed
   @anthropic-ai/claude-agent-sdk and its current docs that
   hooks.UserPromptSubmit + hookSpecificOutput.additionalContext still work as
   v1 relies on. A GLOSS_FAKE_AGENT=0 one-message smoke against the real SDK
   (v1 web app, real credentials, card-only fact) is the gold standard —
   ARCHITECTURE.md §9 procedure.
2. Double-injection check (§4.5): determine whether a default SDK session
   (no settingSources set, as v1 constructs it) loads project
   .claude/settings.json hooks. Probe: temp project with a marker
   UserPromptSubmit hook that writes a file; run the v1 server against it;
   send one fake-agent-off message; check whether the marker fired.
3. --app always-on-top (§8.3, §12 row 6): launch `msedge --app=<url>` and
   `chrome --app=<url>`; test OS always-on-top affordances; record result.
4. terminalTextSelected spelling (§12 row 7): fetch the context-key definition
   from github.com/microsoft/vscode source (terminalContextKey /
   TerminalContextKeys) and record the exact string.

For each item: update TERMINAL.md §12 (and §4.5/§8.3 text if a finding changes
behavior) in place — outcomes recorded, not just noted in chat. If a finding
CONTRADICTS the spec (e.g. settings hooks DO fire in SDK sessions), stop and
run /council to decide the mitigation with Codex before editing the spec.

Done = all four §12 rows updated with dated evidence, pnpm check green
(docs-only change, still run it), one commit:
docs(terminal): record phase-0 contract verification outcomes
Then push and open a PR (title "v2 phase 0: contract verifications"); the PR
description lists each finding with its evidence. Paste the CI-babysit loop
from docs/phase-prompts.md after pushing.
```

---

## Phase A — core + hook (Claude lane)

```text
/team-on

Phase A of TERMINAL.md §11 (read TERMINAL.md §4, §5, §12 and TESTING.md
"Terminal surfaces" before writing anything — they are binding). Branch:
feat/v2-core-hook. Phase 0's PR (#5) is merged; its §12 outcomes are inputs
here — notably the §4.5 / §12-row-3 SDK-coexistence invariant: default SDK
sessions DO load project .claude/settings.json hooks (verified on SDK
0.3.207), so the hook must honor GLOSS_SKIP_HOOK and SdkInjector must arm it.

Build, strictly TDD (failing test → minimal code → green → commit, per
TESTING.md ground rules — never mock the unit under test):

1. packages/core: InjectionLog.toJSON()/InjectionLog.fromJSON() (pure
   serialization twin of the in-memory log; round-trip + corrupted-input
   tests). CardSource gains optional origin ("web"|"vscode-terminal"|
   "companion"|"cli") — frontmatter round-trip tests updated in the same
   commit. Golden set must not change (matching never reads source).
2. packages/hook (@prompt-gloss/hook): the §4.1 pipeline — stdin JSON →
   match → file-backed dedup (.gloss/.state/sessions/<session_id>.json,
   atomic tmp+rename) → budget pack → 9,500-char clamp → stdout JSON
   (hookSpecificOutput.additionalContext + systemMessage), plus
   --session-start mode (§4.3 framing + §4.2 pruning), GLOSS_SKIP_HOOK=1
   silent exit, injections.jsonl single-appendFileSync logging, catch-all →
   exit 0 (never exit 2). Every TESTING.md "Hook contract tests" bullet is a
   test written BEFORE its code, spawning the REAL built bundle as a child
   process against temp-dir fixtures.
3. esbuild single-file CJS bundle script (target: dist/gloss-hook.cjs,
   format=cjs — gray-matter breaks ESM bundles; wrap entry in async main,
   no top-level await). Assert bundle size < 250 KB and a cold-start smoke
   (< 300 ms) in a test so regressions surface.
4. Wiring: add packages/hook to root tsconfig.json references (tsc -b is an
   explicit list — TERMINAL.md §11), confirm vitest picks up its tests, add
   pnpm test:hook script, and add the 3-OS hook-contract CI job per
   TESTING.md CI section (ubuntu/windows/macos matrix; existing 7 steps
   untouched).
5. packages/server coexistence (TERMINAL.md §4.5 / §12 row 3 — the Phase 0
   finding): SdkInjector.startSession() arms GLOSS_SKIP_HOOK=1 via the SDK
   Options.env, spreading the parent env ({ ...process.env, GLOSS_SKIP_HOOK:
   "1" }) — Options.env REPLACES (not merges) the subprocess env, so the
   spread is required or the subprocess loses PATH/HOME/ANTHROPIC_API_KEY;
   NEVER mutate process.env. Also set settingSources: ["user","project",
   "local"] explicitly (settingSources: [] is rejected — it would strip
   CLAUDE.md). The hook's GLOSS_SKIP_HOOK honoring (item 2, both event modes,
   checked before any parse/state/log write) and this arming are a contract
   pair — build them together. v1 unit/e2e stay green (server.test.ts); add
   the §4.5 skip-switch assertions and the SDK-coexistence check.

Contested implementation calls (e.g. dedup file schema details, clamp
placement) → /council with Codex before committing, not after.

Done = pnpm check + pnpm test:hook green locally; then /break-it on the full
branch diff (Codex adversarial pass — this is the repo's mandatory
cross-review; log its findings and your dispositions in the PR description);
fix what survives; commit with scoped conventional messages via
git commit -F. Then /commit-push-pr (title "v2 phase A: core + hook"), paste
the CI-babysit loop from docs/phase-prompts.md, and confirm the 3-OS matrix
is green — Windows and macOS runners are the point of that job.
```

---

## Phase B — CLI (Claude lane)

```text
/team-on

Phase B of TERMINAL.md §11 (read TERMINAL.md §9, §10, §12 row 11 and
TESTING.md "CLI tests" first — binding). Branch: feat/v2-cli. Requires
Phase A merged (the CLI ships A's hook bundle).

Pre-flight (do this FIRST, it gates the whole phase): run
`npm view prompt-gloss` — must still be E404/free (re-verified free
2026-07-14). If taken, STOP and surface to the user; do not improvise a name.

Build, strictly TDD against temp-dir fixture projects:

1. Root rename: package.json name → @prompt-gloss/monorepo (stays private);
   packages/cli takes the name prompt-gloss with bin "prompt-gloss".
2. packages/cli subcommands per §9:
   - init: .gloss/ scaffold, copy hook bundle to .gloss/hook/gloss-hook.cjs,
     MERGE (parse JSON, never regex) UserPromptSubmit + SessionStart entries
     into .claude/settings.json (default) or settings.local.json (--local)
     or --settings-file <path>; idempotent re-run; --dry-run; writes
     .claude/commands/gloss.md; records project in ~/.gloss/projects.json.
     Every pre-existing settings key byte-preserved — TESTING.md enumerates
     the fixture cases including both settings targets.
   - uninstall: exact mirror per §9.2 (sweeps BOTH settings files, removes
     hook dir, .state, commands/gloss.md; never touches cards).
   - add / log / doctor per §9.3–§9.4.
   - web: launches the v1 server+web against --project.
3. Wiring: root tsconfig references, vitest globs, CLI suite added to the
   3-OS hook-contract CI job (TESTING.md), npm publish DRY-RUN only
   (`npm publish --dry-run` — actual publish is Phase E).

The settings merge/unmerge logic is the highest-blast-radius code in this
phase (it edits user config). After it exists, run /break-it scoped to that
diff immediately — don't wait for phase end. At phase end run /break-it again
on the full branch diff, log findings + dispositions in the PR description,
then /commit-push-pr (title "v2 phase B: prompt-gloss CLI") and paste the
CI-babysit loop from docs/phase-prompts.md.

Manual smoke before requesting merge (real machine, not CI): in a scratch
project run `node packages/cli/dist/... init`, start `claude`, send a prompt
matching a card, confirm injection + the Gloss systemMessage line, then
uninstall and confirm clean removal. Record the transcript in the PR.
```

---

## Phase C — VS Code/Cursor extension (Codex lane, Claude reviews)

Run in its own worktree (`claude -w`); can run concurrently with Phase D.

```text
/team-on

Phase C of TERMINAL.md §11 (read TERMINAL.md §7, §2.3 and TESTING.md
"Extension tests" first — binding; AGENTS.md defines the lanes). Branch:
feat/v2-vscode. Requires Phase A merged. This phase is the CODEX lane: Codex
implements, you (Claude) architect the task split, review every diff, and
hold the final gate. Do not silently reassign Codex's work to yourself — if
Codex output is unusable after two rounds, stop and tell the user.

Wave 1 (sequential — everything else depends on it): write
docs/plans/v2-vscode-plan.md containing this single tagged task, then run
/parallel-team on it:
- @codex Extract the CardPanel React component from packages/web into
  packages/panel-ui (shared package per TERMINAL.md §7.4), consumed by
  packages/web with zero behavior change. Gate: pnpm check AND pnpm test:e2e
  green — the v1 Playwright suite is the acceptance test for the extraction.

Review wave 1 yourself (final gate) before wave 2.

Wave 2 (independent slices — append to the plan file, tag all three @codex,
run /parallel-team so they fan out concurrently):
- @codex packages/vscode scaffold + contributions per §7.1 exactly
  (gloss.captureSelection command; ctrl+alt+g / cmd+alt+g keybinding with
  "terminalFocus && terminalTextSelected"; terminal/context menu entry;
  gloss.cardPanel WebviewView in the panel area, retainContextWhenHidden).
- @codex Capture + provenance per §7.2–§7.3: clipboard save → copySelection →
  read → restore; rolling 32KB shell-integration ring buffer via
  onDidStartTerminalShellExecution/read(); ≤200-char source.message excerpt;
  edit-mode when the span matches an existing card (core matcher in-process,
  no server). Store access via @prompt-gloss/core against the active
  terminal's workspace folder.
- @codex Extension test suite per TESTING.md (@vscode/test-electron:
  activation, contributions asserted from package.json, capture with
  pre-seeded clipboard + clipboard restored, webview postMessage round-trip
  snapshot, save-writes-card-on-disk) + the ubuntu/xvfb CI job.

Interface contracts (hook stdin/stdout, CardSource.origin, panel-ui props,
<gloss-context> format) are pinned — if any Codex task wants to change one,
that's a Claude-lane spec edit, stop and handle it yourself per AGENTS.md.

After each wave: review diffs (final gate), then /break-it on the integrated
branch diff; log findings + dispositions in the PR description. Wiring
checks before PR: root tsconfig references includes packages/vscode and
packages/panel-ui; vsce package builds a .vsix locally. /commit-push-pr
(title "v2 phase C: gloss-terminal extension"), paste the CI-babysit loop
from docs/phase-prompts.md. Flag for the user the two things only a human
can verify (live-smoke matrix, TESTING.md): real terminal-selection capture
in VS Code AND Cursor.
```

---

## Phase D — OS companion (Claude architecture + Codex UX)

Run in its own worktree (`claude -w`); can run concurrently with Phase C.

```text
/team-on

Phase D of TERMINAL.md §11 (read TERMINAL.md §8, §2.4, §3 and TESTING.md
"Companion tests" first — binding). Branch: feat/v2-companion. Requires
Phase A merged (and B for the CLI entry point — if B is unmerged, build
against its branch and note the dependency in the PR).

Architecture first (your lane, before any fan-out): define the
SelectionSource and HotkeyRegistrar interfaces in packages/cli's companion
module, plus the capture flow state machine (hotkey → capture → panel URL →
save → notify). TDD the flow against a scripted SelectionSource — TESTING.md
sanctions faking exactly this boundary and nothing else.

Then write docs/plans/v2-companion-plan.md with these independent slices and
run /parallel-team (the OS adapters are genuinely independent — this is the
parallel-team sweet spot):
- @claude Windows adapter: uiohook-napi hotkey (optionalDependency, graceful
  degrade with a doctor hint if the prebuild fails); clipboard-freshness
  capture per §8.2 (NEVER synthesize Ctrl+C — SIGINT hazard §2.4); the
  stale-clipboard toast copy.
- @claude macOS adapter: uiohook keyTap ⌘C synthesis + pasteboard
  save/restore; permission preflight that names the exact System Settings
  pane (Input Monitoring for CGEventTap — not Accessibility; §2.4).
- @claude Linux adapter: X11 PRIMARY via xclip/xsel shell-out; Wayland
  best-effort per the §8.2 support matrix (wl-paste --primary on wlroots;
  copy-then-hotkey elsewhere) with honest capability detection surfaced in
  doctor.
- @codex Panel plumbing + UX: embedded server startup, app-mode browser
  window launch (--app with default-browser fallback, per §8.3 and the
  Phase-0 always-on-top finding), the project-picker page for first hotkey
  with no project configured (§8.2), save-confirmation OS notification, and
  --install-autostart per-OS entries (Run key / LaunchAgent / XDG autostart).

Contested calls (e.g. clipboard-freshness threshold, Wayland detection
order) → /council with Codex before committing.

Integration: flow tests green with every scripted adapter; wiring (tsconfig
references, vitest globs, companion unit tests in the 3-OS CI job). Then
/break-it on the full branch diff, log findings + dispositions,
/commit-push-pr (title "v2 phase D: OS companion"), paste the CI-babysit
loop from docs/phase-prompts.md. Flag for the user the per-OS live-smoke
items only a human can do (real hotkey + real highlight on each OS,
permission grant flows on macOS).
```

---

## Phase E — release (both lanes)

```text
/team-on

Phase E of TERMINAL.md §11 (read TERMINAL.md §9–§14 and TESTING.md
"Live smoke" first). Branch: feat/v2-release. Requires A–D merged.

Split the work:
1. You (Claude): re-run `npm view prompt-gloss` (must be free — §12 row 11);
   npm publish for prompt-gloss + @prompt-gloss/core + @prompt-gloss/panel-ui
   (publish order: core → panel-ui → cli); verify `npx prompt-gloss init`
   from the PUBLISHED package in a scratch project end-to-end (init → claude
   → injection + systemMessage → uninstall). Ground every "published/works"
   claim in command output.
2. Delegate to Codex (codex:rescue or /parallel-team with @codex tags):
   README rewrite (quick start becomes `npx prompt-gloss init` +
   `npx prompt-gloss web`; new terminal GIFs — one IDE, one companion;
   honest per-OS support matrix from §8.2), CHANGELOG, extension README.
   /break-it is overkill for prose — instead have Codex cross-review your
   publish diffs and you review theirs (repo rule 7).
3. Flag clearly to the user the human-only steps and WAIT for them rather
   than faking them: Marketplace publisher account + vsce publish, OpenVSX
   token + publish, macOS permission-grant walkthrough screenshots, and the
   full TESTING.md live-smoke matrix on real Windows/macOS/Linux (record
   results in the release PR per TESTING.md — it is the release gate; item 1
   of the matrix, the stream-json hook_response check, you can run yourself).

After the release PR is open, paste the CI-babysit loop from
docs/phase-prompts.md. Suggest (do not run) `/code-review ultra` to the user
on the release PR — it is user-triggered and billed. Done = TERMINAL.md §14
definition of done satisfied clause by clause, with evidence linked per
clause in the PR description; anything unmet is listed as unmet — no
hedging.
```

---

## Notes

- `/ralph-loop` is deliberately unused everywhere (known to wander and
  stall). Every `/loop` above has an explicit exit condition and a bounded
  retry budget.
- Phases C and D each open by architecting before fanning out — 
  `/parallel-team` only ever receives independent slices, never
  order-dependent ones (wave-split in C exists exactly because the panel-ui
  extraction is a dependency).
- If any phase discovers the spec is wrong, the fix is a TERMINAL.md edit in
  the same PR (spec-of-record rule), cross-reviewed like code.
