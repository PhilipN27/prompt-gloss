// Build the single-file CJS hook bundle (TERMINAL.md §4.4): zero runtime deps,
// CJS because gray-matter breaks ESM bundles, entry wraps an async main (no
// top-level await). @prompt-gloss/core is bundled from its TS sources so the
// bundle never depends on a prior tsc build or pnpm node_modules layout.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [join(pkgDir, "src", "main.ts")],
  outfile: join(pkgDir, "dist", "gloss-hook.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  alias: {
    "@prompt-gloss/core": join(pkgDir, "..", "core", "src", "index.ts")
  },
  logLevel: "info"
});
