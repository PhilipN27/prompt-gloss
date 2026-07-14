// Build both VS Code extension artifacts from TypeScript source. Workspace
// packages are aliased to source, matching the hook bundle convention, so the
// extension does not depend on prebuilt sibling packages or project installs.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(fileURLToPath(import.meta.url));

await Promise.all([
  build({
    entryPoints: [join(pkgDir, "src", "extension.ts")],
    outfile: join(pkgDir, "dist", "extension.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    alias: {
      "@prompt-gloss/core": join(pkgDir, "..", "core", "src", "index.ts")
    },
    logLevel: "info"
  }),
  build({
    entryPoints: [join(pkgDir, "src", "webview", "index.tsx")],
    outfile: join(pkgDir, "dist", "webview.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    alias: {
      "@prompt-gloss/panel-ui": join(pkgDir, "..", "panel-ui", "src", "index.ts"),
      "@prompt-gloss/panel-ui/card-panel.css": join(
        pkgDir,
        "..",
        "panel-ui",
        "src",
        "card-panel.css"
      )
    },
    logLevel: "info"
  })
]);
