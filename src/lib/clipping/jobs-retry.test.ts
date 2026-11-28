import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import * as download from "@/lib/clipping/download";
import { getJob, retryMissingRenders } from "@/lib/clipping/jobs";

// A server that stops mid-job leaves the record on "error" with every clip
// already on disk. Retrying found nothing missing and returned the job
// untouched, so the run advertised "needs attention" forever and no button in
// the app could settle it.

const base = {
  fileName: "stream.mp4",
  clipCount: 2,
  status: "error",
  stage: "rendering",
  progress: 50,
  notices: [],
  createdAt: "2026-08-13T12:00:00.000Z",
  error: "The server restarted while this job was processing."
};

// The store reads its file once per process, so every fixture is seeded up
// front and each test works on its own job.
beforeAll(async () => {
  const file = dataPath("clips", "jobs.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify([
      {
        ...base,
        id: "all-rendered",
        clips: [
          { id: "c1", start: 0, end: 30, file: "clip-01-ready.mp4" },
          { id: "c2", start: 40, end: 70, file: "clip-02-ready.mp4" }
        ]
      },
      {
        ...base,
        id: "already-done",
        status: "done",
        stage: "finished",
        progress: 100,
        error: undefined,
        clips: [{ id: "c1", start: 0, end: 30, file: "clip-01-ready.mp4" }]
      },
      { ...base, id: "no-clips", stage: "analyzing", clips: [] },
      { ...base, id: "local", sourceId: "original", sourceUrl: "upload://original", clips: [] },
      { ...base, id: "missing-local", sourceId: "removed", sourceUrl: "upload://removed", clips: [] },
      { ...base, id: "remote", sourceUrl: "https://example.test/stream", clips: [] }
    ]),
    "utf8"
  );
  const source = dataPath("clips", "sources", "original");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "meta.json"), JSON.stringify({ id: "original", storedName: "source.mp4", durationSec: 10 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("retryMissingRenders", () => {
  it("settles a job whose clips all rendered instead of leaving it errored", async () => {
    const job = await retryMissingRenders("all-rendered");

    expect(job?.status).toBe("done");
    expect(job?.stage).toBe("finished");
    expect(job?.progress).toBe(100);
    expect(await getJob("all-rendered").then((entry) => entry?.status)).toBe("done");
  });

  it("leaves an already-finished job alone", async () => {
    const job = await retryMissingRenders("already-done");

    expect(job?.status).toBe("done");
  });

  it("refuses a job that planned no clips and has no source to start from", async () => {
    await expect(retryMissingRenders("no-clips")).rejects.toThrow(/no source link/i);
  });

  it("reopens the stored upload locally when selection was interrupted", async () => {
    vi.stubEnv("RENDER_MIN_FREE_GB", "0");
    const fetchMeta = vi.spyOn(download, "fetchVideoMeta").mockRejectedValue(new Error("Unexpected URL download"));
    await retryMissingRenders("local");
    await vi.waitFor(async () => expect((await getJob("local"))?.error).toMatch(/video is shorter than 20 seconds/i));
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it("leaves an unavailable upload recoverable and never sends its marker to the downloader", async () => {
    const fetchMeta = vi.spyOn(download, "fetchVideoMeta").mockRejectedValue(new Error("Unexpected URL download"));
    await expect(retryMissingRenders("missing-local")).rejects.toThrow(/upload the video again/i);
    expect((await getJob("missing-local"))?.error).toBe(base.error);
    expect(fetchMeta).not.toHaveBeenCalled();
  });

  it("still retries a pasted VOD through the remote pipeline", async () => {
    vi.stubEnv("RENDER_MIN_FREE_GB", "0");
    const fetchMeta = vi.spyOn(download, "fetchVideoMeta").mockRejectedValue(new Error("VOD unavailable"));
    await retryMissingRenders("remote");
    await vi.waitFor(async () => expect((await getJob("remote"))?.error).toBe("VOD unavailable"));
    expect(fetchMeta).toHaveBeenCalledWith("https://example.test/stream");
  });
});
