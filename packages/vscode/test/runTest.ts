import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const currentDir = fileURLToPath(new URL(".", import.meta.url));
  const extensionDevelopmentPath = resolve(currentDir, "../..");
  const extensionTestsPath = resolve(currentDir, "suite", "index.js");
  const workspacePath = await mkdtemp(resolve(tmpdir(), "gloss-vscode-test-"));

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath,
        "--disable-extensions",
        "--disable-workspace-trust",
        "--skip-release-notes",
        "--skip-welcome"
      ]
    });
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error("Failed to run VS Code extension tests", error);
  process.exitCode = 1;
});
