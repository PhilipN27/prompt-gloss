// Shared e2e helpers (TESTING.md → E2E). Playwright's webServer block starts
// ONE long-lived server+web process pair for the whole run against a shared
// temp project dir (playwright.config.ts); tests namespace their card terms
// with a per-test random suffix so they never collide, and clean up their own
// cards. The one scenario that needs to stop/restart the server manages its
// own standalone child process against its own temp dir (see
// spawnStandaloneServer) instead of touching the shared instance.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Locator } from "@playwright/test";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const serverDistMain = resolve(repoRoot, "packages", "server", "dist", "main.js");

/** A short random suffix so parallel/successive test terms never collide. */
export function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function deleteCardIfExists(
  request: APIRequestContext,
  baseURL: string,
  slug: string
): Promise<void> {
  await request.delete(`${baseURL}/api/cards/${encodeURIComponent(slug)}`);
}

/**
 * Select a single word inside `locator`'s text content via a real DOM range
 * (window.getSelection().addRange), exercising the same code path a user's
 * mouse-drag or double-click would. Deliberately not a triple-click: on a
 * block element, triple-click can select across into an adjacent sibling's
 * boundary, which the app correctly treats as a cross-message selection and
 * ignores (v1 policy: single-message selections only).
 */
export async function selectWordByDrag(
  page: import("@playwright/test").Page,
  locator: Locator,
  word: string
): Promise<void> {
  await locator.evaluate((el: HTMLElement, needle: string) => {
    const textNode = [...el.childNodes].find(
      (n): n is Text => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").includes(needle)
    );
    if (!textNode) throw new Error(`selectWordByDrag: "${needle}" not found in element text`);
    const content = textNode.textContent ?? "";
    const start = content.indexOf(needle);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + needle.length);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, word);
}

export interface StandaloneServer {
  baseURL: string;
  projectDir: string;
  /** Kill the current process and start a fresh one against the same project dir. */
  restart: () => Promise<void>;
  /** Kill the process and remove its temp project dir. */
  stop: () => Promise<void>;
}

/**
 * Spawn an independent gloss-server process (built dist, fake-agent mode) on
 * its own port against its own fresh temp project dir. Used only by the
 * persistence-across-restart scenario, which needs to stop and start a real
 * server process while keeping `.gloss/` on disk — something the shared
 * webServer-managed instance can't do mid-test-run.
 */
export async function spawnStandaloneServer(port: number): Promise<StandaloneServer> {
  const projectDir = mkdtempSync(join(tmpdir(), "gloss-e2e-restart-"));
  const baseURL = `http://127.0.0.1:${port}`;

  const spawnOne = (): ChildProcess =>
    spawn(process.execPath, [serverDistMain], {
      cwd: repoRoot,
      env: {
        ...process.env,
        GLOSS_FAKE_AGENT: "1",
        GLOSS_PROJECT_DIR: projectDir,
        GLOSS_PORT: String(port)
      },
      stdio: "ignore"
    });

  let child = spawnOne();
  await waitForUp(`${baseURL}/api/session`);

  return {
    baseURL,
    projectDir,
    restart: async () => {
      await killAndWait(child);
      child = spawnOne();
      await waitForUp(`${baseURL}/api/session`);
    },
    stop: async () => {
      await killAndWait(child);
      rmSync(projectDir, { recursive: true, force: true });
    }
  };
}

async function waitForUp(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) {
      throw new Error(`Gloss e2e: server at ${url} did not come up in time`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

function killAndWait(child: ChildProcess): Promise<void> {
  return new Promise((resolveDone) => {
    if (child.exitCode !== null || child.killed) {
      resolveDone();
      return;
    }
    child.once("exit", () => resolveDone());
    child.kill();
  });
}
