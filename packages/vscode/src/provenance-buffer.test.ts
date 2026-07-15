import { describe, expect, it } from "vitest";
import { buildExcerpt, RollingBuffer } from "./provenance-buffer.js";

const ESC = String.fromCharCode(27);

function excerptOf(stream: string | string[], span: string): string {
  const buffer = new RollingBuffer();
  for (const chunk of Array.isArray(stream) ? stream : [stream]) {
    buffer.append(chunk);
  }
  return buildExcerpt(buffer.toString(), span);
}

describe("provenance excerpt reconstruction", () => {
  it("preserves literal inter-word spaces", () => {
    expect(excerptOf("alpha beta gamma", "beta")).toBe("alpha beta gamma");
  });

  it("strips SGR colour codes without touching surrounding text", () => {
    expect(excerptOf(`${ESC}[31mred${ESC}[0m text`, "red")).toBe("red text");
  });

  it("reconstructs spaces the TUI encoded as cursor-forward (CUF)", () => {
    // Regression for PR #10 blocker 2: Claude's TUI positions words with
    // horizontal cursor moves, not literal spaces, so the raw stream carries no
    // 0x20 between words. Without reconstruction this collapsed to
    // "howdoesreconciliationworkinthisproject?".
    const words = ["how", "does", "reconciliation", "work", "in", "this", "project?"];
    const stream = words.join(`${ESC}[C`);
    expect(excerptOf(stream, "reconciliation")).toBe(
      "how does reconciliation work in this project?"
    );
  });

  it("reconstructs spaces encoded as cursor-horizontal-absolute (CHA)", () => {
    const stream = `left${ESC}[20Gright`;
    expect(excerptOf(stream, "right")).toBe("left right");
  });

  it("collapses consecutive reconstructed gaps into a single space", () => {
    expect(excerptOf(`a${ESC}[C${ESC}[3Cb`, "a")).toBe("a b");
  });

  it("handles an escape sequence split across shell-execution chunks", () => {
    expect(excerptOf(["how", `${ESC}`, "[Cdoes"], "does")).toBe("how does");
  });

  it("returns the matched line only, not the whole buffer", () => {
    const stream = `first line${ESC}[Cwith reconciliation\nsecond unrelated line`;
    expect(excerptOf(stream, "reconciliation")).toBe(
      "first line with reconciliation"
    );
  });

  it("returns empty string when the span is absent", () => {
    expect(excerptOf("nothing to see here", "reconciliation")).toBe("");
  });
});
