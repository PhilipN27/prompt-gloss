// Embed the hook bundle in the CLI's dist so the published package is
// self-contained (TERMINAL.md §10): `init` copies dist/gloss-hook.cjs into the
// user's project. In the monorepo it is taken from packages/hook's build.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
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
