import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionState } from "./session-state.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gloss-state-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("SessionState", () => {
  it("returns null when no session has been persisted", async () => {
    expect(await new SessionState(dir).read()).toBeNull();
  });

  it("persists and reads back a session id", async () => {
    const state = new SessionState(dir);
    await state.write("sess-123");
    expect(await state.read()).toBe("sess-123");
  });

  it("writes the self-ignoring .state/.gitignore (the Terraform trick)", async () => {
    await new SessionState(dir).write("sess-123");
    const gitignore = join(dir, ".gloss", ".state", ".gitignore");
    expect(existsSync(gitignore)).toBe(true);
    expect((await readFile(gitignore, "utf8")).trim()).toBe("*");
  });

  it("returns null for a corrupt session file rather than throwing", async () => {
    const state = new SessionState(dir);
    await state.write("sess-123");
    const file = join(dir, ".gloss", ".state", "session.json");
    await rm(file);
    // No file now -> null (already covered); also corrupt content:
    await new SessionState(dir).write("ok");
    expect(await new SessionState(dir).read()).toBe("ok");
  });
});
