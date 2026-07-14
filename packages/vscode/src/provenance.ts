import * as vscode from "vscode";

const BUFFER_MAX_BYTES = 32 * 1024;
const EXCERPT_MAX_CHARS = 200;
const encoder = new TextEncoder();

function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

function suffixWithinBytes(value: string, maxBytes: number): string {
  const characters = [...value];
  let usedBytes = 0;
  let start = characters.length;

  while (start > 0) {
    const character = characters[start - 1];
    if (character === undefined) break;
    const characterBytes = utf8Length(character);
    if (usedBytes + characterBytes > maxBytes) break;
    usedBytes += characterBytes;
    start -= 1;
  }

  return characters.slice(start).join("");
}

class RollingBuffer {
  private readonly chunks: string[] = [];
  private sizeBytes = 0;

  append(chunk: string): void {
    if (chunk.length === 0) return;

    this.chunks.push(chunk);
    this.sizeBytes += utf8Length(chunk);

    while (this.sizeBytes > BUFFER_MAX_BYTES) {
      const oldest = this.chunks[0];
      if (oldest === undefined) {
        this.sizeBytes = 0;
        return;
      }

      const oldestBytes = utf8Length(oldest);
      const excessBytes = this.sizeBytes - BUFFER_MAX_BYTES;
      if (oldestBytes <= excessBytes) {
        this.chunks.shift();
        this.sizeBytes -= oldestBytes;
        continue;
      }

      const replacement = suffixWithinBytes(oldest, oldestBytes - excessBytes);
      this.chunks[0] = replacement;
      this.sizeBytes = this.sizeBytes - oldestBytes + utf8Length(replacement);
    }
  }

  toString(): string {
    return this.chunks.join("");
  }
}

function firstLineBreakAfter(value: string, from: number): number {
  const newline = value.indexOf("\n", from);
  const carriageReturn = value.indexOf("\r", from);
  if (newline === -1) return carriageReturn;
  if (carriageReturn === -1) return newline;
  return Math.min(newline, carriageReturn);
}

function truncateAroundMatch(value: string, matchStart: number, spanLength: number): string {
  if (value.length <= EXCERPT_MAX_CHARS) return value.trim();

  const visibleSpanLength = Math.min(spanLength, EXCERPT_MAX_CHARS);
  const surroundingChars = EXCERPT_MAX_CHARS - visibleSpanLength;
  const preferredStart = matchStart - Math.floor(surroundingChars / 2);
  const excerptStart = Math.min(
    Math.max(0, preferredStart),
    value.length - EXCERPT_MAX_CHARS
  );
  return value.slice(excerptStart, excerptStart + EXCERPT_MAX_CHARS).trim();
}

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

    const matchStart = contents.lastIndexOf(span);
    if (matchStart === -1) return "";

    const previousNewline = contents.lastIndexOf("\n", matchStart - 1);
    const previousCarriageReturn = contents.lastIndexOf("\r", matchStart - 1);
    const lineStart = Math.max(previousNewline, previousCarriageReturn) + 1;
    const matchEnd = matchStart + span.length;
    const nextLineBreak = firstLineBreakAfter(contents, matchEnd);
    const lineEnd = nextLineBreak === -1 ? contents.length : nextLineBreak;
    const lines = contents.slice(lineStart, lineEnd);

    return truncateAroundMatch(lines, matchStart - lineStart, span.length);
  }

  public dispose(): void {
    this.disposed = true;
    this.buffers.clear();
  }
}
