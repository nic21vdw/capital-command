import { describe, expect, it } from "vitest";
import { videoIdFromUrl } from "@/lib/ingest/pipelineClient";

/**
 * Source URLs come from whatever was pasted into the pipeline by hand, so this
 * parses real links rather than canonical ones. A miss here is expensive: the
 * scan fails to recognise a stream it already took in and downloads it again.
 */
describe("videoIdFromUrl", () => {
  it("reads the shapes a pasted link actually has", () => {
    const cases: [string, string][] = [
      ["https://www.youtube.com/watch?v=-IEYLGdGpp4", "-IEYLGdGpp4"],
      // The one that was actually in the pipeline — note the timestamp.
      ["https://www.youtube.com/watch?v=-IEYLGdGpp4&t=5571s", "-IEYLGdGpp4"],
      ["https://youtube.com/watch?v=abc123", "abc123"],
      ["https://m.youtube.com/watch?v=abc123", "abc123"],
      ["https://youtu.be/abc123", "abc123"],
      ["https://youtu.be/abc123?si=xyz", "abc123"],
      ["https://www.youtube.com/live/abc123", "abc123"],
      ["https://www.youtube.com/shorts/abc123", "abc123"],
      ["https://www.youtube.com/embed/abc123", "abc123"],
      ["https://www.youtube.com/watch?list=PL123&v=abc123", "abc123"]
    ];
    for (const [url, expected] of cases) {
      expect(videoIdFromUrl(url), url).toBe(expected);
    }
  });

  // An uploaded-file run has no sourceUrl at all.
  it("returns null rather than throwing on anything that is not a video link", () => {
    for (const url of [undefined, "", "not a url", "https://example.com/watch?v=abc", "https://vimeo.com/123"]) {
      expect(videoIdFromUrl(url)).toBeNull();
    }
  });

  // Leading dashes and underscores are ordinary in YouTube ids and must not be
  // mangled — the Day 21 stream's id starts with one.
  it("preserves ids that start with a dash", () => {
    expect(videoIdFromUrl("https://youtu.be/-IEYLGdGpp4")).toBe("-IEYLGdGpp4");
  });
});
