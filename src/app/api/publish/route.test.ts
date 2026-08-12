import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueue = vi.fn();

vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => ({ enabled: true, timezone: "America/Toronto" })
}));
vi.mock("@/lib/publisher/enqueue", () => ({ enqueue }));
vi.mock("@/lib/publisher/runner", () => ({ runDue: vi.fn(async () => undefined) }));
vi.mock("@/lib/publisher/queue", () => ({
  FAILED_RETENTION_DAYS: 7,
  publishQueue: () => ({ get: async (id: string) => ({ id }) })
}));
vi.mock("@/lib/clipping/jobs", () => ({
  ensureVerticalClipFile: vi.fn(),
  outputDir: (jobId: string) => `/jobs/${jobId}`
}));
vi.mock("@/lib/publisher/rearm", () => ({ connectRearmScope: vi.fn(), rearmItems: vi.fn() }));

const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/publish/route");
  return POST(new NextRequest("http://localhost:3000/api/publish", { method: "POST", body: JSON.stringify(body) }));
};

const base = {
  clipPath: "data/longform/outputs/a6edf0a8/edited-7ff4b173.mp4",
  publishAt: "2026-08-13T21:00:00.000Z",
  platforms: ["youtube"]
};

describe("POST /api/publish format", () => {
  beforeEach(() => {
    enqueue.mockReset();
    enqueue.mockResolvedValue({ id: "queued" });
  });

  it("passes a long-form booking through as long", async () => {
    const response = await post({ ...base, format: "long" });

    expect(response.status).toBe(201);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ format: "long" }));
  });

  it("leaves format unset when the caller does not send one", async () => {
    await post(base);

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ format: undefined }));
  });

  it("rejects a format the enqueue path does not know", async () => {
    const response = await post({ ...base, format: "reel" });

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
