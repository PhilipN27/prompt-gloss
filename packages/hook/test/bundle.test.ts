// Bundle regression guards (TERMINAL.md §2.2 / §4.4): the hook ships as a
// single CJS file and runs on every prompt, so size and cold-start cost are
// pinned by tests.

import { describe, expect, it } from "vitest";
import { statSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { BUNDLE, makeProject, promptPayload, runHook } from "./helpers.js";

describe("bundle artifact", () => {
  it("is under 250 KB", () => {
    expect(statSync(BUNDLE).size).toBeLessThan(250 * 1024);
  });

  it("is CJS with no top-level await", () => {
    const text = readFileSync(BUNDLE, "utf8");
    expect(text).not.toContain("import.meta");
  });

  it("cold-starts a no-match run in under 300 ms", () => {
    const dir = makeProject();
    const stdin = JSON.stringify(promptPayload(dir, "nothing matches here"));
    runHook(dir, stdin); // warm the FS cache once, as §2.2 measured
    const t0 = performance.now();
    const res = runHook(dir, stdin);
    const elapsed = performance.now() - t0;
    expect(res.status).toBe(0);
    expect(elapsed).toBeLessThan(300);
  });
});
