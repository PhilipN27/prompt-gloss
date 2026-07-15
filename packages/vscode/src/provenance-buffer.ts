// Pure (vscode-free) terminal-output buffering and excerpt extraction for
// provenance. Kept independent of the `vscode` module so the stripper and
// excerpt logic can be unit-tested with vitest — the extension host is not
// available in `pnpm test`, and the stripper is the part most worth testing.

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

export class RollingBuffer {
  private readonly chunks: string[] = [];
  private readonly controlStripper = new TerminalControlStripper();
  private sizeBytes = 0;

  append(chunk: string): void {
    chunk = this.controlStripper.write(chunk);
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

type StripState =
  | "text"
  | "escape"
  | "escape-intermediate"
  | "csi"
  | "osc"
  | "osc-escape"
  | "control-string"
  | "control-string-escape";

/**
 * Stateful because shell-execution chunks can split an ANSI sequence.
 *
 * Horizontal cursor-advance sequences (CUF `CSI…C`, CHA `CSI…G`) are emitted
 * as a single space: full-screen TUIs (Claude Code's Ink renderer among them)
 * position words with cursor movement instead of literal spaces, so dropping
 * the sequence outright collapses "how does work" into "howdoeswork". A lone
 * space is the readable, best-effort reconstruction of the gap; consecutive
 * spaces are collapsed downstream in {@link buildExcerpt}.
 */
class TerminalControlStripper {
  private state: StripState = "text";

  write(chunk: string): string {
    let rendered = "";

    for (const character of chunk) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) continue;

      switch (this.state) {
        case "text":
          if (codePoint === 0x1b) {
            this.state = "escape";
          } else if (codePoint === 0x9b) {
            this.state = "csi";
          } else if (codePoint === 0x9d) {
            this.state = "osc";
          } else if (
            codePoint === 0x90 ||
            codePoint === 0x98 ||
            codePoint === 0x9e ||
            codePoint === 0x9f
          ) {
            this.state = "control-string";
          } else if (
            character === "\n" ||
            character === "\r" ||
            character === "\t" ||
            (codePoint >= 0x20 && codePoint !== 0x7f && codePoint < 0x80) ||
            codePoint > 0x9f
          ) {
            rendered += character;
          }
          break;
        case "escape":
          if (character === "[") {
            this.state = "csi";
          } else if (character === "]") {
            this.state = "osc";
          } else if (
            character === "P" ||
            character === "X" ||
            character === "^" ||
            character === "_"
          ) {
            this.state = "control-string";
          } else if (codePoint >= 0x20 && codePoint <= 0x2f) {
            this.state = "escape-intermediate";
          } else if (codePoint === 0x1b) {
            this.state = "escape";
          } else {
            this.state = "text";
          }
          break;
        case "escape-intermediate":
          if (codePoint >= 0x30 && codePoint <= 0x7e) this.state = "text";
          else if (codePoint === 0x1b) this.state = "escape";
          break;
        case "csi":
          if (codePoint >= 0x40 && codePoint <= 0x7e) {
            this.state = "text";
            // CUF (cursor forward) and CHA (cursor horizontal absolute) advance
            // the cursor without drawing — a TUI's stand-in for whitespace.
            if (character === "C" || character === "G") rendered += " ";
          } else if (codePoint === 0x1b) {
            this.state = "escape";
          }
          break;
        case "osc":
          if (codePoint === 0x07 || codePoint === 0x9c) this.state = "text";
          else if (codePoint === 0x1b) this.state = "osc-escape";
          break;
        case "osc-escape":
          if (character === "\\" || codePoint === 0x9c) this.state = "text";
          else if (codePoint !== 0x1b) this.state = "osc";
          break;
        case "control-string":
          if (codePoint === 0x9c) this.state = "text";
          else if (codePoint === 0x1b) this.state = "control-string-escape";
          break;
        case "control-string-escape":
          if (character === "\\" || codePoint === 0x9c) this.state = "text";
          else if (codePoint !== 0x1b) this.state = "control-string";
      }
    }

    return rendered;
  }
}

function firstLineBreakAfter(value: string, from: number): number {
  const newline = value.indexOf("\n", from);
  const carriageReturn = value.indexOf("\r", from);
  if (newline === -1) return carriageReturn;
  if (carriageReturn === -1) return newline;
  return Math.min(newline, carriageReturn);
}

/** Collapse runs of inline spaces/tabs to one so reconstructed gaps read cleanly. */
function collapseInlineWhitespace(value: string): string {
  return value.replace(/[ \t]{2,}/g, " ").trim();
}

function truncateAroundMatch(value: string, matchStart: number, spanLength: number): string {
  const characters = [...value];
  if (characters.length <= EXCERPT_MAX_CHARS) return collapseInlineWhitespace(value);

  const matchStartInCodePoints = [...value.slice(0, matchStart)].length;
  const spanLengthInCodePoints = [
    ...value.slice(matchStart, matchStart + spanLength)
  ].length;
  const visibleSpanLength = Math.min(spanLengthInCodePoints, EXCERPT_MAX_CHARS);
  const surroundingChars = EXCERPT_MAX_CHARS - visibleSpanLength;
  const preferredStart = matchStartInCodePoints - Math.floor(surroundingChars / 2);
  const excerptStart = Math.min(
    Math.max(0, preferredStart),
    characters.length - EXCERPT_MAX_CHARS
  );
  return collapseInlineWhitespace(
    characters.slice(excerptStart, excerptStart + EXCERPT_MAX_CHARS).join("")
  );
}

/**
 * Extract a single-line, ≤200-char excerpt of `contents` centred on the last
 * occurrence of `span`. Returns "" when the span is absent. Pure — the
 * vscode-bound freshness/guard checks live in `ProvenanceTracker.excerptFor`.
 */
export function buildExcerpt(contents: string, span: string): string {
  if (span.length === 0) return "";

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
