# Phase D — OS companion: parallel implementation plan

Branch: `feat/v2-companion`. Spec: TERMINAL.md §8 (§8.1/§8.2/§8.3), §2.4, §3, §6,
§9.4; TESTING.md "Companion tests". Council with Codex (2026-07-14) pinned the
contested calls — decisions are baked into the foundation below.

## Status: foundation DONE and green (this lane, pre-fan-out)

The OS-agnostic architecture is built and CI-verified. `tsc -b` clean, eslint
clean, **cli 74 / unit 121 / eval 41** passing. What exists:

| File | What | Verified by |
|---|---|---|
| `packages/cli/src/companion/types.ts` | All pinned contracts: `SelectionSource`, `HotkeyRegistrar`, `CaptureResult` (4-way), `CaptureCapability`, `PanelOpener`, `Notifier`, `ProjectResolver`, `PanelEndpoints` | tsc |
| `…/companion/flow.ts` | `CaptureFlow` state machine (hotkey→capture→toast/open; onCardSaved→notify; reentrancy guard) | `test/companion/flow.test.ts` (8) |
| `…/companion/freshness.ts` | Pure Windows/Wayland clipboard-freshness (council predicate + state rules) | `test/companion/freshness.test.ts` (9) |
| `…/companion/server-embed.ts` | `startPanelServer → {baseUrl, close}` on port 0, `onCardSaved` threaded | `test/companion/server-embed.test.ts` (3) |
| `…/companion/project-registry.ts` | `readProjectRegistry(~/.gloss/projects.json)` for the picker | `test/companion/project-registry.test.ts` (5) |
| `…/companion/project-resolver.ts` | explicit `--project` → project; else picker (never cwd) | flow/command tests |
| `…/companion/select.ts` | adapter registry (routes by OS to the stub adapters) | command tests |
| `…/companion/command.ts` | `runCompanion` wiring (select→probe→embed→register→dispose) | `test/companion/command.test.ts` (7) |
| `packages/server/src/app.ts` | `buildServer(overrides, hooks)` `onCardSaved` on create+update, throw-safe | `src/on-card-saved.test.ts` (5) |
| `packages/cli/src/cli.ts` | `companion` command + flags; **no cwd default** | `test/cli-args.test.ts` |
| `packages/cli/src/commands/doctor.ts` | real per-OS capability line via non-prompting `probe()` | `test/add-log-doctor.test.ts` |
| `packages/cli/src/web-assets.ts` | shared web-UI serving (web + companion) | — |
| `packages/cli/package.json` | `uiohook-napi` **optionalDependency** (lockfile synced) | — |
| `TESTING.md` | output-boundary rule clarified (opener/notifier fakeable) | — |

**STUB files awaiting slices** (each slice replaces its file body wholesale; the
foundation + registry are INTEGRATOR-OWNED and must NOT be edited by slices —
this is how the slices stay merge-conflict-free, per council problem #6):
`adapters/windows.ts`, `adapters/macos.ts`, `adapters/linux.ts`, `opener.ts`,
`notifier.ts`, `autostart.ts`.

## Council-pinned contracts every slice honors

1. **`CaptureResult` is 4-way**: `ok` / `retryable{empty-selection|stale-clipboard, hint}` /
   `blocked{permission-denied, remediation, restartRequired}` / `unsupported{reason, fallback:"cli"}`.
   `blocked` ≠ `unsupported`: a permission grant recovers `blocked`, so never
   route it permanently to CLI.
2. **`probe()` is NON-PROMPTING** — doctor must never open a permission dialog
   or a Wayland shortcut-registration prompt.
3. **Never synthesize Ctrl+C** on Windows (SIGINT hazard, §2.4). macOS ⌘C synth
   is safe.
4. **Hotkey-first on Wayland**: a capture mechanism with no bindable hotkey is
   not a companion rung.
5. **Lazy-load `uiohook-napi`** inside `register()`/`capture()` in a try/catch —
   NEVER at module top-level (doctor's `probe()` and CI import must not require
   the native prebuild). Import failure → `{ ok:false, detail }` with a doctor hint.
6. Slices touch ONLY their own file(s). No edits to `types.ts`, `flow.ts`,
   `select.ts`, `command.ts`, `server-embed.ts`, `cli.ts`, `doctor.ts`,
   `package.json`. Need a shared-file change? FLAG it in the PR notes; the
   integrator makes it.

---

## Slice 1 — @claude Windows adapter (`adapters/windows.ts` only)

Implement `createWindowsAdapter(env)`.
- **SelectionSource `windows-clipboard`**: `capture()` reads the clipboard (e.g.
  `powershell -NoProfile -Command Get-Clipboard`, no extra dep) and gates it
  through `assessFreshness` (`../freshness.js`) with per-adapter closure state.
  Arm the freshness baseline on adapter creation. Prefer the Win32 clipboard
  **sequence number** as the freshness identity if obtainable (native/FFI);
  otherwise clipboard text (documented blind spots already unit-tested).
  Reject → `{status:"retryable", reason:"stale-clipboard"|"empty-selection",
  hint:"Copy your selection first (Ctrl+Shift+C in Windows Terminal), then press
  the hotkey again."}`. Accept → `{status:"ok", text}`. `probe()` →
  `{support:"available", detail:"…copy-then-hotkey…"}` (available even with an
  empty clipboard).
- **HotkeyRegistrar `windows-uiohook`**: lazy-import `uiohook-napi`; `RegisterHotKey`
  via a keydown chord match on the accelerator; `register`→`{ok:true,dispose}`,
  import failure → `{ok:false, detail:"uiohook-napi prebuild unavailable — see \`prompt-gloss doctor\`"}`.
- Pure helpers (accelerator parse, freshness identity) get colocated unit tests.
  Real hotkey + real clipboard capture are LIVE-SMOKE.

## Slice 2 — @claude macOS adapter (`adapters/macos.ts` only)

Implement `createMacosAdapter(env)`.
- **SelectionSource `macos-pasteboard`**: `capture()` snapshots `NSPasteboard`
  (`pbpaste`), synthesizes **⌘C** via uiohook `keyTap` (safe on macOS), reads,
  and **restores** the pasteboard. Empty selection → `retryable/empty-selection`.
  Permission denied → `{status:"blocked", reason:"permission-denied",
  remediation:"Grant Gloss access in System Settings › Privacy & Security ›
  Input Monitoring.", restartRequired:true}`. `probe()` checks Input Monitoring
  status WITHOUT prompting → `blocked` when denied/unknown, `available` when
  granted.
- **HotkeyRegistrar `macos-uiohook`**: uiohook (CGEventTap → **Input Monitoring**,
  NOT Accessibility — §2.4). Name the exact pane in any failure `detail`.
- Pasteboard save/restore correctness + permission flow are LIVE-SMOKE.

## Slice 3 — @claude Linux adapter (`adapters/linux.ts` only)

Implement `createLinuxAdapter(env)`; detect X11 vs Wayland from `env`
(`WAYLAND_DISPLAY` / `DISPLAY`).
- **X11**: SelectionSource `x11-primary` reads PRIMARY via
  `xclip -o -selection primary` (fallback `xsel -p`) — no keystroke, highest
  fidelity. Empty PRIMARY → `retryable/empty-selection`. Both tools missing →
  `unsupported`. Hotkey via uiohook (XGrabKey).
- **Wayland — HOTKEY-FIRST** (council): (1) establish portal `GlobalShortcuts`
  and BIND the accelerator; capability = the returned bindings actually CONTAIN
  our shortcut (a subset/empty binding is NOT bound). (2) bound → prefer
  functional background PRIMARY via a **bounded probe**
  (`wl-paste --primary --watch /bin/true` staying alive; or a
  `zwlr_data_control_manager_v1`/`ext_data_control_manager_v1` registry probe
  paired with wl-paste protocol support) — do NOT infer from `WAYLAND_DISPLAY` /
  desktop name / executable presence. (3) else clipboard freshness
  (`../freshness.js`). (4) hotkey can't bind → `unsupported`.
- `probe()` returns rich `detail` for doctor: session, global-hotkey status,
  PRIMARY status, clipboard fallback, effective rung, exact fix
  (install `wl-clipboard`/`xclip`, enable a portal backend, authorize the
  shortcut, or `prompt-gloss add`). Non-prompting.
- Real PRIMARY/portal capture are LIVE-SMOKE.

## Slice 4 — @codex Panel plumbing + UX (`opener.ts`, `notifier.ts`, `autostart.ts` + new picker files)

- **`opener.ts`** `createAppModeOpener`: launch an app-mode browser window
  (`chrome --app=<url>` / `msedge --app=<url>`, detached), DEFAULT-BROWSER
  fallback (`open`/`start`/`xdg-open`) when neither is found. Always-on-top is
  unavailable (§8.3 Phase-0 finding) — a focused normal window is fine.
- **`notifier.ts`** `createOsNotifier`: real OS notifications per-OS (Windows
  toast, macOS `osascript display notification`, Linux `notify-send`). Map
  `NotifyMessage.kind` to title/urgency. Best-effort — never throw.
- **`autostart.ts`** `installAutostart`: Windows Run key, macOS LaunchAgent
  plist, XDG autostart `.desktop` (§8.2). One flag; print what it wrote.
- **Project-picker page (§8.2/§8.3)**: when the panel URL carries `?pick=1`,
  serve a page listing `readProjectRegistry()` projects; picking targets that
  project for subsequent captures. NOTE — the embedded server binds ONE project
  at construction (`startPanelServer`); rebinding after a pick needs either a
  server "set-project" seam or a companion restart. This is a **shared-file
  change** (server or `command.ts`): FLAG it in PR notes; the integrator wires
  it. Do NOT edit `server-embed.ts`/`command.ts`/`app.ts` unilaterally.
- **panel-ui dependency**: the `/panel?span=&origin=companion` page needs the
  shared panel (Phase C `packages/panel-ui`, not yet extracted) OR a `?span=`
  deep-link in the web SPA. If unavailable, ship a MINIMAL standalone panel page
  that POSTs to `/api/cards` so Phase D does not block on Phase C. FLAG which
  path was taken.
- Consume (don't modify) `startPanelServer` and `readProjectRegistry`.

---

## Integration (this lane, after slices)

1. `npx tsc -b`, `npx eslint .`, `npx vitest run --project cli`, `--project unit`,
   `--project eval` all green (foundation tests must stay green — the slices'
   native code is additive and must not regress the flow/wiring/server tests).
2. Wire any shared-file change a slice flagged (picker rebind, deep-link).
3. `/break-it` on the full branch diff; log findings + dispositions.
4. `/commit-push-pr` — title "v2 phase D: OS companion".

## Fan-out results (2026-07-14)

All four slices landed against their own files; integration wired + green.

- [x] **Slice 1 — Windows** _done: `adapters/windows.ts`, injectable clipboard
  reader, freshness-gated capture, lazy uiohook (fails closed). 14 tests._
- [x] **Slice 2 — macOS** _done: `adapters/macos.ts`, pasteboard save/restore in
  `finally`, `blocked`≠`unsupported`, non-prompting `probe()` (unknown→blocked).
  13 tests._
- [x] **Slice 3 — Linux** _done: `adapters/linux.ts`, X11 PRIMARY + Wayland
  hotkey-first (gdbus portal shell-out, fails closed), doctor-rich `probe()`.
  28 tests._
- [x] **Slice 4 — Panel plumbing** _done: `opener.ts` (chrome/msedge `--app` +
  default-browser fallback), `notifier.ts` (per-OS toast/osascript/notify-send),
  `autostart.ts` (Run key / LaunchAgent / XDG), `picker.ts` (standalone
  `/panel` + picker, panel-ui absent). 23 tests._
- [x] **Integration** _done: `server-embed.ts` registers the panel routes before
  the SPA fallback; `command.ts` starts a picker server with no `--project` and
  rebinds via `onProjectSelected` (session-backed, getter `baseUrl`). Full gate:
  tsc 0, cli 154, unit 121, eval 41, eslint clean._

All native capture (uiohook chords, clipboard/pasteboard/PRIMARY reads, the
gdbus portal, real toasts/windows/autostart) is **fails-closed and LIVE-SMOKE
only** — every slice flagged that its native surface is unverified in CI.

## Break-it dispositions (Codex adversarial pass, 2026-07-14)

Codex cleared the load-bearing invariants (`onCardSaved` throw-safety, picker
XSS-escaping + registry-only project validation, flow reentrancy, freshness
edges, route precedence, the no-cwd-default, no top-level uiohook import) and
raised 8 findings — all fixed:

- **F1 (High)** picker URL lost `&pick=1` through `cmd.exe start`, then the card
  form saved to the shared-tmpdir picker server → caret-escape cmd
  metacharacters in `opener.ts`; `pickerOnly` so the picker server never serves
  the card form (`picker.ts`); private `mkdtemp` placeholder cleaned on stop.
- **F2 (High)** `stop()` could orphan a server started by an in-flight pick →
  `stopped` flag + `startBoundServer` self-closes late servers; `closeAll`
  snapshots-then-clears atomically.
- **F3 (High)** autostart write failure orphaned the live daemon → wrapped
  non-fatal.
- **F4 (Med)** concurrent picks raced + accumulated servers → serialized
  selection lock; superseded project server retired.
- **F5 (Med)** `stop()` didn't wait for an in-flight capture → stop-guarded
  opener (no-op after stop) + `stop()` awaits the capture.
- **F6 (Med)** construction did clipboard I/O (could hang `doctor`) → Windows
  `Get-Clipboard` bounded with a 1.5s timeout; Wayland no longer arms at
  construction. **Accepted residual:** the Windows adapter still reads the
  clipboard once (bounded) at construction to arm freshness, so `doctor`
  performs a bounded local clipboard read on Windows. A daemon-start `prime()`
  lifecycle (construct pure; only the running companion arms) is the clean
  follow-up.
- **F7 (Med)** adapters left listeners installed if `.start()` threw →
  windows/macos/linux register catches now tear down the partial listeners.
- **F8 (Med)** Wayland left a ref'd 60s portal timer → cleared on early resolve.

## Live-smoke matrix (HUMAN-only — beyond CI's input boundary, §14 / TESTING.md)

CI verifies the injection/flow/wiring path only. The per-OS CAPTURE mechanisms
must be smoked by a human:
- **Windows 11** (Windows Terminal + PowerShell): highlight → `Ctrl+Shift+C` →
  hotkey → panel → save → injection; verify the stale-clipboard toast when you
  press the hotkey without copying.
- **macOS** (Terminal.app): grant Input Monitoring (note the exact pane), then
  highlight → hotkey (⌘C synth) → panel → save; confirm the pasteboard is
  restored; note iTerm2/Warp behavior.
- **Ubuntu GNOME X11**: highlight → hotkey (PRIMARY, no copy) → panel → save.
- **One Wayland session** (GNOME ≥48 or KDE ≥6.3): portal shortcut binds →
  capture → panel → save; confirm `doctor` reports the honest effective rung.
- **Permission-grant flows on macOS** and the app-mode window launch on each OS.
