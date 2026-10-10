import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRunFromSource: vi.fn(),
  createRunFromUrl: vi.fn(),
  updateRun: vi.fn(),
  listRuns: vi.fn(),
  overviewContext: vi.fn(),
  readThreadsQueue: vi.fn()
}));
vi.mock("@/lib/clipping/ffmpeg", () => ({ resolveFfmpeg: () => "ffmpeg", FFMPEG_MISSING_MESSAGE: "Missing" }));
vi.mock("@/lib/pipeline/runs", () => ({ ...mocks, runOverview: vi.fn() }));
vi.mock("@/lib/threads/queue", () => ({ readQueue: mocks.readThreadsQueue }));
vi.mock("@/lib/ingest/service", () => ({ ingestOverview: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/ingest/run", () => ({ ingestLedger: vi.fn() }));
vi.mock("@/lib/storage/store", () => ({ readAppData: vi.fn() }));
import { GET, POST } from "@/app/api/pipeline/route";

describe("pipeline start request validation", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each([null, [], "url", 1, true])("returns 400 for a non-object body (%j) without starting work", async (body) => {
    const response = await POST(new NextRequest("http://localhost:3100/api/pipeline", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createRunFromSource).not.toHaveBeenCalled();
    expect(mocks.createRunFromUrl).not.toHaveBeenCalled();
  });

  it("still starts valid uploaded sources with their output quality", async () => {
    mocks.createRunFromSource.mockResolvedValue({ id: "run" });
    const output = { resolution: "1080p", frameRate: "source" };
    const response = await POST(new NextRequest("http://localhost:3100/api/pipeline", {
      method: "POST", body: JSON.stringify({ sourceId: " source ", name: " Name ", output }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.createRunFromSource).toHaveBeenCalledWith("source", "Name", output);
    expect(mocks.updateRun).not.toHaveBeenCalled();
  });
});

describe("the attention summary the sidebar badge polls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRuns.mockResolvedValue([]);
  });
  const slot = new Date(Date.now() - 86_400_000).toISOString();
  const failedPost = {
    id: "q1",
    title: "Stream highlight",
    caption: "",
    publishAt: slot,
    platforms: { youtube: { status: "published", attempts: 1 }, instagram: { status: "failed", attempts: 2 } }
  };
  const failedThread = { id: "t1", topic: "Why I stream", text: "", status: "failed", attempts: 3, publishAt: slot };
  const read = async () => (await GET(new NextRequest("http://localhost:3100/api/pipeline?summary=1"))).json();

  it("counts a partly failed post and a failed Threads post, and says which is which", async () => {
    mocks.overviewContext.mockReturnValue({ queue: async () => [failedPost] });
    mocks.readThreadsQueue.mockResolvedValue([failedThread]);
    const body = await read();
    expect(body.needsAttention).toBe(2);
    expect(body.breakdown).toEqual({ pipeline: 0, publish: 1, threads: 1 });
    expect(body.failures.map((failure: { id: string }) => failure.id).sort()).toEqual([
      "publish-failed:q1:instagram:2",
      "threads-failed:t1:3"
    ]);
  });

  it("still answers when the Threads queue cannot be read", async () => {
    mocks.overviewContext.mockReturnValue({ queue: async () => [failedPost] });
    mocks.readThreadsQueue.mockRejectedValue(new Error("unreadable"));
    const body = await read();
    expect(body.breakdown).toEqual({ pipeline: 0, publish: 1, threads: 0 });
  });

  it("is zero when nothing failed", async () => {
    mocks.overviewContext.mockReturnValue({ queue: async () => [] });
    mocks.readThreadsQueue.mockResolvedValue([]);
    const body = await read();
    expect(body.needsAttention).toBe(0);
    expect(body.failures).toEqual([]);
  });
});
