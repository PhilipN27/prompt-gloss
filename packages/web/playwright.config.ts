import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The 7 required scenarios (TESTING.md → E2E) run against a real server in
// fake-agent mode (GLOSS_FAKE_AGENT=1) plus the Vite dev server, no API key,
// no network. Previously gated behind GLOSS_E2E_FULL=1 as a placeholder while
// no specs existed; specs now exist (packages/web/e2e/), so the webServer
// block is always on. The env var is still honored (and still set by CI) so
// nothing outside this file needs to change.
const fullStack = process.env.GLOSS_E2E_FULL !== "0";

// One fresh temp project dir for the whole run, so `.gloss/` never lands
// inside the repo checkout (packages/server's cwd) and never accumulates
// stale cards across runs. Tests namespace their own card terms so they don't
// collide with each other inside this shared dir; the one scenario that needs
// to stop/restart the server (persistence-across-restart) manages its own
// second server process against its own temp dir instead of using this one.
const sharedProjectDir = fullStack ? mkdtempSync(join(tmpdir(), "gloss-e2e-")) : "";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(fullStack
    ? {
        webServer: [
          {
            command: "pnpm --filter @prompt-gloss/server start",
            url: "http://127.0.0.1:4319/api/session",
            reuseExistingServer: !process.env.CI,
            env: { GLOSS_FAKE_AGENT: "1", GLOSS_PROJECT_DIR: sharedProjectDir }
          },
          {
            command: "pnpm --filter @prompt-gloss/web dev",
            url: "http://127.0.0.1:5173",
            reuseExistingServer: !process.env.CI
          }
        ]
      }
    : {})
});
