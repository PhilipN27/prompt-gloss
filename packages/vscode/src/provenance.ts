import * as vscode from "vscode";
import { buildExcerpt, RollingBuffer } from "./provenance-buffer.js";

/** Tracks recent shell-execution output independently for each terminal. */
export class ProvenanceTracker implements vscode.Disposable {
  private readonly buffers = new Map<vscode.Terminal, RollingBuffer>();
  private readonly closedTerminals = new WeakSet<vscode.Terminal>();
  private disposed = false;

  public constructor(context: vscode.ExtensionContext) {
    const executionSubscription = vscode.window.onDidStartTerminalShellExecution((event) => {
      void this.consumeExecution(event.terminal, event.execution);
    });
    const closeSubscription = vscode.window.onDidCloseTerminal((terminal) => {
      this.closedTerminals.add(terminal);
      this.buffers.delete(terminal);
    });

    context.subscriptions.push(executionSubscription, closeSubscription, this);
  }

  private async consumeExecution(
    terminal: vscode.Terminal,
    execution: vscode.TerminalShellExecution
  ): Promise<void> {
    try {
      for await (const chunk of execution.read()) {
        if (this.disposed || this.closedTerminals.has(terminal)) return;
        let buffer = this.buffers.get(terminal);
        if (buffer === undefined) {
          buffer = new RollingBuffer();
          this.buffers.set(terminal, buffer);
        }
        buffer.append(chunk);
      }
    } catch {
      // Provenance is best-effort and must never block card capture.
    }
  }

  public excerptFor(terminal: vscode.Terminal | undefined, span: string): string {
    if (this.disposed || terminal?.shellIntegration === undefined || span.length === 0) {
      return "";
    }

    const contents = this.buffers.get(terminal)?.toString();
    if (contents === undefined) return "";

    if (process.env.GLOSS_PROVENANCE_DEBUG === "1") {
      // Ground-truth capture for refining the control stripper: dumps the
      // post-strip ring buffer so a live smoke can confirm exactly how the TUI
      // encodes inter-word spacing. Best-effort; never blocks capture.
      try {
        console.log(`[gloss:provenance] span=${JSON.stringify(span)} buffer=${JSON.stringify(contents)}`);
      } catch {
        // ignore
      }
    }

    return buildExcerpt(contents, span);
  }

  public dispose(): void {
    this.disposed = true;
    this.buffers.clear();
  }
}
