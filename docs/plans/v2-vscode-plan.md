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
