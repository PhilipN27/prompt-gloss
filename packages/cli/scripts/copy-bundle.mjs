// Embed the hook bundle in the CLI's dist so the published package is
// self-contained (TERMINAL.md §10): `init` copies dist/gloss-hook.cjs into the
// user's project. In the monorepo it is taken from packages/hook's build.
import { copyFileSync, cpSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(pkgDir, "..", "hook", "dist", "gloss-hook.cjs");
if (!existsSync(source)) {
  console.error("[copy-bundle] hook bundle missing — run `pnpm --filter @prompt-gloss/hook build` first");
  process.exit(1);
}
mkdirSync(join(pkgDir, "dist"), { recursive: true });
copyFileSync(source, join(pkgDir, "dist", "gloss-hook.cjs"));

// Ship the built web UI too (served by `prompt-gloss web`). Best-effort: the
// UI may not be built in hook/CLI-only CI jobs — the command warns at runtime.
const webDist = join(pkgDir, "..", "web", "dist");
if (existsSync(join(webDist, "index.html"))) {
  cpSync(webDist, join(pkgDir, "dist", "web"), { recursive: true });
}
