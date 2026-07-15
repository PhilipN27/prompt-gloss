// The OS-agnostic capture flow (TERMINAL.md §8.2/§8.3). Every OS adapter feeds
// the SAME flow: on a hotkey it captures the selection, then either toasts a
// recoverable/blocked/unsupported outcome or opens the panel window at a URL
// carrying the span + `origin=companion`. Separately, when the embedded server
// reports a card was saved, it fires an OS notification.
//
// The flow NEVER throws out of `onHotkey` — a capture failure must never crash
// the daemon (mirrors the hook's never-break-the-prompt policy, §4.4). It also
// drops re-entrant presses while a capture is in flight, so a user leaning on
// the hotkey opens one panel, not ten.

import { COMPANION_ORIGIN, type CardSavedEvent } from "./types.js";
import type {
  Notifier,
  PanelEndpoints,
  PanelOpener,
  ProjectResolution,
  ProjectResolver,
  SelectionSource
} from "./types.js";

export interface CaptureFlowDeps {
  readonly selection: SelectionSource;
  readonly projects: ProjectResolver;
  readonly opener: PanelOpener;
  readonly notifier: Notifier;
  readonly endpoints: PanelEndpoints;
  readonly log?: (line: string) => void;
}

export class CaptureFlow {
  private capturing = false;

  constructor(private readonly deps: CaptureFlowDeps) {}

  /** Handle one global hotkey press. Resolves (never rejects) once the panel is
   *  opened or the outcome has been toasted. */
  async onHotkey(): Promise<void> {
    if (this.capturing) return; // a capture is already in flight — drop this press
    this.capturing = true;
    try {
      const result = await this.deps.selection.capture();
      switch (result.status) {
        case "ok": {
          const target = await this.deps.projects.resolve();
          await this.deps.opener.open(this.buildUrl(target, result.text));
          return;
        }
        case "retryable":
          this.deps.notifier.notify({ kind: "retryable", text: result.hint });
          return;
        case "blocked":
          this.deps.notifier.notify({
            kind: "blocked",
            text: result.restartRequired
              ? `${result.remediation} Then restart the companion.`
              : result.remediation
          });
          return;
        case "unsupported":
          this.deps.notifier.notify({
            kind: "unsupported",
            text: `Highlight capture isn't available here (${result.reason}). Use \`prompt-gloss add\` instead.`
          });
          return;
      }
    } catch (err) {
      this.deps.log?.(`companion capture error: ${String(err)}`);
      this.deps.notifier.notify({
        kind: "error",
        text: "Gloss couldn't capture the selection. See `prompt-gloss doctor`."
      });
    } finally {
      this.capturing = false;
    }
  }

  /** Fired by the embedded server when a card is created or updated (§6/§8.3). */
  onCardSaved(event: CardSavedEvent): void {
    this.deps.notifier.notify({
      kind: "saved",
      text: `Card '${event.card.term}' saved to .gloss/`
    });
  }

  private buildUrl(target: ProjectResolution, span: string): string {
    const { baseUrl, panelPath, pickerPath } = this.deps.endpoints;
    const isPicker = target.kind === "picker";
    const params = new URLSearchParams({ span, origin: COMPANION_ORIGIN });
    if (isPicker) params.set("pick", "1");
    return `${baseUrl}${isPicker ? pickerPath : panelPath}?${params.toString()}`;
  }
}
