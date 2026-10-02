import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ file: "" }));
vi.mock("@/lib/clipping/sources", () => ({
  readSourceMeta: vi.fn(async () => ({ id: "source", mime: "video/mp4" })),
  sourceFilePath: () => state.file,
  openSourceRange: (_meta: unknown, start: number, end: number) => createReadStream(state.file, { start, end }),
}));
vi.mock("@/lib/clipping/jobs", () => ({
  getJob: vi.fn(async () => ({ id: "job", clips: [{ file: "media.mp4" }] })),
  outputDir: () => path.dirname(state.file),
}));
vi.mock("@/lib/longform/music", () => ({
  getTrack: vi.fn(async () => ({ id: "track", mime: "audio/mpeg" })),
  trackFilePath: () => state.file,
  openTrackRange: (_track: unknown, start: number, end: number) => createReadStream(state.file, { start, end }),
  deleteTrack: vi.fn(),
}));
vi.mock("@/lib/longform/store", () => ({
  getProject: vi.fn(async () => ({
    id: "project", name: "Recording", exports: [{ id: "export", status: "done", file: "media.mp4" }],
  })),
  projectOutputDir: () => path.dirname(state.file),
}));
vi.mock("@/lib/longform/render", () => ({ cancelLongformExport: vi.fn() }));

import { GET as sourceStream } from "@/app/api/clips/sources/[sourceId]/stream/route";
import { GET as clipStream } from "@/app/api/clips/[jobId]/files/[fileName]/route";
import { GET as musicStream } from "@/app/api/longform/music/[trackId]/route";
import { GET as exportStream } from "@/app/api/longform/projects/[projectId]/export/[exportId]/route";

const endpoints = [
  { name: "source preview", get: sourceStream, url: "/api/clips/sources/source/stream" },
  { name: "rendered clip", get: clipStream, url: "/api/clips/job/files/media.mp4" },
  { name: "music preview", get: musicStream, url: "/api/longform/music/track" },
  { name: "long-form export", get: exportStream, url: "/api/longform/projects/project/export/export?file=1" },
];

const context = () => ({ params: Promise.resolve({
  sourceId: "source", jobId: "job", fileName: "media.mp4", trackId: "track", projectId: "project", exportId: "export",
}) });

describe.each(endpoints)("$name streaming", ({ get, url }) => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "marketing-media-stream-"));
    state.file = path.join(dir, "media.mp4");
    await writeFile(state.file, "0123456789");
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it.each([
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=3-", "3456789", "bytes 3-9/10"],
    ["bytes=0-1", "01", "bytes 0-1/10"],
  ])("returns the requested bytes for %s", async (range, body, contentRange) => {
    const response = await get(new NextRequest(`http://localhost:3100${url}`, { headers: { range } }), context());
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(await response.text()).toBe(body);
  });

  it("returns an unsatisfiable response without opening a stream beyond EOF", async () => {
    const response = await get(new NextRequest(`http://localhost:3100${url}`, { headers: { range: "bytes=10-" } }), context());
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
    expect(await response.text()).toBe("");
  });

  it("serves a full file without a range header", async () => {
    const response = await get(new NextRequest(`http://localhost:3100${url}`), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("10");
    expect(await response.text()).toBe("0123456789");
  });

  it("serves empty files without constructing a negative-end read stream", async () => {
    await writeFile(state.file, "");
    const response = await get(new NextRequest(`http://localhost:3100${url}`), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
    const partial = await get(new NextRequest(`http://localhost:3100${url}`, { headers: { range: "bytes=-1" } }), context());
    expect(partial.status).toBe(416);
    expect(partial.headers.get("content-range")).toBe("bytes */0");
  });
});
