import { describe, expect, it } from "vitest";
import { resolveCaptureSpan } from "./capture-span.js";

describe("resolveCaptureSpan", () => {
  it("prefers a native terminal selection when present", () => {
    expect(
      resolveCaptureSpan({ nativeSelection: "reconciliation", clipboard: "stale" })
    ).toBe("reconciliation");
  });

  it("falls back to the clipboard when there is no native selection (Claude mouse-mode path)", () => {
    expect(
      resolveCaptureSpan({ nativeSelection: "", clipboard: "reconciliation" })
    ).toBe("reconciliation");
  });

  it("treats a whitespace-only native selection as empty and uses the clipboard", () => {
    expect(
      resolveCaptureSpan({ nativeSelection: "   \n", clipboard: "invoice matching" })
    ).toBe("invoice matching");
  });

  it("trims both sources", () => {
    expect(resolveCaptureSpan({ nativeSelection: "  spanned  ", clipboard: "" })).toBe(
      "spanned"
    );
    expect(resolveCaptureSpan({ nativeSelection: "", clipboard: "  clipped  " })).toBe(
      "clipped"
    );
  });

  it("returns null only when both sources are empty", () => {
    expect(resolveCaptureSpan({ nativeSelection: "", clipboard: "" })).toBeNull();
    expect(resolveCaptureSpan({ nativeSelection: "  ", clipboard: "\t\n" })).toBeNull();
  });
});
