// §4.5 coexistence contract (TERMINAL.md, Phase 0 finding): the SDK session
// must arm GLOSS_SKIP_HOOK=1 via Options.env (which REPLACES the subprocess
// env — so the parent env must be spread in) and keep filesystem settings
// loaded explicitly. These tests pin the pure options builder; the hook's side
// of the contract is pinned by the built-bundle suite (packages/hook).

import { describe, expect, it } from "vitest";
import { buildSessionOptions } from "./sdk-injector.js";

const noopHook = async () => ({});

function build(overrides: Partial<Parameters<typeof buildSessionOptions>[0]> = {}) {
  return buildSessionOptions({
    projectDir: "/tmp/proj",
    userPromptSubmitHook: noopHook,
    resumeSessionId: null,
    parentEnv: { PATH: "/usr/bin", HOME: "/home/u", ANTHROPIC_API_KEY: "sk-test" },
    ...overrides
  });
}

describe("buildSessionOptions — GLOSS_SKIP_HOOK arming (TERMINAL.md §4.5)", () => {
  it("sets GLOSS_SKIP_HOOK=1 in the session env", () => {
    expect(build().env?.GLOSS_SKIP_HOOK).toBe("1");
  });

  it("spreads the parent env (Options.env replaces, not merges)", () => {
    const env = build().env!;
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-test");
  });

  it("never mutates the parent env object (or process.env)", () => {
    const parentEnv = { PATH: "/usr/bin" };
    const before = process.env.GLOSS_SKIP_HOOK;
    buildSessionOptions({
      projectDir: "/tmp/proj",
      userPromptSubmitHook: noopHook,
      resumeSessionId: null,
      parentEnv
    });
    expect(parentEnv).toEqual({ PATH: "/usr/bin" });
    expect(process.env.GLOSS_SKIP_HOOK).toBe(before);
  });

  it("keeps filesystem settings enabled explicitly (settingSources)", () => {
    expect(build().settingSources).toEqual(["user", "project", "local"]);
  });

  it("preserves the v1 session shape: cwd, systemPrompt append, hook, resume", () => {
    const fresh = build();
    expect(fresh.cwd).toBe("/tmp/proj");
    expect(fresh.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" });
    expect(fresh.hooks?.UserPromptSubmit).toHaveLength(1);
    expect(fresh.resume).toBeUndefined();

    const resumed = build({ resumeSessionId: "sess-123" });
    expect(resumed.resume).toBe("sess-123");
  });
});
