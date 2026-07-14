// Installs the repo's git hooks into .git/hooks. Runs on `pnpm install`
// (postinstall). Zero-dep and cross-platform: it copies our tracked hook
// scripts into .git/hooks and marks them executable. Safe to run repeatedly.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(repoRoot, "scripts", "git-hooks");
const gitDir = join(repoRoot, ".git");

// Skip silently when there is no .git dir (e.g. installed as a dependency,
// or CI checkout without hooks). Hooks are a local dev convenience.
if (!existsSync(gitDir) || !existsSync(srcDir)) {
  process.exit(0);
}

const destDir = join(gitDir, "hooks");
mkdirSync(destDir, { recursive: true });

for (const name of readdirSync(srcDir)) {
  const dest = join(destDir, name);
  copyFileSync(join(srcDir, name), dest);
  try {
    chmodSync(dest, 0o755);
  } catch {
    // chmod is a no-op / may throw on some Windows setups; hook still runs
    // via the shebang under Git Bash / WSL. Ignore.
  }
}
