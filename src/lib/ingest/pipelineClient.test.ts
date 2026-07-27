import { afterEach, describe, expect, it, vi } from "vitest";
import { videoIdFromUrl, waitForPipelineRun } from "@/lib/ingest/pipelineClient";

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

/**
 * A real run died here: one 500 from `GET /api/pipeline` — a JSON store read
 * caught mid-write — abandoned a download that was proceeding perfectly well.
 * The run kept going; only the watcher gave up.
 */
describe("waitForPipelineRun resilience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(responses: (() => Promise<Response>)[]) {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      const next = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return next();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const ok = (body: unknown) => async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const boom = () => async () => new Response("Internal Server Error", { status: 500 });

  const settled = {
    runs: [{ run: { id: "r1", status: "running" }, stages: {}, schedulable: {}, settled: true }]
  };

  it("rides out a transient 500 and still reports the run ready", async () => {
    stubFetch([boom(), boom(), ok(settled)]);
    const result = await waitForPipelineRun("r1", 60_000, 1, () => {});
    expect(result.outcome).toBe("ready");
  });

  it("gives up as timeout, not error, after repeated failures", async () => {
    stubFetch([boom()]);
    const result = await waitForPipelineRun("r1", 60_000, 1, () => {});
    // timeout keeps the video unsettled so the next scan re-checks it, rather
    // than marking a run that is probably still going as failed.
    expect(result.outcome).toBe("timeout");
    expect(result.error).toMatch(/polls in a row/);
  });

  it("resets the failure count after a success", async () => {
    stubFetch([boom(), boom(), boom(), boom(), ok(settled)]);
    const result = await waitForPipelineRun("r1", 60_000, 1, () => {});
    expect(result.outcome).toBe("ready");
  });

  it("reports each retry so a wedged API is visible in the log", async () => {
    stubFetch([boom(), ok(settled)]);
    const lines: string[] = [];
    await waitForPipelineRun("r1", 60_000, 1, (line) => lines.push(line));
    expect(lines.join("\n")).toMatch(/poll failed .* retrying 1\/5/);
  });
});
