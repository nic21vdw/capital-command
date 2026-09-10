import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_DESCRIPTION, DEFAULT_VIDEO_KEYWORDS } from "@/lib/video-description";

describe("DEFAULT_VIDEO_DESCRIPTION", () => {
  it("uses the current broad CoLateral description and real links", () => {
    expect(DEFAULT_VIDEO_DESCRIPTION).toContain("desktop agentic workspace");
    expect(DEFAULT_VIDEO_DESCRIPTION).toContain("developers, creators and engineers");
    expect(DEFAULT_VIDEO_DESCRIPTION).toContain("https://colateralai.com");
    expect(DEFAULT_VIDEO_DESCRIPTION).toContain("https://www.youtube.com/@nicvandewetering");
    expect(DEFAULT_VIDEO_DESCRIPTION).toContain("https://x.com/nic21vdw");
    expect(DEFAULT_VIDEO_DESCRIPTION).not.toMatch(/structural engineer/i);
    expect(DEFAULT_VIDEO_KEYWORDS).toContain("Codex");
    expect(DEFAULT_VIDEO_KEYWORDS).toContain("project canvas");
  });
});
