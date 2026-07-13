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
        test: {
          name: "eval",
          include: ["packages/core/eval/**/*.test.ts"],
          environment: "node"
        }
      }
    ]
  }
});
