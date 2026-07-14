import { EventEmitter } from "node:events";
import type { SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  createOsNotifier,
  notificationPresentation,
  type NotificationSpawn
} from "../../src/companion/notifier.js";
import type { NotifyMessage } from "../../src/companion/types.js";

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

function recordingSpawn(): {
  spawn: NotificationSpawn;
  calls: SpawnCall[];
  child: EventEmitter;
} {
  const calls: SpawnCall[] = [];
  const child = new EventEmitter() as EventEmitter & { unref: () => void };
  child.unref = vi.fn();
  const spawn: NotificationSpawn = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    return child as ReturnType<NotificationSpawn>;
  };
  return { spawn, calls, child };
}

const SAVED: NotifyMessage = {
  kind: "saved",
  text: "Card 'billing' saved to .gloss/"
};

describe("createOsNotifier", () => {
  it("uses a detached PowerShell ToastGeneric notification on Windows", () => {
    const fake = recordingSpawn();
    const notifier = createOsNotifier(vi.fn(), { platform: "win32", spawn: fake.spawn });

    expect(() => notifier.notify(SAVED)).not.toThrow();

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.command).toBe("powershell.exe");
    expect(fake.calls[0]!.args).toContain("-WindowStyle");
    expect(fake.calls[0]!.args.at(-1)).toContain("ToastNotificationManager");
    expect(fake.calls[0]!.args.at(-1)).toContain(
      Buffer.from(SAVED.text, "utf8").toString("base64")
    );
    expect(fake.calls[0]!.options).toMatchObject({ detached: true, stdio: "ignore" });
  });

  it("uses osascript with escaped notification text on macOS", () => {
    const fake = recordingSpawn();
    const notifier = createOsNotifier(vi.fn(), { platform: "darwin", spawn: fake.spawn });

    notifier.notify({ kind: "retryable", text: 'Copy "this"\nthen retry' });

    expect(fake.calls[0]!.command).toBe("osascript");
    expect(fake.calls[0]!.args).toEqual([
      "-e",
      'display notification "Copy \\"this\\"\\nthen retry" with title "Gloss — try again"'
    ]);
  });

  it("uses notify-send and maps blocked feedback to critical urgency on Linux", () => {
    const fake = recordingSpawn();
    const notifier = createOsNotifier(vi.fn(), { platform: "linux", spawn: fake.spawn });

    notifier.notify({ kind: "blocked", text: "Grant Input Monitoring" });

    expect(fake.calls[0]).toMatchObject({
      command: "notify-send",
      args: [
        "--app-name=Gloss",
        "--urgency=critical",
        "Gloss — permission needed",
        "Grant Input Monitoring"
      ]
    });
  });

  it.each([
    ["saved", "Gloss — card saved", "normal"],
    ["retryable", "Gloss — try again", "normal"],
    ["blocked", "Gloss — permission needed", "critical"],
    ["unsupported", "Gloss — capture unavailable", "normal"],
    ["error", "Gloss — error", "critical"]
  ] as const)("maps %s to a sensible title and urgency", (kind, title, urgency) => {
    expect(notificationPresentation(kind)).toEqual({ title, urgency });
  });

  it("swallows a synchronous spawn failure", () => {
    const log = vi.fn();
    const spawn: NotificationSpawn = () => {
      throw new Error("no notification process");
    };
    const notifier = createOsNotifier(log, { platform: "linux", spawn });

    expect(() => notifier.notify(SAVED)).not.toThrow();
    expect(log.mock.calls.flat().join(" ")).toContain("no notification process");
  });

  it("handles an asynchronous child-process error without throwing", () => {
    const fake = recordingSpawn();
    const log = vi.fn();
    const notifier = createOsNotifier(log, { platform: "linux", spawn: fake.spawn });

    notifier.notify(SAVED);
    expect(() => fake.child.emit("error", new Error("notification service absent"))).not.toThrow();
    expect(log.mock.calls.flat().join(" ")).toContain("notification service absent");
  });

  it("degrades without spawning on an unsupported platform", () => {
    const fake = recordingSpawn();
    const log = vi.fn();
    const notifier = createOsNotifier(log, { platform: "aix", spawn: fake.spawn });

    expect(() => notifier.notify(SAVED)).not.toThrow();
    expect(fake.calls).toEqual([]);
    expect(log).toHaveBeenCalled();
  });
});
