// Strict argv parsing (Codex review round 2): a typo must never silently
// perform a real install, and a value flag must never swallow another flag.

import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "gloss-cli-"));
}

describe("cli argv strictness", () => {
  it("rejects unknown flags instead of ignoring them", async () => {
    const dir = makeProject();
    await expect(main(["init", "--dryrun", "--project", dir])).rejects.toThrow(/unknown option/);
    expect(existsSync(join(dir, ".gloss"))).toBe(false); // no real install happened
  });

  it("rejects a value flag followed by another flag", async () => {
    const dir = makeProject();
    await expect(
      main(["init", "--settings-file", "--dry-run", "--project", dir])
    ).rejects.toThrow(/requires a value/);
    expect(existsSync(join(dir, ".gloss"))).toBe(false);
  });

  it("rejects unknown commands with usage", async () => {
    await expect(main(["frobnicate"])).rejects.toThrow(/unknown command/);
  });

  it("validates numeric options", async () => {
    const dir = makeProject();
    await expect(main(["log", "-n", "garbage", "--project", dir])).rejects.toThrow(
      /positive integer/
    );
    await expect(main(["web", "--port", "-5", "--project", dir])).rejects.toThrow(
      /requires a value|positive integer/
    );
  });

  it("accepts hyphen-leading values that are not known flags", async () => {
    const dir = makeProject();
    await main(["add", "xyz", "--body", "- a bullet body", "--project", dir]);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(dir, ".gloss", "cards", "xyz.md"), "utf8")).toContain(
      "- a bullet body"
    );
  });

  it("rejects multiple body sources for add", async () => {
    const dir = makeProject();
    await expect(
      main(["add", "xyz", "--body", "a", "--body-file", "f.txt", "--project", dir])
    ).rejects.toThrow(/only one of/);
  });

  it("prints usage for help and no-args", async () => {
    expect(await main([])).toBe(0);
    expect(await main(["help"])).toBe(0);
  });
});
