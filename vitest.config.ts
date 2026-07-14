import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Two projects so the matcher golden-set eval is a separately-runnable gate:
//   pnpm test         -> --project unit  (colocated *.test.ts across packages)
//   pnpm eval:matcher -> --project eval  (packages/core/eval/run-eval.test.ts)
// Keeping them separate makes a matcher regression identifiable at a glance in
// the CI check list (TESTING.md).
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts"],
          environment: "node"
        }
      },
      {
        // Hook-contract suite (TESTING.md): spawns the REAL built bundle, so it
        // is not part of `pnpm test` — run via `pnpm test:hook` (builds first).
        test: {
          name: "hook",
          include: ["packages/hook/test/**/*.test.ts"],
          environment: "node",
          testTimeout: 20000
        }
      },
      {
        // CLI suite (TESTING.md "CLI tests"): temp-dir projects + fixture
        // settings files. Runs with the hook suite in the 3-OS CI job.
        // Workspace deps resolve to TS sources so the suite needs no prior
        // tsc build (CI builds only the hook bundle).
        resolve: {
          alias: {
            "@prompt-gloss/core": fileURLToPath(
              new URL("./packages/core/src/index.ts", import.meta.url)
            ),
            "@prompt-gloss/server": fileURLToPath(
              new URL("./packages/server/src/index.ts", import.meta.url)
            )
          }
        },
        test: {
          name: "cli",
          include: ["packages/cli/test/**/*.test.ts"],
          environment: "node",
          testTimeout: 20000
        }
      },
      {
        test: {
          name: "eval",
          include: ["packages/core/eval/**/*.test.ts"],
          environment: "node"
        }
      }
    ]
  }
});
