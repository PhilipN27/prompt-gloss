// Best-effort native notifications for companion capture/save feedback
// (TERMINAL.md §6/§8.3). This is an OUTPUT boundary: the process spawn is
// injectable for CI, while real notification-center behavior is live-smoked.

import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { Notifier, NotifyMessage } from "./types.js";

type Urgency = "low" | "normal" | "critical";

interface SpawnedProcess {
  once(event: "error", listener: (error: Error) => void): this;
  unref(): void;
}

export type NotificationSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => SpawnedProcess;

export interface OsNotifierDeps {
  /** Injectable platform and process boundary for headless command-selection tests. */
  readonly platform?: NodeJS.Platform;
  readonly spawn?: NotificationSpawn;
}

export interface NotificationPresentation {
  readonly title: string;
  readonly urgency: Urgency;
}

const realSpawn: NotificationSpawn = (command, args, options) =>
  nodeSpawn(command, [...args], options);

const detachedOptions: SpawnOptions = {
  detached: true,
  stdio: "ignore",
  windowsHide: true
};

export function notificationPresentation(kind: NotifyMessage["kind"]): NotificationPresentation {
  switch (kind) {
    case "saved":
      return { title: "Gloss — card saved", urgency: "normal" };
    case "retryable":
      return { title: "Gloss — try again", urgency: "normal" };
    case "blocked":
      return { title: "Gloss — permission needed", urgency: "critical" };
    case "unsupported":
      return { title: "Gloss — capture unavailable", urgency: "normal" };
    case "error":
      return { title: "Gloss — error", urgency: "critical" };
  }
}

function appleScriptString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "")
    .replaceAll("\n", "\\n");
}

function windowsToastScript(title: string, text: string): string {
  // Base64 keeps arbitrary selected text out of PowerShell syntax. XML escaping
  // happens inside PowerShell before the ToastGeneric document is loaded.
  const encodedTitle = Buffer.from(title, "utf8").toString("base64");
  const encodedText = Buffer.from(text, "utf8").toString("base64");
  return [
    `$title=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTitle}'))`,
    `$body=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))`,
    "$null=[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]",
    "$null=[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]",
    "$title=[Security.SecurityElement]::Escape($title)",
    "$body=[Security.SecurityElement]::Escape($body)",
    "$xml=New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$xml.LoadXml(\"<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual></toast>\")",
    "$toast=[Windows.UI.Notifications.ToastNotification]::new($xml)",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Gloss').Show($toast)"
  ].join(";");
}

function notificationCommand(
  platform: NodeJS.Platform,
  message: NotifyMessage
): { command: string; args: string[] } | null {
  const presentation = notificationPresentation(message.kind);
  switch (platform) {
    case "win32":
      return {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-Command",
          windowsToastScript(presentation.title, message.text)
        ]
      };
    case "darwin":
      return {
        command: "osascript",
        args: [
          "-e",
          `display notification "${appleScriptString(message.text)}" with title "${appleScriptString(presentation.title)}"`
        ]
      };
    case "linux":
      return {
        command: "notify-send",
        args: [
          "--app-name=Gloss",
          `--urgency=${presentation.urgency}`,
          presentation.title,
          message.text
        ]
      };
    default:
      return null;
  }
}

/** Create a Notifier whose synchronous `notify()` method never throws. */
export function createOsNotifier(
  log: (line: string) => void = () => undefined,
  deps: OsNotifierDeps = {}
): Notifier {
  const platform = deps.platform ?? process.platform;
  const spawn = deps.spawn ?? realSpawn;
  const safeLog = (line: string): void => {
    try {
      log(line);
    } catch {
      // Notifications are best effort; even a diagnostic sink cannot break flow.
    }
  };

  return {
    notify: (message: NotifyMessage) => {
      try {
        const notification = notificationCommand(platform, message);
        if (!notification) {
          safeLog(
            `[gloss companion] notifications are unavailable on ${platform}: ${message.text}`
          );
          return;
        }
        const child = spawn(notification.command, notification.args, detachedOptions);
        child.once("error", (error) => {
          safeLog(`[gloss companion] notification failed: ${error.message}`);
        });
        child.unref();
      } catch (error) {
        safeLog(`[gloss companion] notification failed: ${String(error)}`);
      }
    }
  };
}
