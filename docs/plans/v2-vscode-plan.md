# v2 Phase C — `gloss-terminal` extension (Codex lane, Claude gates)

**Branch:** `feat/v2-vscode` (based on `origin/master` = Phase A + CLI merged).
**Binding specs:** TERMINAL.md §7 (all subsections), §2.3, §11 Phase C; TESTING.md
"Extension tests"; AGENTS.md "Your lane" (Codex owns `packages/vscode` +
`packages/panel-ui`). CLAUDE.md/AGENTS.md division of labor governs.

**Lane rules (non-negotiable):**
- This is the **Codex lane**: Codex implements each `@codex` task; Claude
  architected this split, reviews every diff, and holds the final merge gate.
- **Pinned contracts** — the `@prompt-gloss/panel-ui` public API (below), the
  `<gloss-context>` format, `CardSource.origin`, and the hook stdin/stdout
  contract are pinned by Claude. If a task needs to change one, **STOP and flag
  it for the Claude lane** — do not change it unilaterally (AGENTS.md).
- **Never fork the matcher / core.** The extension uses `@prompt-gloss/core`
  directly, in-process. Do not reimplement matching, slugging, or the store.
- Every package added must be wired into root `tsconfig.json` `references` and
  the vitest project globs (TERMINAL.md §11 "Every phase adding a package").

**Green baseline (verified by Claude before dispatch):** `pnpm check` and
`pnpm test:e2e` both pass on this branch. These are the regression gates.

---

## Wave 1 — `panel-ui` extraction (sequential; blocks all of Wave 2)

### @codex — Extract `CardPanel` into `packages/panel-ui` (shared package)

**Goal.** Move the React card-panel component out of `packages/web` into a new
shared package `@prompt-gloss/panel-ui` (TERMINAL.md §7.4), consumed by
`packages/web` with **zero behavior change**. The v1 Playwright suite is the
acceptance test for the extraction.

**What to create — `packages/panel-ui/`:**

- `package.json`:
  - `"name": "@prompt-gloss/panel-ui"`, `"private": true`, `"type": "module"`,
    `"version": "0.1.0"`, `"license": "MIT"`.
  - `"main"` / `"types"` / `"exports"` pointing at the built `dist/` (mirror how
    `packages/core` exposes its entry — match that package's field style).
  - `"scripts": { "build": "tsc -b" }`.
  - `"dependencies": { "@prompt-gloss/core": "workspace:*" }` (Card type only).
  - `"peerDependencies": { "react": "^18.3.1" }`.
  - `"devDependencies"`: `@types/react` (^18.3.18), `react` (^18.3.1) for local
    typecheck. Keep versions aligned with `packages/web`.
- `tsconfig.json`: composite build config mirroring `packages/web/tsconfig.json`
  compiler options relevant to a React lib (`"jsx": "react-jsx"`, `composite`,
  `declaration`, `outDir: "dist"`, `rootDir: "src"`), with a project reference
  to `../core`. No DOM-app-only settings that don't apply to a library.
- `src/CardPanel.tsx`: the component **moved verbatim** from
  `packages/web/src/CardPanel.tsx`. The **only** change is the `Card` import:
  import it from `@prompt-gloss/core` (type-only) instead of `./api.js`.
- `src/index.ts`: re-export the pinned public API (below).
- `src/card-panel.css`: the `.gloss-panel*` rules **moved verbatim** out of
  `packages/web/src/app.css` (see CSS rule below).

**PINNED public API of `@prompt-gloss/panel-ui` — do not change these
signatures (Claude-owned contract):**

```ts
// index.ts
export { CardPanel, draftFromCard, draftFromSelection } from "./CardPanel.js";
export type { PanelDraft } from "./CardPanel.js";

// PanelDraft shape (unchanged from the current web component):
export interface PanelDraft {
  slug: string | null;
  term: string;
  aliases: string;
  body: string;
  source: { span: string; message: string };
}

// Component props (unchanged):
interface CardPanelProps {
  draft: PanelDraft;
  onSave: (input: { term: string; aliases: string[]; body: string }) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function draftFromCard(card: import("@prompt-gloss/core").Card): PanelDraft;
export function draftFromSelection(span: string, message: string): PanelDraft;
```

The rendered DOM (element tags, `className`s, every `data-testid`,
`aria-label`s, disabled/scope behavior) must be **byte-identical** to today's
component — the Playwright specs assert on these `data-testid`s.

**Consume it from `packages/web` (zero behavior change):**

- Delete `packages/web/src/CardPanel.tsx`.
- In `packages/web/src/App.tsx`, change the import from `"./CardPanel.js"` to
  `"@prompt-gloss/panel-ui"`. All usages (`CardPanel`, `draftFromCard`,
  `draftFromSelection`, `PanelDraft`) stay identical.
- Add `"@prompt-gloss/panel-ui": "workspace:*"` to
  `packages/web/package.json` dependencies.

**CSS rule (keep output identical):** move the `.gloss-panel*` selectors from
`packages/web/src/app.css` into `packages/panel-ui/src/card-panel.css`
**verbatim** (same selectors, same declarations, same order). Have `web` import
that stylesheet so the composed CSS is unchanged — either `@import` it at the
same position in `app.css` where the block used to be, or `import
"@prompt-gloss/panel-ui/card-panel.css"` in `web`'s entry alongside `app.css`,
whichever keeps cascade order identical. Add a matching `"./card-panel.css"`
entry to panel-ui's `package.json` `exports` if you choose the JS-import path.
Do not restyle anything.

**Wiring (required, or typecheck silently skips the package):**

- Add `{ "path": "packages/panel-ui" }` to the root `tsconfig.json`
  `references` array.
- Add a project reference to `../panel-ui` in `packages/web/tsconfig.json`
  `references`.
- Run `pnpm install` so the new workspace package links.

**GATE (Claude verifies — do not report done until both pass locally):**
1. `pnpm check` green (lint + `tsc -b` + unit + eval).
2. `pnpm test:e2e` green (all 7 v1 Playwright scenarios).

**Out of scope for Wave 1:** the extension itself, esbuild bundling of
panel-ui, any webview wiring. Extraction only.

### @codex — result

**Status: DONE, gated green (Claude verified independently).**

- Files: created `packages/panel-ui/{package.json,tsconfig.json,src/CardPanel.tsx,
  src/index.ts,src/card-panel.css}`; modified `packages/web/{package.json,
  src/App.tsx,src/main.tsx,src/app.css,tsconfig.json,vite.config.ts}`, root
  `tsconfig.json`, `pnpm-lock.yaml`; deleted `packages/web/src/CardPanel.tsx`.
- `CardPanel.tsx` moved verbatim (only the `Card` import changed to
  `@prompt-gloss/core`). Public API matches the pinned contract exactly. CSS
  block moved verbatim; it was already the last block in `app.css` so the
  cascade is preserved.
- Gates (run by Claude, real commands, default config): `pnpm check` → exit 0
  (lint + `tsc -b` + 116 unit + 41 eval); `pnpm test:e2e` → 7/7 pass.

**Adversarial review (`/break-it`, Codex) — findings & dispositions:**

1. Lockfile absent from the reviewed diff → CI frozen install would reject.
   _Disposition: artifact of Claude's diff-scoping; the worktree has the
   lockfile change. Committed with the manifests. Not a code defect._
2. Fresh `pnpm dev` fails: web imports panel-ui at runtime (values, not
   type-only like core/server), so its `dist/` had to exist before Vite could
   resolve it. _Disposition: FIXED — Vite exact-match alias resolves panel-ui
   from `src`. Proven: `pnpm test:e2e` 7/7 with `panel-ui/dist` deleted._
3. web `tsconfig` references omit the directly-imported server/core projects.
   _Disposition: pre-existing (web never referenced them; canonical root
   `tsc -b` orders them). Hardened anyway — web now references core, server,
   panel-ui. `pnpm check` green._
4. panel-ui `"private": true` contradicts §10 (public npm package).
   _Disposition: FIXED — Claude's plan file wrongly specified private; removed
   to mirror `@prompt-gloss/core`. Real bug, caught._
5. `card-panel.css` uses `--gloss-*` vars with no fallbacks; a standalone
   consumer (extension webview) loses colors. _Disposition: NOT a wave-1 web
   regression (web defines the vars). CARRIED TO WAVE 2 — the extension webview
   must provide theming (map `--gloss-*` to `--vscode-*` theme tokens)._
6. Panel sizing relies on web's global `box-sizing: border-box`; a standalone
   consumer gets content-box overflow. _Disposition: as #5 — CARRIED TO WAVE 2:
   the webview base stylesheet must set `box-sizing: border-box`._

Wave-2 requirement (from #5/#6): the `gloss.cardPanel` webview HTML must ship a
base reset (`box-sizing: border-box`) and define the `--gloss-*` custom
properties (bound to VS Code `--vscode-*` theme variables) before/around the
imported `card-panel.css`, so the panel renders correctly without the web app's
globals.

---

## Wave 2 — `packages/vscode` extension (`gloss-terminal`)

**Sequencing decision (Claude, architect).** The three slices below are NOT
independent: all three write `packages/vscode/package.json` and `src/extension.ts`,
and there is hard ordering (tests need capture needs scaffold). Fanning them out
concurrently into one shared worktree would scramble results — exactly what the
`/parallel-team` independence rule says to flag. So Wave 2 runs as a **gated
Codex pipeline**: Slice 1 → Claude gate → Slice 2 → Claude gate → Slice 3 →
Claude gate. Still the Codex lane (Codex implements all three); Claude
architects/reviews/gates each.

### Pinned contracts for Wave 2 (Claude-owned — do not change; flag if needed)

**Core (in-process, no server/HTTP — §7.4):**
`new CardStore(workspaceFolderFsPath)` → `.getIndex()`, `.rebuildIndex()`,
`.create({term, aliases?, body, source})`, `.update(slug, patch)`,
`.delete(slug)`, `.get(slug)`, `.list()`. Edit-mode detection: build/get the
index, `matchMessage(span, index): string[]`; non-empty ⇒ open the first match
in edit mode (mirrors v1 `POST /api/match`). Never reimplement matching/slugging.

**Provenance (§5):** every card saved by the extension sets
`source.origin = "vscode-terminal"`, `source.span = <selection>`,
`source.message = <≤200-char excerpt from the provenance buffer, "" if none>`.

**panel-ui (already shipped Wave 1):** `import { CardPanel, draftFromCard,
draftFromSelection, type PanelDraft } from "@prompt-gloss/panel-ui"` +
`@prompt-gloss/panel-ui/card-panel.css`. Do not modify panel-ui.

**Webview ↔ host message protocol (pinned):**
```ts
// host → webview
{ type: "open"; draft: PanelDraft }
// webview → host
{ type: "ready" }                                                   // on mount
{ type: "save"; input: { term: string; aliases: string[]; body: string } }
{ type: "delete"; slug: string }                                    // edit mode
{ type: "close" }
```
The webview React entry mounts `CardPanel`, feeds it the `draft` from the last
`open`, and translates `onSave/onDelete/onClose` into the messages above. The
host performs all disk I/O via core (webview has no fs/core access). On `save`,
the host chooses create vs update by `draft.slug` (null ⇒ create), stamps
`origin: "vscode-terminal"`, then (§6) shows a VS Code toast + status-bar flash
and closes the panel. On `delete`, `CardStore.delete(slug)`.

**Distribution (§7.5):** extension id `prompt-gloss.gloss-terminal`; bundles
core + panel-ui (esbuild from TS source, hook pattern); works with zero project
npm installs.

### Slice 1 — @codex scaffold + contributions (§7.1)

Own: `packages/vscode/{package.json, tsconfig.json, .vscodeignore, .gitignore,
esbuild.mjs, src/extension.ts}` + root `tsconfig.json` reference + root
`.gitignore` (ignore `packages/vscode/{dist,out,.vscode-test}`).

- `package.json` contributions EXACTLY per §7.1: `activationEvents` for the
  command; `contributes.commands` → `gloss.captureSelection` ("Gloss: attach
  context to selection"); `contributes.keybindings` → `ctrl+alt+g` /
  `cmd+alt+g` (mac), `"when": "terminalFocus && terminalTextSelected"`;
  `contributes.menus["terminal/context"]` → same command + same `when`;
  `contributes.viewsContainers` + `contributes.views` → a `gloss.cardPanel`
  `WebviewView` in the **panel** area; register it with
  `retainContextWhenHidden: true`. `engines.vscode` pinned; `main` →
  `./dist/extension.js`. Scripts: `build` (esbuild both bundles + tsc typecheck),
  `package` (vsce), `test:vscode` (placeholder until Slice 3).
- `esbuild.mjs`: TWO bundles — (a) host: `src/extension.ts` → `dist/extension.js`,
  `platform:"node"`, `format:"cjs"`, `external:["vscode"]`, bundle core; (b)
  webview: `src/webview/index.tsx` → `dist/webview.js`, `platform:"browser"`,
  bundle react/react-dom + `@prompt-gloss/panel-ui` (alias to its `src`, hook
  pattern) + the CSS. (Slice 1 may stub the webview entry; Slice 2 fills it.)
- `src/extension.ts`: `activate()` registers the `gloss.captureSelection`
  command (Slice-1 body may be a typed stub that reveals the panel) and the
  `WebviewViewProvider` for `gloss.cardPanel`; `deactivate()`. Clean disposal.
- Wiring: add `{ "path": "packages/vscode" }` to root `tsconfig.json`
  references. Do NOT add any `*.test.ts` under `packages/vscode/src` (the `unit`
  vitest glob is `packages/*/src/**/*.test.ts` — extension tests live in
  `packages/vscode/test/` in Slice 3).
- **Gate:** `pnpm install` clean; `pnpm check` green (extension typechecks, no
  vitest leakage); `pnpm --filter gloss-terminal build` produces both bundles;
  `.vsix` packs (`npx vsce package`). Report real output.

### Slice 2 — @codex capture + provenance + webview (§7.2–§7.4, §5, §6)

Own: `packages/vscode/src/{capture.ts, provenance.ts, cardService.ts,
webview/index.tsx, webview/html.ts, messaging.ts}`; edit `src/extension.ts`
(wire the command → capture → panel) and `package.json` (add deps:
`@prompt-gloss/core`, `@prompt-gloss/panel-ui`, `react`, `react-dom`; devDeps
for esbuild/types). Depends on Slice 1 merged.

- `capture.ts` — the §7.2 sequence exactly: save `env.clipboard.readText()`;
  `executeCommand("workbench.action.terminal.copySelection")`; read clipboard →
  `span`; **restore** the saved clipboard; look up `span` in the provenance ring
  → `message`; reveal the panel prefilled; if `matchMessage(span, index)`
  non-empty, open edit mode with `draftFromCard(firstMatch)`.
- `provenance.ts` — §7.3: subscribe `window.onDidStartTerminalShellExecution`,
  stream `execution.read()` into a **per-terminal 32 KB ring buffer**; on
  capture, newest chunk containing `span` → ≤200-char excerpt; shell integration
  inactive ⇒ `message = ""` and the card still saves (degrade, don't block).
  Dispose subscriptions on deactivate; drop buffers on terminal close.
- `cardService.ts` — core store access (§7.4): `CardStore` against the workspace
  folder of the **active terminal's cwd** (multi-root aware); create/update/
  delete; edit-mode match. Stamp `origin:"vscode-terminal"`.
- `webview/` — mounts `CardPanel` (Slice-2 fills the Slice-1 stub), implements
  the pinned message protocol, and the **#5/#6 theming**: the webview HTML sets
  `box-sizing:border-box` and defines the `--gloss-*` vars mapped to
  `--vscode-*` theme tokens; strict CSP; `asWebviewUri` for `dist/webview.js`
  and the CSS. On save: toast + status-bar flash (§6).
- **Gate:** `pnpm check` green; both bundles build; a scripted capture path is
  unit-coverable (Slice 3 asserts it). Report real output.

### Slice 3 — @codex extension test suite + CI (TESTING.md "Extension tests")

Own: `packages/vscode/test/**` (`@vscode/test-electron` runner + suites),
`packages/vscode/package.json` `test:vscode` script + test devDeps, root
`.github/workflows/ci.yml` (add an `extension` job: ubuntu + xvfb). Depends on
Slices 1–2 merged.

- Suites (place in `packages/vscode/test/`, NOT `src/`): activation;
  contributions asserted against the packaged `package.json` (command,
  keybinding, menu, view); capture with a **pre-seeded clipboard** (harness
  can't select real terminal text — boundary rule) → user clipboard restored
  after capture, panel opens prefilled, **Save writes the card via core to the
  workspace `.gloss/` (assert on disk)**, editing an existing term opens edit
  mode; webview ↔ host `postMessage` round-trip snapshot.
- Real-terminal selection capture + the shell-integration provenance buffer are
  **live-smoke items** — document them as untestable in the harness (boundary
  rule), do not fake the terminal.
- CI: `extension` job on ubuntu with `xvfb-run`; builds the extension, runs
  `test:vscode`. Keep it a required check.
- **Gate:** `pnpm test:vscode` green locally (Windows can run
  `@vscode/test-electron` headed — no xvfb needed off-Linux); `pnpm check`
  still green. Report real output.

### Integration gate (Claude, after Slice 3)

`/break-it` on the full `packages/vscode` diff; log findings + dispositions in
the PR description. Wiring checks: root `tsconfig` references include
`packages/vscode` (+ `packages/panel-ui`, done); `npx vsce package` builds a
`.vsix` locally. Then `/commit-push-pr` (title "v2 phase C: gloss-terminal
extension"). Flag the human-only live-smoke items: real terminal-selection
capture in VS Code AND Cursor (TESTING.md § live smoke).
