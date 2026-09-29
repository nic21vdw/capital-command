import { describe, expect, it } from "vitest";
import { runPreviews } from "@/lib/pipeline/previews";

const clip = (file?: string) => ({ file }) as never;

describe("runPreviews", () => {
  it("uses the long-form frame as the poster once a project exists", () => {
    const previews = runPreviews({ projectId: "p1", job: { id: "j1", clips: [clip("a.mp4")] } });
    expect(previews.poster).toBe("/api/longform/projects/p1/poster");
  });

  it("falls back to the first clip frame before there is a project", () => {
    const previews = runPreviews({ job: { id: "j1", clips: [clip("a b.mp4")] } });
    expect(previews.poster).toBe("/api/clips/j1/thumbnail/a%20b.mp4");
  });

  it("has no poster when nothing has rendered yet", () => {
    expect(runPreviews({}).poster).toBeUndefined();
  });

  it("skips clips with no file and caps the strip at four", () => {
    const clips = [clip(undefined), ...["1", "2", "3", "4", "5"].map((n) => clip(`${n}.mp4`))];
    const previews = runPreviews({ job: { id: "j", clips } });
    expect(previews.clips).toEqual([1, 2, 3, 4].map((n) => `/api/clips/j/thumbnail/${n}.mp4`));
  });

  it("keeps the first three non-empty slide headings, tidied and trimmed", () => {
    const previews = runPreviews({
      slides: [{ heading: "  One\n line " }, { heading: "" }, { heading: "Two" }, { heading: "Three" }, { heading: "Four" }]
    });
    expect(previews.slides).toEqual(["One line", "Two", "Three"]);
    expect(runPreviews({ slides: [{ heading: "x".repeat(200) }] }).slides[0]).toHaveLength(72);
  });
});
