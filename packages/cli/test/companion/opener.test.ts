import { EventEmitter } from "node:events";
import type { SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  createAppModeOpener,
  type BrowserSpawn
} from "../../src/companion/opener.js";

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

type Outcome = "spawn" | "error";

function scriptedSpawn(outcomes: readonly Outcome[]): {
  spawn: BrowserSpawn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawn: BrowserSpawn = (command, args, options) => {
    const outcome = outcomes[calls.length] ?? "spawn";
    calls.push({ command, args: [...args], options });
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    queueMicrotask(() => {
      if (outcome === "spawn") child.emit("spawn");
      else child.emit("error", new Error(`${command} missing`));
    });
    return child as ReturnType<BrowserSpawn>;
  };
  return { spawn, calls };
}

const URL = "http://127.0.0.1:53187/panel?span=billing+engine&origin=companion";

describe("createAppModeOpener", () => {
  it("launches Chrome in a detached app-mode window first", async () => {
    const fake = scriptedSpawn(["spawn"]);
    const opener = createAppModeOpener(vi.fn(), { platform: "linux", spawn: fake.spawn });

    await opener.open(URL);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      command: "chrome",
      args: [`--app=${URL}`],
      options: { detached: true, stdio: "ignore", windowsHide: true }
    });
  });

  it("tries Edge app mode when Chrome is not installed", async () => {
    const fake = scriptedSpawn(["error", "spawn"]);
    const opener = createAppModeOpener(vi.fn(), { platform: "win32", spawn: fake.spawn });

    await opener.open(URL);

    expect(fake.calls.map((call) => call.command)).toEqual(["chrome", "msedge"]);
    expect(fake.calls[1]!.args).toEqual([`--app=${URL}`]);
  });

  it.each([
    // win32: explorer.exe takes the URL as a single argv (no cmd reparse), so
    // the `&` separators and `%` encoding survive verbatim (break-it F1).
    ["win32", "explorer.exe", [URL]],
    ["darwin", "open", [URL]],
    ["linux", "xdg-open", [URL]]
  ] as const)(
    "uses the %s default-browser fallback after both app browsers are missing",
    async (platform, fallbackCommand, fallbackArgs) => {
      const fake = scriptedSpawn(["error", "error", "spawn"]);
      const opener = createAppModeOpener(vi.fn(), { platform, spawn: fake.spawn });

      await opener.open(URL);

      expect(fake.calls.map((call) => call.command)).toEqual([
        "chrome",
        "msedge",
        fallbackCommand
      ]);
      expect(fake.calls[2]!.args).toEqual(fallbackArgs);
    }
  );

  it("resolves and logs the URL when app-mode and fallback launchers are missing", async () => {
    const fake = scriptedSpawn(["error", "error", "error"]);
    const log = vi.fn();
    const opener = createAppModeOpener(log, { platform: "linux", spawn: fake.spawn });

    await expect(opener.open(URL)).resolves.toBeUndefined();
    expect(log.mock.calls.flat().join(" ")).toContain(URL);
  });
});
