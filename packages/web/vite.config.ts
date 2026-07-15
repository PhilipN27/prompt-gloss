import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve the workspace UI package from its TS source so `pnpm dev` (and
    // `vite build`) work without a prior `tsc -b` of panel-ui. web imports
    // panel-ui at runtime (unlike the type-only core/server imports), so its
    // `dist/` would otherwise have to exist before the dev server can resolve
    // it. The exact-match regex leaves the `./card-panel.css` export subpath to
    // resolve normally (package `exports` already points it at src). tsc still
    // type-checks panel-ui via the project reference in tsconfig.json.
    alias: [
      {
        find: /^@prompt-gloss\/panel-ui$/,
        replacement: fileURLToPath(new URL("../panel-ui/src/index.ts", import.meta.url))
      }
    ]
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // The chat/card API is served by @prompt-gloss/server on 127.0.0.1:4319.
    proxy: {
      "/api": "http://127.0.0.1:4319"
    }
  }
});
