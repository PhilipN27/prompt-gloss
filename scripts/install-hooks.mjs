// Installs the repo's git hooks into the repo's hooks directory. Runs on
// `pnpm install` (postinstall). Zero-dep and cross-platform: it copies our
// tracked hook scripts into the git hooks dir and marks them executable. Safe
// to run repeatedly.
//
// This is a LOCAL DEV CONVENIENCE — it must never fail the install. Worktrees,
// CI checkouts, sandboxes and dependency installs all degrade to a silent skip.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const srcDir = join(repoRoot, "scripts", "git-hooks");
  const gitEntry = join(repoRoot, ".git");

  // Skip silently when there is no .git (installed as a dependency, or a CI
  // checkout without hooks) or when there are no hook sources to install.
  if (!existsSync(gitEntry) || !existsSync(srcDir)) {
    process.exit(0);
  }

  // Resolve the real hooks directory. In a normal checkout `.git` is a
  // directory and `.git/hooks` is correct; in a worktree `.git` is a FILE
  // pointing at the gitdir, so `.git/hooks` does not exist (mkdir would throw
  // ENOTDIR). `git rev-parse --git-path hooks` returns the right location in
  // both cases (worktrees share the common hooks dir).
  let destDir;
  try {
    const gitPath = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd: repoRoot,
      encoding: "utf8"
    }).trim();
    destDir = resolve(repoRoot, gitPath);
  } catch {
    destDir = join(gitEntry, "hooks");
  }

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
} catch (err) {
  // Never fail `pnpm install` for a dev-convenience hook install.
  console.warn(`[install-hooks] skipped: ${err?.message ?? err}`);
  process.exit(0);
}
