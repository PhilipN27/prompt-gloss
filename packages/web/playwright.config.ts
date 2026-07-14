import { defineConfig, devices } from "@playwright/test";

// Placeholder e2e config. The highlight-interaction scenarios (TESTING.md) are
// authored in the web/UI track. This config is pre-wired for the required
// self-contained setup: the `webServer` block launches the Gloss server in
// fake-agent mode plus the Vite dev server so `pnpm test:e2e` needs no API key.
//
// Until real specs exist, `webServer` is gated behind GLOSS_E2E_FULL=1 so that
// `pnpm test:e2e` is a fast green no-op (Playwright treats an empty test match
// as a pass) rather than hanging while it waits for a server that the UI track
// has not finished yet. The UI track sets GLOSS_E2E_FULL=1 (and CI does too)
// once the scenarios land.
const fullStack = process.env.GLOSS_E2E_FULL === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
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
            env: { GLOSS_FAKE_AGENT: "1" }
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
