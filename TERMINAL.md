# Gloss in the terminal

Status: **accepted** (planning session, 2026-07-14). This document specs the
terminal surfaces for Gloss: the same highlight → card → auto-injection loop as
the v1 web app, delivered where people actually run Claude Code — IDE
integrated terminals and plain OS terminals. Implementation sessions treat this
as the spec, with the same authority as ARCHITECTURE.md; deviations require
editing this file in the same PR.

Companion documents: ARCHITECTURE.md §10 (component picture), ROADMAP.md
(what this displaces), TESTING.md (hook/extension/companion test plans).

---

## 1. North star and scope

The v1 browser loop, transplanted: the user **highlights a word** — in an
IDE's integrated terminal running `claude`, or in a regular terminal — and
gets: affordance → card panel (term prefilled, aliases, body) → save →
auto-injection into their **real Claude Code session** with a visible
indicator.

Two structural facts make this feasible without touching Claude Code's TUI:

1. **Selection is not owned by Claude Code.** In an IDE terminal the IDE owns
   selection (and exposes it to extensions); in a plain terminal the OS owns
   it (clipboard, X11 PRIMARY, accessibility APIs). Both layers are hookable.
2. **Injection is already solved.** Claude Code (the CLI) supports the same
   `UserPromptSubmit` hook family as the Agent SDK, configured via
   `.claude/settings.json` — verified end-to-end in this planning session
   (§2.1) with the same `additionalContext` mechanism v1 uses.

In scope: the `UserPromptSubmit`/`SessionStart` hook, `npx prompt-gloss init`
install story, a VS Code/Cursor extension, an OS companion for plain
terminals, a CLI bottom rung, per-path provenance and indicators, packaging.
Out of scope (binding, see ROADMAP.md non-goals): forking/wrapping the Claude
Code TUI, a PTY proxy, generic terminal features, anything that decouples
cards from spans.

---

## 2. Gate findings (evidence)

All four gates were resolved with primary evidence before this spec was
written: live probes against the installed CLI on this machine (Claude Code
**2.1.197**, Windows 11, Node 22.18) plus current official docs
(code.claude.com/docs, code.visualstudio.com/api, vendor docs). Where a claim
could not be verified it is marked as an open question (§12) instead of being
assumed.

### 2.1 Claude Code hook contract (verified: docs + live CLI probe)

**Live probe (this machine, 2026-07-14):** a `UserPromptSubmit` hook
configured via a settings file, returning
`hookSpecificOutput.additionalContext` with a fake card ("zorbly is the
internal nightly billing reconciliation job…"), made
`claude -p "What does zorbly mean in this project?"` answer with exactly that
fact. Injection from settings-configured hooks works end-to-end today.

| Contract item | Finding | Evidence |
|---|---|---|
| Settings schema | `hooks.UserPromptSubmit[] → { hooks: [{ type: "command", command, timeout? }] }`. **No matcher support** — fires on every prompt; filtering happens inside the hook. | docs (hooks reference); live probe |
| Stdin payload | JSON: `session_id`, `transcript_path`, `cwd`, `prompt_id` (CLI ≥ 2.1.196), `permission_mode`, `hook_event_name`, `prompt`. | captured verbatim from live probe |
| Context injection | `{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "…"}}` on stdout with exit 0. Plain stdout + exit 0 is *also* added to context (documented special case for UserPromptSubmit/SessionStart) — we use the explicit JSON form only. | docs: "For UserPromptSubmit hooks, use `additionalContext` … injected as a system reminder"; live probe |
| **Indicator** | `systemMessage` (top-level JSON field) is the **documented user-visible line** in the normal transcript ("warning message shown to the user"). `additionalContext` itself is silent; Ctrl+O transcript view shows only that a hook fired. | docs (hooks reference / hooks-guide) |
| Output size cap | `additionalContext`, `systemMessage`, and stdout are **capped at 10,000 characters** (overflow is spilled to a file with a preview). | docs, quoted verbatim by research pass |
| Timeout | Default **30 s for UserPromptSubmit** (600 s for most other events); per-hook `"timeout"` override in seconds. | docs |
| Exit codes | 0 = proceed (JSON parsed); 2 = **blocks/erases the prompt** (stdout JSON ignored, stderr shown) — Gloss must never exit 2; other non-zero = proceed with a visible "hook error" notice. | docs |
| Windows shell | Shell-form commands run under **Git Bash on Windows** (probe: `argv0=/usr/bin/bash`, bash 5.2.12) regardless of the user's interactive shell. `$CLAUDE_PROJECT_DIR` is set (forward slashes). Exec form (`"args": […]`) spawns without any shell — documented escape hatch. | live probe + docs |
| Settings merge | Hooks from user, project, local, plugin levels **merge** (all run); command hooks dedupe by identical command string + args. Live-reloaded by a file watcher on settings edits. | docs; observed live (user-level and `--settings` hooks fired together in probe) |
| `SessionStart` | Exists; stdin has `source`: `startup` \| `resume` \| `clear` \| `compact`; supports `additionalContext` (prepended before first prompt). | docs |
| `SessionEnd` | Exists (`reason`: `clear`/`logout`/`exit`/…); side-effects only, cannot block. Suitable for state cleanup. | docs |
| Agent SDK parity | `hooks.UserPromptSubmit` + `hookSpecificOutput.additionalContext` in the SDK is what v1 ships on (ARCHITECTURE.md §3). **Re-verified Phase 0 (2026-07-14) against installed SDK 0.3.207:** the type defs keep `UserPromptSubmitHookSpecificOutput.additionalContext`, and a real one-message `query()` smoke (v1's construction, `settingSources` omitted) made the model answer with a fact carried **only** by the injected card (`INJECTION_WORKED=true`). | v1 smoke (PR #3); Phase 0 live SDK smoke (§12 row 1) |

### 2.2 Hook cold-start cost (measured on this machine)

The hook runs on **every prompt**, so startup cost was measured, not guessed
(Windows 11, Node 22.18, warm FS cache, 6 runs each, external
`Measure-Command` timing):

| Configuration | Wall time (median) |
|---|---|
| `node -e "0"` (spawn baseline) | ~42 ms |
| Full workload, unbundled workspace import (`dist/` + `gray-matter` via pnpm `node_modules`) | ~170 ms |
| Full workload, **esbuild single-file CJS bundle** (140 KB: core + gray-matter + match + budget over the eval fixture cards) | **~64 ms** |

Conclusion: **ship the hook as a single-file bundle; no daemon required for
latency.** ~64 ms + Git Bash spawn overhead is well inside the 30 s budget and
imperceptible next to model latency. The companion (§8) is a capture device,
not a latency mitigation; converging hook and daemon is *not* needed and is
rejected in §13.

### 2.3 IDE path (verified against VS Code docs/sources, July 2026)

| Question | Finding |
|---|---|
| Read terminal selection directly? | `Terminal.selection` is **still a proposed API** (`vscode.proposed.terminalSelection.d.ts`, tracking issue **#188173**, open since 2023, backlog). Proposed APIs cannot ship in Marketplace extensions. **Do not plan around it**; watchpoint in ROADMAP.md. |
| Stable capture path | Execute built-in command **`workbench.action.terminal.copySelection`**, then **`vscode.env.clipboard.readText()`**, then restore the saved clipboard. This round-trip is the only stable path; there is no `getSelection` command. |
| Gate the affordance | Context keys **`terminalFocus`** (documented) and **`terminalTextSelected`** (**source-verified Phase 0, 2026-07-14**: `TerminalContextKeyStrings.TextSelected = 'terminalTextSelected'` in vscode `src/vs/workbench/contrib/terminal/common/terminalContextKey.ts`). |
| Context menu | `contributes.menus` supports **`terminal/context`** (and `terminal/title/context`). Caveat: when `terminal.integrated.rightClickBehavior` is `copyPaste`/`paste` (a common Windows configuration), right-click never opens the menu — the **keybinding is the primary affordance**, the menu item is secondary. |
| Provenance source | Shell-integration API is stable since **VS Code 1.93**: `window.onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`, `TerminalShellExecution.read()` (async stream of the command's output). No API reads arbitrary scrollback — provenance uses a rolling buffer of recent execution output (§5). |
| Panel hosting | **`WebviewView`** contributed via `contributes.viewsContainers`/`views` can live in the **panel area next to the terminal** (docs: "rendered in the sidebar or panel areas"); `window.createWebviewPanel(…, ViewColumn.Beside)` is the editor-area alternative. `retainContextWhenHidden`, `webview.postMessage`/`onDidReceiveMessage`, `asWebviewUri` all stable — the existing React `CardPanel` rehosts cleanly (§7). |
| Cursor | VS Code fork, supports the standard extension API and `.vsix`; distribute via **OpenVSX** as well as the Marketplace. No terminal-API-specific gaps found (absence-of-evidence; smoke-test in the live matrix). Windsurf: not researched — treat like Cursor, verify in smoke. |
| JetBrains | Feasible (selection via `JBTerminalWidget.SELECTED_TEXT_DATA_KEY` in an `AnAction`; tool window for the panel) but a different API surface and terminal-engine churn (classic vs Reworked widget). **Deferred** — feasibility note only, not in the first implementation (ROADMAP.md). |

### 2.4 Universal path — OS capture mechanisms (verified per-OS)

| OS | Global hotkey | Selection capture | Named permission / caveat |
|---|---|---|---|
| Windows | Win32 `RegisterHotKey` via **`uiohook-napi`** (pure-Node N-API lib; the only maintained non-Electron option — `node-global-key-listener` requires Electron) | **Never synthesize Ctrl+C**: in Windows Terminal/conhost, Ctrl+C without an active selection is **SIGINT** to the running program. Flow: user copies with the terminal's native copy (`Ctrl+Shift+C` in Windows Terminal, `Enter` in conhost, automatic in PuTTY, or `"copyOnSelect": true`), then presses the Gloss hotkey; companion reads the clipboard and checks freshness (§8.2). UI Automation `TextPattern.GetSelection` is a possible upgrade — Windows Terminal support unconfirmed (§12). | None (no OS permission dialogs). One extra keystroke vs. other OSes — documented, not hidden. |
| macOS | `CGEventTap` (via uiohook-napi) → **Input Monitoring** permission; `NSEvent.addGlobalMonitorForEvents` → **Accessibility**. These are *different panes* in System Settings → Privacy & Security — the install docs must name the right one for the mechanism shipped. | Primary: synthesize **⌘C** (safe — SIGINT is Ctrl+C, a different chord on macOS) + read/restore `NSPasteboard`. Upgrade path: `AXSelectedText` (works in Terminal.app and iTerm2 — iTerm2 implements `accessibilitySelectedText`; **Warp has no AX tree**) via a small native helper — deferred (§12). | Accessibility and/or Input Monitoring prompts; permission grants bind to the signed binary (Node's signature covers the daemon; a packaged app would need notarization — packaging note §10). |
| Linux / X11 | `XGrabKey` via uiohook-napi | **X11 PRIMARY selection** — highlighted text is already in PRIMARY with no keystroke at all; read via `xclip -o -selection primary` / `xsel -p` (shell-out; the npm `xsel` wrapper is unmaintained). Highest-fidelity path of any OS. | None. |
| Linux / Wayland | `org.freedesktop.portal.GlobalShortcuts` — implemented on **KDE (≥6.3)** and **GNOME ≥48**; wlroots DEs need their own portal (`xdg-desktop-portal-wlr`/`-hyprland`), inconsistent | `wl-paste --primary` works cleanly on compositors with the wlroots `data-control` protocol (Sway, Hyprland, River); **unconfirmed on Mutter/KWin** (§12). Fallback: copy-then-hotkey (as Windows). | Best-effort tier with an explicit support matrix (§8.2); degradations documented, and the CLI rung (§9.3) always works. |

---

## 3. The capture ladder

Fidelity-ranked. Every environment gets the best rung it supports; a rung
never blocks a lower rung (all rungs write through the same store and the same
hook injects regardless of where a card came from).

| Rung | Environment | Affordance | Fidelity |
|---|---|---|---|
| **1. IDE extension** (§7) | VS Code / Cursor integrated terminal — the "99% in IDE terminal" case | Highlight → keybinding (primary) or terminal context menu → webview panel beside the terminal | Full v1 loop: true selection capture, in-IDE panel, shell-integration provenance, native save feedback + hook `systemMessage` indicator |
| **2. OS companion** (§8) | Any terminal app, no IDE | Highlight → global hotkey → panel window opens with term prefilled | Same loop; capture mechanism varies by OS (§2.4): X11 = pure highlight; macOS = highlight (synthesized copy); Windows/Wayland = copy-then-hotkey |
| **3. CLI + slash command** (§9.3) | Headless, SSH, CI, unsupported Wayland DEs, or nothing installed beyond the hook | `prompt-gloss add` / `/gloss` in Claude Code itself | Card creation without highlight capture. Injection + indicator still fully work. Explicitly the bottom rung, never the primary answer. |

Chosen primary per environment:

- **VS Code / Cursor / (Windsurf, verify)**: rung 1.
- **Plain terminal on Windows / macOS / Linux-X11**: rung 2.
- **Linux-Wayland**: rung 2 where the support matrix allows (GNOME ≥48, KDE
  ≥6.3, wlroots+portal); otherwise rung 3.
- **SSH/headless**: rung 3 (cards still live in the project's `.gloss/` on
  the machine where `claude` runs).

---

## 4. Hook architecture (shared by every rung)

One new workspace package, `packages/hook` (`@prompt-gloss/hook`), owns the
Claude Code-side pipeline. It reuses `@prompt-gloss/core` — the matcher and
budget are **never forked** (CLAUDE.md guardrail). Terminology: "hook" in
this spec always means a **Claude Code event hook**; it is unrelated to the
repo's own git commit hooks (`scripts/install-hooks.mjs`).

### 4.1 Data flow, per user prompt

```
claude (any terminal) ── UserPromptSubmit ──> Git Bash/sh: node .gloss/hook/gloss-hook.cjs
                                                     │  stdin: {session_id, prompt, prompt_id, cwd, …}
                                                     ▼
                                    ┌─ read .gloss/config.json (optional knobs)
                                    ├─ CardStore.buildIndex()  (picks up hand edits; ~10 ms)
                                    ├─ matchMessage(prompt, index)          [core]
                                    ├─ load .gloss/.state/sessions/<session_id>.json  (dedup log)
                                    ├─ packInjection(cards, log, budget)    [core]
                                    ├─ persist dedup log + append .gloss/.state/injections.jsonl
                                    ▼
                        stdout JSON, exit 0:
                        { "hookSpecificOutput": { "hookEventName": "UserPromptSubmit",
                                                  "additionalContext": "<gloss-context>…" },
                          "systemMessage": "Gloss: injected 2 cards (xyz, billing-engine)" }
```

- **Injection semantics are v1's, unchanged**: same matcher rules, same
  budget packing (`updated`-desc, greedy skip, per-card cap + truncation
  marker), same `<gloss-context>` wrapper (snapshot-locked in TESTING.md),
  same once-per-card-per-session dedup with re-injection on `updated` bump.
- **Budget vs. the 10,000-char cap**: the token budget (default 2,000 tokens
  ≈ 8,000 chars) already fits under the cap; the hook additionally
  hard-clamps the final payload at **9,500 chars** (truncating the last card
  with the existing `…[truncated by Gloss]` marker) so a raised
  `GLOSS_INJECT_BUDGET` can never trip Claude Code's overflow-to-file
  behavior. `systemMessage` is short by construction.
  *Pinned implementation (Phase A, council with Codex 2026-07-14):* the clamp
  is applied as a **token-budget ceiling**, not a string slice — both the
  budget and the per-card cap are capped at ⌊(9500 − 300)/4⌋ = 2,300 tokens
  before packing, which (with `estimateTokens = ceil(chars/4)`) makes a
  >9,500-char payload unreachable while keeping card markup well-formed and
  `injectedSlugs`/dedup/`systemMessage` truthful. A defensive length check
  remains as a drop-everything backstop.
  *Pinned config knobs (Phase A):* `.gloss/config.json` may carry
  `{ "injectBudget": <tokens>, "cardCap": <tokens> }`; the
  `GLOSS_INJECT_BUDGET` / `GLOSS_CARD_CAP` environment variables take
  precedence over the file.
- **No matcher support in the event** (§2.1): the hook always runs and
  decides internally; no-match → print nothing, exit 0 (silent, no
  systemMessage — "no match, no noise", as v1).

### 4.2 Session state — dedup without a server

Hooks are stateless per prompt, so the v1 in-memory `InjectionLog` gains a
file-backed twin:

- `packages/core`: `InjectionLog` gets `toJSON()` / `InjectionLog.fromJSON()`
  (pure, TDD'd — the algorithm object stays the unit under test).
- `.gloss/.state/sessions/<session_id>.json`:
  `{ "version": 1, "updatedAt": "…", "injected": { "<slug>": "<updated ISO>" } }`.
  Written atomically (temp file + rename). Keyed by the `session_id` from the
  hook payload, so parallel Claude sessions on one project never share or
  clobber dedup state. `.gloss/.state/` already self-gitignores
  (ARCHITECTURE.md §4) — nothing new leaks into commits.
- `.gloss/.state/injections.jsonl`: append-only log,
  `{"ts": "…", "sessionId": "…", "promptId": "…", "slugs": ["…"]}` per
  injection — powers `prompt-gloss log` (§9.3) and debugging. This file IS
  shared across concurrent sessions: each record is written as a **single
  `appendFileSync` call with `O_APPEND`** and stays well under the atomic
  small-write threshold, and readers (`log`, `doctor`) skip malformed lines —
  so a torn line can only ever cost one log entry, never corrupt state
  (dedup correctness never depends on this file). Concurrent-append is a
  hook-contract test case (TESTING.md).
- Cleanup: the `SessionStart` hook prunes `sessions/*.json` older than 30
  days and truncates `injections.jsonl` beyond 1,000 lines. (`SessionEnd`
  exists but is not relied on — crashes would leak state; prune-on-start is
  self-healing.)

### 4.3 SessionStart framing

v1 tells the model what `<gloss-context>` means via a one-sentence
`systemPrompt` append (ARCHITECTURE.md §3). The CLI cannot touch the system
prompt, so `init` also registers the same bundle for `SessionStart`
(`--session-start` flag), which returns the framing sentence as
`additionalContext` once per session — same content, hook-shaped delivery —
and performs the §4.2 pruning.

### 4.4 Packaging & failure policy

- Built by esbuild to **one CJS file** (`gloss-hook.cjs`, ~140 KB, ~64 ms —
  §2.2) with zero runtime dependencies. `npx prompt-gloss init` copies it to
  `.gloss/hook/gloss-hook.cjs` in the project (§9.1) — hermetic: no
  `node_modules`, no pnpm resolution, survives package updates until the user
  re-runs `init`, and the file itself is committable so teammates who pull the
  repo need only run `init` (or nothing, if `.claude/settings.json` is
  committed too).
- Settings command (shell form, POSIX — runs under Git Bash on Windows,
  §2.1): `node "$CLAUDE_PROJECT_DIR/.gloss/hook/gloss-hook.cjs"`. The
  documented Git Bash profile-garbage caveat (a `BASH_ENV`/profile `echo`
  corrupting hook JSON) gets a troubleshooting entry; exec form
  (`"command": "node", "args": ["…"]`) is the documented escape hatch if a
  user's profile is unfixable.
- **The hook must never break the user's prompt.** Catch-all error handler:
  any failure → log to `.gloss/.state/hook-errors.log`, print nothing, exit
  0. Exit code 2 is forbidden (it erases the user's prompt, §2.1). Timeouts:
  the 30 s default is ~450× the measured cost; no override needed.

### 4.5 Coexistence with the v1 web app

The web app's `SdkInjector` keeps its in-process `UserPromptSubmit` injection
hook (unchanged — v1 stays green). **Phase 0 finding (2026-07-14, §12 row 3):**
against the installed Agent SDK **0.3.207**, a session that omits
`settingSources` — exactly how `SdkInjector.startSession()` builds its options
(`packages/server/src/sdk-injector.ts`) — **does** load user/project/local
filesystem settings and run their hooks. Evidence: the SDK type def states
"When omitted, all sources are loaded (matches CLI defaults). Pass `[]` to
disable filesystem settings"; and a live one-message `query()` probe with a
project `.claude/settings.json` `UserPromptSubmit` marker hook saw that marker
hook fire (`MARKER_FIRED=true`). So once `npx prompt-gloss init` (Phase B)
writes the Gloss file hook into `.claude/settings.json`, an SDK session in that
project would fire **both** the in-process hook and the file hook — injecting
the same cards twice and producing terminal-hook state
(`.gloss/.state/sessions/…`) and a `systemMessage` side effect.

Coexistence is therefore **mandatory and unconditional** (decided by council
with Codex, 2026-07-14 — `settingSources: []` isolation was considered and
rejected):

- **`SdkInjector` scopes `GLOSS_SKIP_HOOK=1` through the SDK `Options.env`**,
  spreading the parent env: `env: { ...process.env, GLOSS_SKIP_HOOK: "1" }`.
  `Options.env` *replaces* (does not merge) the subprocess environment, so the
  spread is required or the subprocess loses inherited `PATH` / `HOME` /
  `ANTHROPIC_API_KEY` (SDK type-def doc). It must **never** mutate
  `process.env` (that would leak the flag to unrelated child processes and any
  other SDK session the server spawns). Propagation + suppression are
  Phase-0-verified: with `GLOSS_SKIP_HOOK=1` on the session env the marker hook
  ran but honored the flag and wrote nothing (`MARKER_SKIPPED=true`,
  `MARKER_FIRED=false`) while the in-process injection still worked
  (`INJECTION_WORKED=true`).
- **The file-hook bundle checks `GLOSS_SKIP_HOOK=1` first** — before parsing
  stdin, matching, or any state/log write — and exits 0 with empty stdout, for
  **both** `UserPromptSubmit` and `SessionStart` modes (so the web app gets
  neither duplicate cards nor duplicate `SessionStart` framing). This invariant
  is required from the **first shipped bundle** (the `packages/hook`/`cli`
  packages do not exist yet — this is a spec commitment) and is pinned by the
  built-bundle hook-contract suite (TESTING.md) plus an SDK-coexistence smoke.
- **`SdkInjector` keeps filesystem settings enabled** — preferably explicitly,
  `settingSources: ["user", "project", "local"]` — so the web-app agent keeps
  loading project `CLAUDE.md` and user/project/local settings (current v1
  behavior). **`settingSources: []` is rejected**: it would strip `CLAUDE.md`
  and every unrelated user/project/local setting and hook to solve Gloss's own
  duplicate hook — the wrong trade. (Descendant caveat: `Options.env` reaches
  the subprocess and its children, so a nested `claude` launched by the SDK
  process also suppresses its Gloss file hook — an accepted minor limit.)

Longer-term convergence (SdkInjector adopting the file-backed dedup log) is a
v-next cleanup, not required now.

---

## 5. Provenance — what `source` records per path

Terminal selections have no message DOM to excerpt, so each rung records the
best provenance it has. `CardSource` (core `types.ts`) gains one **optional**
field — a backward-compatible schema extension (absent field = v1 web card;
frontmatter round-trip tests updated in the same PR):

```yaml
source:
  span: "xyz"                 # unchanged: the highlighted text
  message: "…"                # unchanged: ≤200-char surrounding excerpt (best available)
  origin: vscode-terminal     # NEW, optional: web | vscode-terminal | companion | cli
```

| Rung | `span` | `message` (≤200 chars) |
|---|---|---|
| Web (v1) | selection | message excerpt (unchanged) |
| IDE extension | terminal selection (via copy round-trip) | the line(s) containing the span from the extension's rolling shell-integration buffer (§7.3); empty string if shell integration is inactive |
| Companion | captured selection/clipboard text | the full captured block itself, truncated to 200 chars (the selection often *is* the context line) |
| CLI | the `term` argument | `"(created via prompt-gloss add)"` |

Matching never reads `source` (v1 invariant) — provenance is for humans and
for the panel's edit affordance only. The privacy note in README extends: IDE
and companion excerpts may quote terminal output; the existing "committing
`.gloss/` commits excerpts" warning covers it.

---

## 6. Indicator per path (trust rule: nothing happens silently)

| Path | Injection indicator | Card-saved feedback |
|---|---|---|
| Web app (v1) | chip row on the message (unchanged) | panel closes, card list updates |
| **Every terminal path** | **`systemMessage`**: `Gloss: injected 2 cards (xyz, billing-engine)` — the documented user-visible transcript line (§2.1), emitted by the hook itself, so it works identically in IDE terminals, plain terminals, and SSH | — |
| IDE extension | systemMessage (above) | VS Code toast + status-bar flash on save |
| Companion | systemMessage (above) | OS notification on save ("Card 'xyz' saved to .gloss/") |
| CLI / headless | systemMessage (above) + `prompt-gloss log` (§9.3 — tails `injections.jsonl`: when, which session, which cards) | command output |

Degradations are documented, not hidden: if a user runs `claude` with hooks
disabled (`--bare`, `disableAllHooks`), nothing injects and nothing pretends
to. `prompt-gloss doctor` (§9.4) diagnoses exactly this.

The v1 bootstrap idea of "model acknowledges cards by name" as a substitute
indicator is **dropped**: `systemMessage` is deterministic, documented, and
does not depend on model compliance.

---

## 7. Surface 1: the VS Code / Cursor extension (`packages/vscode`)

### 7.1 Contributions (exact)

- Command `gloss.captureSelection` ("Gloss: attach context to selection").
- Keybinding: `ctrl+alt+g` / `cmd+alt+g` (chosen to avoid the taken
  `ctrl+shift+g` SCM default), `"when": "terminalFocus && terminalTextSelected"`.
- Menu: `terminal/context` entry, same command, same `when` — secondary
  affordance only (§2.3 rightClickBehavior caveat; the README shows the
  keybinding first).
- View: `gloss.cardPanel` — a `WebviewView` in the **panel area** (terminal's
  home), `retainContextWhenHidden: true`.

### 7.2 Capture sequence

1. Save `env.clipboard.readText()` (the user's clipboard).
2. `commands.executeCommand("workbench.action.terminal.copySelection")`.
3. Read the clipboard → `span`; **restore** the saved clipboard.
4. Look up `span` in the rolling provenance buffer (§7.3) → `message` excerpt.
5. Reveal the card panel, prefilled. If the span matches an existing card
   (same match semantics as v1's `POST /api/match`, but via core in-process),
   open in edit mode.

The clipboard round-trip is the stable-API cost of rung 1 (§2.3). It is
save/restored within milliseconds and documented. When `Terminal.selection`
(proposed) ships stable, capture upgrades to a direct read — ROADMAP.md
watchpoint.

### 7.3 Provenance buffer

The extension subscribes to `window.onDidStartTerminalShellExecution` and
streams `TerminalShellExecution.read()` into a per-terminal ring buffer
(last 32 KB). On capture, the most recent buffer chunk containing the span
supplies the ≤200-char `source.message` excerpt. Requires shell integration
(on by default in VS Code's default profiles); when inactive, `message` is
empty and the card is still saved — degrade, don't block.

### 7.4 Store access and panel reuse

The extension host is Node: it uses `@prompt-gloss/core` **directly**
(CardStore against `${workspaceFolder}/.gloss/`) — no server process, no
HTTP. The React `CardPanel` component is extracted from `packages/web` into a
small shared package (`packages/panel-ui`) consumed by: the web app
(unchanged behavior — v1 e2e must stay green), the extension webview (bundled
via esbuild, loaded with `asWebviewUri`, wired over
`postMessage`/`onDidReceiveMessage`), and the companion's panel page (§8.3).
Multi-root workspaces: the store targets the workspace folder of the active
terminal's `cwd`.

### 7.5 Distribution

VS Code Marketplace + **OpenVSX** (Cursor default registry). Extension ID
`prompt-gloss.gloss-terminal`; publisher account creation is an
implementation-phase prerequisite (§11 phase E). The extension bundles core —
it must work with zero npm installs in the project (only `init` for the hook).

---

## 8. Surface 2: the OS companion (`prompt-gloss companion`)

### 8.1 Runtime decision

**Pure Node daemon inside the published CLI package** — not Electron, not
Tauri (v-terminal.1). Rationale: it ships free inside `npx prompt-gloss`
(no second installer, no 100 MB+ Chromium, no Rust toolchain in the repo),
`uiohook-napi` is the one maintained pure-Node global-hotkey lib (§2.4), and
the panel can be a browser window against the already-existing local server.
Electron's conveniences (`setLoginItemSettings`, tray, always-on-top panel)
are real but are polish, not loop-critical — revisit as a v-next packaging
upgrade (§13). `uiohook-napi` is an `optionalDependency`: if its prebuild
fails, `companion` explains and the CLI rung still works.

### 8.2 Behavior

- `prompt-gloss companion` (foreground; `--install-autostart` writes the
  OS-native autostart entry — Windows Run key, macOS LaunchAgent, XDG
  autostart — documented per OS, one flag).
- Registers the global hotkey (default `ctrl+alt+j` / `cmd+alt+j` —
  deliberately distinct from the extension's `ctrl+alt+g` so installing both
  never double-fires inside an IDE terminal; configurable in
  `~/.gloss/config.json`).
- On hotkey, capture by OS (§2.4 evidence):
  - **X11**: read PRIMARY (`xclip -o -selection primary`) — done.
  - **macOS**: snapshot pasteboard → synthesize ⌘C (uiohook `keyTap`) →
    read → restore. Requires the named permission(s); `companion` preflights
    and prints which System Settings pane to open.
  - **Windows**: read the clipboard **only if it changed since the last
    hotkey press or within the last 15 s** (freshness check via content
    snapshot); otherwise show a toast: "Copy your selection first
    (Ctrl+Shift+C in Windows Terminal), then press the hotkey again." Never
    synthesize Ctrl+C (SIGINT hazard, §2.4). Docs recommend
    `"copyOnSelect": true` for a one-step flow.
  - **Wayland**: portal-registered shortcut where available (GNOME ≥48,
    KDE ≥6.3); capture via `wl-paste --primary` on wlroots compositors,
    else the Windows-style copy-then-hotkey flow. Support matrix in README;
    unsupported combos → clear message pointing at the CLI rung.
- The user picks the target project once (`companion --project <dir>`, or —
  when the first hotkey fires with no project configured — the panel window
  (§8.3) opens on a project-picker page listing the recently-`init`ed
  projects recorded in `~/.gloss/projects.json`; no separate native UI);
  cards are written to that project's `.gloss/`.

### 8.3 Panel

The companion embeds the existing Fastify server (`@prompt-gloss/server`,
127.0.0.1, fake-agent-independent card routes) and opens the shared panel UI
(§7.4) at `http://127.0.0.1:<port>/panel?span=…&origin=companion` in an
**app-mode browser window** (`chrome/msedge --app=URL`, falling back to the
default browser). Always-on-top for app-mode windows was **Phase-0-tested
(2026-07-14, §12 row 6) and found unavailable**: both `chrome --app` and
`msedge --app` windows open **without** `WS_EX_TOPMOST` (ex-style `0x00200100`),
there is no Chromium switch for it, and Windows 11 has no built-in per-window
always-on-top affordance. The window opens focused, which satisfies the loop; a
floating always-on-top native window is the v-next Electron/Tauri upgrade. Save
feedback: OS notification (§6).

---

## 9. Install story: one command in, one command out

### 9.1 `npx prompt-gloss init` (in the user's project)

1. Creates `.gloss/` scaffolding if absent (cards/, `.state/` with
   self-gitignore — existing store behavior).
2. Copies the current hook bundle to `.gloss/hook/gloss-hook.cjs`
   (overwrites on re-run: re-init = upgrade).
3. **Merges** into `.claude/settings.json` — the explicit default target;
   `--local` targets `.claude/settings.local.json` instead (personal,
   gitignored install), `--settings-file <path>` any other layout. JSON is
   parsed, never regex-edited; every other key is preserved verbatim:
   - `hooks.UserPromptSubmit[].hooks[]` += `{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.gloss/hook/gloss-hook.cjs\"" }`
   - `hooks.SessionStart[].hooks[]` += the same command + ` --session-start`.
   - Idempotent: entries identified by the `.gloss/hook/gloss-hook.cjs`
     substring; present → not duplicated (Claude Code also dedupes identical
     commands, §2.1 — belt and suspenders).
4. Records the project in `~/.gloss/projects.json` (for the companion picker).
5. Prints what changed + the 30-second try-it snippet.
   `--dry-run` prints the diff without writing; `--settings-file <path>`
   supports non-default layouts.

Claude Code live-reloads settings changes (§2.1), so a running `claude`
session picks the hook up without restart.

### 9.2 `npx prompt-gloss uninstall`

Removes exactly the settings entries matching the `.gloss/hook/` substring
(both events) from **both** `.claude/settings.json` and
`.claude/settings.local.json` (hooks merge across levels, §2.1 — uninstall
must sweep every file `init` can target), deletes `.gloss/hook/` and
`.gloss/.state/`, removes `.claude/commands/gloss.md` (the `/gloss` command
`init` wrote, §9.3), and **never touches `.gloss/cards/`** or any non-Gloss
settings key. Prints what it removed. One command, clean exit — the mirror
image of `init`.

### 9.3 Bottom rung: CLI + slash command

- `prompt-gloss add "<term>" [--alias a --alias b] [--body "<text>" | --body-file <f> | -]`
  → writes a card via core (slug/dedup/frontmatter identical to every other
  surface), `origin: cli`.
- `prompt-gloss log [-n 20]` → human-readable tail of
  `.gloss/.state/injections.jsonl`.
- `init` also writes `.claude/commands/gloss.md` — a `/gloss` command so the
  user can create a card without leaving Claude Code (`/gloss xyz: the
  metrics panel…` → Claude runs `npx prompt-gloss add` with those arguments).
  Still span-motivated (the user names the term they just saw); explicitly
  the headless/SSH rung.

### 9.4 `npx prompt-gloss doctor`

Checks: hook file present + version, settings entries present, Node on PATH
for the hook's shell, `.state` writable, last hook error (if any), companion
capture support for this OS/session — and prints fixes. (The v1 web app
gains nothing; this is terminal-surface tooling.)

---

## 10. Packaging map

| Artifact | Package | Registry | Contents |
|---|---|---|---|
| `prompt-gloss` (CLI) | `packages/cli` (new; takes the npm name — `npm view prompt-gloss` → 404, still free, re-verified 2026-07-14; root workspace package renames to `@prompt-gloss/monorepo`, private, in the same PR) | npm | `init`/`uninstall`/`add`/`log`/`doctor`/`companion`/`web` subcommands; ships the prebuilt hook bundle; depends on core + server; `uiohook-napi` as optionalDependency |
| Hook bundle | built from `packages/hook` | inside the CLI package (and copied into projects by `init`) | single CJS file, zero deps |
| `gloss-terminal` extension | `packages/vscode` (new) | VS Code Marketplace + OpenVSX | bundled core + panel-ui webview |
| `@prompt-gloss/core`, `@prompt-gloss/panel-ui` | existing/new workspace packages | npm (public, semver-locked by the CLI/extension) | unchanged crown jewels; shared React panel |
| `prompt-gloss web` | existing `packages/server` + `packages/web` | via the CLI | the v1 web app, now `npx`-runnable (replaces the clone-and-pnpm-dev quick start) |

macOS note: the pure-Node companion inherits Node's code signature for
permission grants; if/when a packaged `.app` ships (v-next), it needs Developer
ID signing + notarization — recorded so nobody discovers it in a release week.

---

## 11. Implementation phases (for the executing sessions)

Each phase lands PR-sized, TDD-first, `pnpm check` green, cross-reviewed per
CLAUDE.md. Lanes per CLAUDE.md/AGENTS.md division of labor.

- **Phase 0 — contract verifications** (Claude lane, half-day) — **DONE
  2026-07-14 (branch `feat/v2-verifications`); outcomes in §12 rows 1, 3, 6,
  7:** re-verified Agent SDK `additionalContext` against installed SDK 0.3.207
  (§2.1 last row); **determined** whether default SDK sessions load settings
  hooks (§4.5) — they **do** (all sources load when `settingSources` is
  omitted), so the `GLOSS_SKIP_HOOK` coexistence switch is now mandatory and
  `Options.env`-scoped rather than conditional; ran the `--app` always-on-top
  test (§8.3) — not available; source-verified the `terminalTextSelected`
  spelling against the VS Code source.
- **Phase A — core + hook** (Claude lane): `InjectionLog`
  `toJSON`/`fromJSON` (core, TDD); `CardSource.origin` (core, TDD);
  `packages/hook` with the §4 pipeline incl. `GLOSS_SKIP_HOOK` (TDD via the
  TESTING.md hook-contract layer); esbuild bundle script; hook-contract tests
  on the 3-OS CI matrix; and the **§4.5 coexistence change to
  `packages/server`'s `SdkInjector`** — arm `GLOSS_SKIP_HOOK=1` via
  `Options.env` (`{ ...process.env, … }`, never mutating `process.env`) and set
  `settingSources: ["user","project","local"]` explicitly. The hook's
  skip-switch honoring (both event modes) and the injector's arming are a
  contract pair — build them together; v1 e2e stays green.
- **Phase B — CLI** (Claude lane): `packages/cli` with
  `init`/`uninstall`/`add`/`log`/`doctor`; settings merge/unmerge TDD'd
  against fixture settings files (merge-never-clobber, `settings.json` and
  `settings.local.json` cases); re-run `npm view prompt-gloss` immediately
  before the root-package rename + publish dry-run (name re-verified free
  2026-07-14, §10 — but verify again at publish time).
- **Every phase adding a package**: add it to the root `tsconfig.json`
  `references` array (`tsc -b` is an explicit list, not a glob — a missed
  entry means `pnpm typecheck` silently skips the package) and confirm the
  vitest project globs pick up its tests.
- **Phase C — extension** (Codex lane, Claude reviews): `packages/panel-ui`
  extraction (web e2e stays green — gate); `packages/vscode` per §7;
  extension-harness tests per TESTING.md.
- **Phase D — companion** (Claude architecture + Codex UX): capture adapters
  behind a `SelectionSource` interface per OS; flow tests with scripted
  sources; per-OS manual smoke.
- **Phase E — release**: Marketplace/OpenVSX publisher setup, README/GIFs
  (IDE + companion), live-smoke matrix (TESTING.md), npm publish,
  `prompt-gloss web` quick-start swap.

Phases A→B are sequential; C and D parallelize after A. Definition of done:
§14 verbatim.

---

## 12. Risks and open questions

| # | Risk / open question | Handling |
|---|---|---|
| 1 | Hook contract drift (fields, caps, timeout defaults are 2.1.x behavior) | Hook-contract tests pin the shapes; live smoke before release and after CLI major bumps (TESTING.md); §2.1 table is the reference of record. **Phase 0 (2026-07-14) — RESOLVED for the injection contract:** against installed SDK **0.3.207**, `UserPromptSubmitHookInput.prompt` + `UserPromptSubmitHookSpecificOutput.additionalContext` are intact in the type defs and a real one-message `query()` smoke injected a card-only fact into the model's answer (`INJECTION_WORKED=true`). |
| 2 | `systemMessage` rendering could change (docs call it a "warning message") | It's cosmetic-critical only; live smoke checks it; fallback is `prompt-gloss log` (already shipped) |
| 3 | SDK sessions load the installed Gloss settings hook → **double-injection** (§4.5) | **Phase 0 (2026-07-14) — CONFIRMED the leak:** with `settingSources` omitted (v1's construction) a project `.claude/settings.json` `UserPromptSubmit` hook fired inside a real SDK `query()` (`MARKER_FIRED=true`; SDK doc: "when omitted, all sources are loaded"). **Resolved invariant (council with Codex):** `SdkInjector` always scopes `GLOSS_SKIP_HOOK=1` via `Options.env` (`{ ...process.env, GLOSS_SKIP_HOOK:"1" }`, never mutating `process.env`) and keeps `settingSources: ["user","project","local"]`; the file hook must exit before any stdout/state/log write for **both** `UserPromptSubmit` and `SessionStart`. Propagation + suppression Phase-0-verified (`MARKER_SKIPPED=true`, in-process injection unaffected). `settingSources: []` explicitly rejected (would also strip `CLAUDE.md`). Built-bundle contract tests + an SDK-coexistence smoke cover the boundary (TESTING.md). |
| 4 | Windows Terminal UIA `TextPattern` selection support unconfirmed | Not load-bearing (copy-then-hotkey ships regardless); investigate as a fidelity upgrade |
| 5 | Wayland PRIMARY on Mutter/KWin unconfirmed; portal coverage uneven | Support matrix + copy-then-hotkey fallback + CLI rung; re-test per distro cycle |
| 6 | `--app` companion-panel window always-on-top (§8.3) | **Phase 0 (2026-07-14) — RESOLVED, not available:** `chrome --app` and `msedge --app` both open without `WS_EX_TOPMOST` (ex-style `0x00200100`); no Chromium switch exists and Windows 11 has no built-in per-window always-on-top affordance. The loop works with the focused normal window; a floating always-on-top window stays the v-next Electron/Tauri upgrade (§8.3). |
| 7 | `terminalTextSelected` context-key spelling (§7.1 `when` clause) | **Phase 0 (2026-07-14) — RESOLVED, spelling confirmed exact:** vscode source `src/vs/workbench/contrib/terminal/common/terminalContextKey.ts` defines `TerminalContextKeyStrings.TextSelected = 'terminalTextSelected'` (and `TerminalContextKeys.textSelected` binds that key). §7.1's `when` clause needs no change. |
| 8 | Marketplace/OpenVSX publisher setup lead time | Phase E prerequisite, start early |
| 9 | uiohook-napi maintenance (forks exist) | Interface-isolated (`SelectionSource`/`Hotkey-`); swap cost is one adapter |
| 10 | Clipboard round-trip races (user copies during the 2-step capture) | Save/restore window is milliseconds; documented; direct-selection upgrade path via #188173 |
| 11 | npm name `prompt-gloss` squatted between planning and publish (free as of 2026-07-14, §10) | Phase B re-verifies `npm view prompt-gloss` immediately before the rename/publish |

## 13. Rejected alternatives (recorded so they stay rejected)

- **PTY wrapper / TUI overlay** (`gloss claude` spawning claude in a pty and
  drawing selection UI): owns the user's terminal, breaks TUI rendering and
  resize/mouse passthrough, fights every terminal emulator's quirks — and
  contradicts the §1 insight that selection is already owned by layers we can
  hook cleanly. Permanently out (ROADMAP.md non-goals).
- **Daemon-computed injection (hook queries companion over HTTP)**: measured
  bundle cost (~64 ms) removes the motivation; a daemon dependency would make
  the *injection* path fail when the optional companion isn't running —
  injection must work with nothing installed but `init`.
- **Proposed VS Code API** (`Terminal.selection`): can't ship to the
  Marketplace (§2.3). Watchpoint, not a plan.
- **Electron companion in v-terminal.1**: 100 MB+ runtime for a hotkey +
  clipboard daemon; polish path later, loop path now (§8.1).
- **`SessionEnd`-based state cleanup**: leaks on crash; prune-on-start is
  self-healing (§4.2).

## 14. Definition of done (recorded verbatim from the planning brief)

Reading note for clause (5): "CI-verified where possible" means the
**injection pipeline** (hook-contract + CLI suites on the 3-OS matrix,
TESTING.md). The **capture** mechanisms per OS sit beyond the input boundary
CI can reach and are verified exclusively by the live-smoke matrix — a green
`hook-contract` job is *not* evidence that, e.g., the Windows companion
captures selections.

> In a project where `npx prompt-gloss init` was run once: (1) in a VS Code
> integrated terminal running `claude`, the user highlights a word from the
> conversation, invokes Gloss via context menu or keybinding, saves a card in
> a real panel without touching a browser tab, sends a message using the term,
> and the response demonstrably uses the card with a visible indicator; (2) in
> a plain terminal, the same loop works via the companion's highlight + hotkey
> path; (3) a fresh session after full restart still injects; (4) cards
> created in any surface (web/IDE/companion/hand-edited) inject in all;
> (5) Windows, macOS, Linux each have a working primary path, CI-verified
> where possible, live-smoked elsewhere; (6) all v1 suites and the golden set
> stay green; (7) install AND uninstall are one documented command each.
