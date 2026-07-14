import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Demo-recording config — NOT part of the test suite. Runs the scripted
// walkthrough in packages/web/demo/ against the same self-contained
// fake-agent stack as the e2e config, with video capture on. Produces the
// footage for docs/demo.gif (see README).
//
// Record:   pnpm --filter @prompt-gloss/web demo:record
// Convert:  ffmpeg -i <video.webm> -vf "fps=12,scale=960:-1:flags=lanczos,palettegen" palette.png
//           ffmpeg -i <video.webm> -i palette.png -lavfi "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse" docs/demo.gif
const projectDir = mkdtempSync(join(tmpdir(), "gloss-demo-"));

export default defineConfig({
  testDir: "./demo",
  outputDir: "./test-results/demo",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1280, height: 800 },
    video: { mode: "on", size: { width: 1280, height: 800 } }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @prompt-gloss/server start",
      url: "http://127.0.0.1:4319/api/session",
      reuseExistingServer: false,
      env: { GLOSS_FAKE_AGENT: "1", GLOSS_PROJECT_DIR: projectDir }
    },
    {
      command: "pnpm --filter @prompt-gloss/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false
    }
  ]
});
