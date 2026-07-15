// The companion project-picker reads ~/.gloss/projects.json (written by
// `init`, TERMINAL.md §8.2/§9.1). The reader must faithfully return the
// recorded project dirs and never throw on a missing or malformed registry —
// a broken file must degrade to "no projects", not crash the daemon.

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectRegistry } from "../../src/companion/project-registry.js";

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), "gloss-home-"));
}

function writeRegistry(home: string, contents: string): void {
  mkdirSync(join(home, ".gloss"), { recursive: true });
  writeFileSync(join(home, ".gloss", "projects.json"), contents);
}

describe("readProjectRegistry", () => {
  it("returns an empty list when the registry file is absent", () => {
    expect(readProjectRegistry(makeHome())).toEqual([]);
  });

  it("returns the recorded project dirs in stored order", () => {
    const home = makeHome();
    writeRegistry(home, JSON.stringify({ version: 1, projects: ["/proj/a", "/proj/b"] }));
    expect(readProjectRegistry(home)).toEqual(["/proj/a", "/proj/b"]);
  });

  it("returns an empty list on malformed JSON without throwing", () => {
    const home = makeHome();
    writeRegistry(home, "{ this is not json");
    expect(readProjectRegistry(home)).toEqual([]);
  });

  it("returns an empty list when `projects` is not an array", () => {
    const home = makeHome();
    writeRegistry(home, JSON.stringify({ version: 1, projects: "nope" }));
    expect(readProjectRegistry(home)).toEqual([]);
  });

  it("drops non-string entries defensively", () => {
    const home = makeHome();
    writeRegistry(home, JSON.stringify({ version: 1, projects: ["/proj/a", 42, null, "/proj/b"] }));
    expect(readProjectRegistry(home)).toEqual(["/proj/a", "/proj/b"]);
  });
});
