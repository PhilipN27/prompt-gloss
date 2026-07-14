// Standalone Phase-D companion pages. `packages/panel-ui` is not available in
// this worktree, so this module supplies (1) the first-run project picker and
// (2) a deliberately small card form that POSTs to the real `/api/cards`
// route. The embedded server must register this module before it listens.

import type { FastifyInstance } from "@prompt-gloss/server";
import { readProjectRegistry } from "./project-registry.js";
import { COMPANION_ORIGIN } from "./types.js";

export interface ProjectPickerSelection {
  readonly projectDir: string;
  readonly span: string;
  readonly origin: typeof COMPANION_ORIGIN;
}

export interface ProjectPickerResult {
  /** URL of the selected project's newly bound companion panel server. */
  readonly panelUrl: string;
}

export interface CompanionPanelRouteOptions {
  /** Test seam for ~/.gloss/projects.json. Defaults to the current user's home. */
  readonly homeDir?: string;
  /**
   * When true, `/panel` ALWAYS renders the project picker (never the card
   * form), regardless of the `?pick` query. The picker server is bound to a
   * throwaway dir, so it must never serve a card form that would POST to
   * `/api/cards` (break-it F1). Project-bound servers leave this false.
   */
  readonly pickerOnly?: boolean;
  /**
   * Integration seam: stop/rebind the embedded server to `projectDir`, retain
   * that target for subsequent captures, and return the new panel URL.
   */
  readonly onProjectSelected?: (
    selection: ProjectPickerSelection
  ) => Promise<ProjectPickerResult>;
}

interface PanelQuery {
  pick?: string;
  span?: string;
  origin?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function projectName(projectDir: string): string {
  const trimmed = projectDir.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).at(-1) || projectDir;
}

const pageStyles = `
  :root { color-scheme: light dark; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 320px; background: #111827; color: #e5e7eb; }
  main { width: min(560px, 100%); margin: 0 auto; padding: 28px 24px 32px; }
  h1 { margin: 0; font-size: 1.35rem; }
  .eyebrow { margin: 0 0 4px; color: #a78bfa; font-size: .76rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .lede { margin: 10px 0 22px; color: #9ca3af; }
  label { display: grid; gap: 6px; margin: 14px 0; font-weight: 600; }
  input, textarea, select, button { font: inherit; }
  input, textarea, select { width: 100%; border: 1px solid #374151; border-radius: 8px; padding: 10px 11px; background: #1f2937; color: #f9fafb; }
  textarea { min-height: 138px; resize: vertical; }
  select:disabled { opacity: .7; }
  .hint { color: #9ca3af; font-size: .82rem; font-weight: 400; }
  button { border: 0; border-radius: 8px; padding: 10px 14px; background: #7c3aed; color: white; cursor: pointer; font-weight: 700; }
  button:disabled { cursor: wait; opacity: .55; }
  .projects { display: grid; gap: 10px; margin-top: 18px; }
  .project { display: grid; width: 100%; text-align: left; background: #1f2937; border: 1px solid #374151; }
  .project:hover { border-color: #8b5cf6; background: #252f40; }
  .project small { overflow-wrap: anywhere; color: #c4b5fd; font-weight: 400; }
  .empty { padding: 16px; border: 1px dashed #4b5563; border-radius: 8px; color: #d1d5db; }
  .status { min-height: 1.5em; color: #c4b5fd; }
  code { color: #ddd6fe; }
`;

function documentShell(title: string, content: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${pageStyles}</style>
</head>
<body>
${content}
<script>${script}</script>
</body>
</html>`;
}

export function renderProjectPickerPage(projects: readonly string[], span: string): string {
  const choices = projects.length
    ? `<div class="projects">${projects
        .map(
          (projectDir) => `<button class="project" type="button" value="${escapeHtml(projectDir)}">
  <strong>${escapeHtml(projectName(projectDir))}</strong>
  <small>${escapeHtml(projectDir)}</small>
</button>`
        )
        .join("")}</div>`
    : `<p class="empty">No initialized projects yet. Run <code>prompt-gloss init</code> in a project, then press the companion hotkey again.</p>`;

  return documentShell(
    "Choose a project — Gloss",
    `<main>
  <p class="eyebrow">Gloss companion</p>
  <h1>Choose a project</h1>
  <p class="lede">This selection becomes the target for this capture and subsequent companion captures.</p>
  <input id="captured-span" type="hidden" value="${escapeHtml(span)}">
  ${choices}
  <p id="status" class="status" role="status"></p>
</main>`,
    `
const status = document.querySelector("#status");
const buttons = document.querySelectorAll("button.project");
for (const button of buttons) {
  button.addEventListener("click", async () => {
    for (const item of buttons) item.disabled = true;
    status.textContent = "Opening project…";
    try {
      const response = await fetch("/api/companion/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectDir: button.value,
          span: document.querySelector("#captured-span").value,
          origin: "companion"
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not select project");
      window.location.assign(payload.panelUrl);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      for (const item of buttons) item.disabled = false;
    }
  });
}
`
  );
}

export function renderStandalonePanelPage(span: string): string {
  return documentShell(
    "New context card — Gloss",
    `<main>
  <p class="eyebrow">Gloss companion</p>
  <h1>New context card</h1>
  <p class="lede">Attach durable project context to the highlighted span.</p>
  <form id="card-form">
    <input id="source-span" type="hidden" value="${escapeHtml(span)}">
    <label>Term<input id="term" name="term" value="${escapeHtml(span)}" required></label>
    <label>Aliases <span class="hint">comma-separated</span><input id="aliases" name="aliases"></label>
    <label>Context<textarea id="body" name="body" required></textarea></label>
    <label>Scope <select disabled><option selected>project</option></select><span class="hint">Global scope is planned for v3.</span></label>
    <button id="save" type="submit">Save card</button>
    <p id="status" class="status" role="status"></p>
  </form>
</main>`,
    `
const form = document.querySelector("#card-form");
const save = document.querySelector("#save");
const status = document.querySelector("#status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  save.disabled = true;
  status.textContent = "Saving…";
  const term = document.querySelector("#term").value.trim();
  const aliases = document.querySelector("#aliases").value
    .split(",").map((alias) => alias.trim()).filter(Boolean);
  try {
    const response = await fetch("/api/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term,
        aliases,
        body: document.querySelector("#body").value,
        scope: "project",
        source: {
          span: document.querySelector("#source-span").value,
          message: "",
          origin: "companion"
        }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not save card");
    status.textContent = "Card '" + payload.term + "' saved to .gloss/";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    save.disabled = false;
  }
});
`
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** Register `/panel` plus the picker's project-selection callback route. */
export function registerCompanionPanelRoutes(
  app: FastifyInstance,
  opts: CompanionPanelRouteOptions = {}
): void {
  app.get<{ Querystring: PanelQuery }>("/panel", async (request, reply) => {
    const span = typeof request.query.span === "string" ? request.query.span : "";
    // `pickerOnly` forces the picker even if `?pick=1` was lost in transit
    // (e.g. a browser-fallback launcher that mangles `&` — break-it F1).
    const page =
      opts.pickerOnly || request.query.pick === "1"
        ? renderProjectPickerPage(readProjectRegistry(opts.homeDir), span)
        : renderStandalonePanelPage(span);
    return reply.type("text/html; charset=utf-8").send(page);
  });

  app.post<{ Body: unknown }>("/api/companion/project", async (request, reply) => {
    const body = asRecord(request.body);
    const projectDir = body?.projectDir;
    const span = body?.span;
    if (typeof projectDir !== "string" || typeof span !== "string") {
      return reply.code(400).send({ error: "projectDir and span are required" });
    }
    if (!readProjectRegistry(opts.homeDir).includes(projectDir)) {
      return reply.code(400).send({ error: "Choose a project from the Gloss project registry" });
    }
    if (!opts.onProjectSelected) {
      return reply.code(503).send({
        error: "Project selection is not wired into the companion server yet"
      });
    }
    const result = await opts.onProjectSelected({
      projectDir,
      span,
      origin: COMPANION_ORIGIN
    });
    return reply.send(result);
  });
}
