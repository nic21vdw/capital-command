import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { dataPath } from "@/lib/paths";
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
      { ...base, id: "no-clips", stage: "analyzing", clips: [] }
    ]),
    "utf8"
  );
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
});
