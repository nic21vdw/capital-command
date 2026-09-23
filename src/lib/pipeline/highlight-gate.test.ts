import { describe, expect, it } from "vitest";
import { longformExportGate } from "@/lib/pipeline/highlight-gate";

const base = {
  editedSec: 2 * 60 * 60,
  targetSec: 20 * 60,
  hasHighlight: false,
  highlightTried: false,
  transcriptReady: true,
  transcriptPending: false
};

describe("longformExportGate", () => {
  it("cuts a two-hour stream down before it renders", () => {
    expect(longformExportGate(base)).toBe("build");
  });

  it("renders an edit that is already about the target length as it is", () => {
    expect(longformExportGate({ ...base, editedSec: 22 * 60 })).toBe("export");
  });

  it("waits for the whole-stream transcript while the clip job is still writing it", () => {
    expect(longformExportGate({ ...base, transcriptReady: false, transcriptPending: true })).toBe("wait");
  });

  it("falls back to the whole edit when no transcript is coming", () => {
    expect(longformExportGate({ ...base, transcriptReady: false, transcriptPending: false })).toBe("export");
  });

  it("renders once an edit exists or the build was already tried", () => {
    expect(longformExportGate({ ...base, hasHighlight: true })).toBe("export");
    expect(longformExportGate({ ...base, highlightTried: true })).toBe("export");
  });
});
