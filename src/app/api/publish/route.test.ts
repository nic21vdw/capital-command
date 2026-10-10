import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueue = vi.fn();
const state = vi.hoisted(() => ({
  enabled: true,
  items: [{ id: "queued-1" }] as Array<{ id: string }>,
  markFailedSeen: vi.fn(async () => []),
  purgeFailed: vi.fn(async () => []),
  save: vi.fn(async () => undefined),
  connectRearmScope: vi.fn<(platform: string, accountId?: string, options?: unknown) => object>(() => ({})),
  rearmItems: vi.fn()
}));

vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => ({ enabled: state.enabled, timezone: "America/Toronto" })
}));
vi.mock("@/lib/publisher/enqueue", () => ({ enqueue }));
vi.mock("@/lib/publisher/runner", () => ({ runDue: vi.fn(async () => undefined) }));
vi.mock("@/lib/publisher/queue", () => ({
  FAILED_RETENTION_DAYS: 7,
  publishQueue: () => ({
    get: async (id: string) => ({ id }),
    list: async () => state.items,
    save: state.save,
    markFailedSeen: state.markFailedSeen,
    purgeFailed: state.purgeFailed
  })
}));
vi.mock("@/lib/clipping/jobs", () => ({
  ensureVerticalClipFile: vi.fn(),
  outputDir: (jobId: string) => `/jobs/${jobId}`
}));
vi.mock("@/lib/publisher/rearm", () => ({
  connectRearmScope: state.connectRearmScope,
  rearmItems: state.rearmItems
}));

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

const getBoard = async (query = "") => {
  const { GET } = await import("@/app/api/publish/route");
  return GET(new NextRequest(`http://localhost:3000/api/publish${query}`));
};

describe("posting switched off", () => {
  beforeEach(() => {
    enqueue.mockReset();
    state.markFailedSeen.mockClear();
    state.purgeFailed.mockClear();
    state.enabled = false;
  });

  it("still lists the queue, read-only, so the board can stay on screen", async () => {
    const response = await getBoard("?board=1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, items: [{ id: "queued-1" }] });
    // Stamping a failure as seen and sweeping old ones both write the queue.
    expect(state.markFailedSeen).not.toHaveBeenCalled();
    expect(state.purgeFailed).not.toHaveBeenCalled();
  });

  it("keeps refusing to book", async () => {
    const response = await post(base);

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("stamps failures as seen once posting is on again", async () => {
    state.enabled = true;
    const response = await getBoard("?board=1");

    expect((await response.json()).enabled).toBe(true);
    expect(state.markFailedSeen).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/publish", () => {
  beforeEach(() => {
    state.enabled = true;
    state.markFailedSeen.mockClear();
  });

  it("does not mark failures as seen for a reader that is not the board (the Clip Editor)", async () => {
    expect((await getBoard()).status).toBe(200);
    expect(state.markFailedSeen).not.toHaveBeenCalled();
  });

  it("marks failures as seen when the Uploading Center board reads", async () => {
    await getBoard("?board=1");
    expect(state.markFailedSeen).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/publish rearm", () => {
  beforeEach(() => {
    state.enabled = true;
    state.save.mockClear();
    state.connectRearmScope.mockClear();
    state.rearmItems.mockReset();
    state.rearmItems.mockReturnValue([]);
  });

  it("passes the board's narrower request through and reports the older posts it left failed", async () => {
    state.rearmItems.mockImplementation((_items: unknown, scope: { onSkipped?: () => void }) => {
      const options = state.connectRearmScope.mock.calls[0][2] as { onSkipped: () => void };
      expect(scope).toBeDefined();
      options.onSkipped();
      options.onSkipped();
      return [{ item: { id: "q1" }, platforms: ["youtube"] }];
    });

    const response = await post({ action: "rearm", platform: "youtube", statuses: ["failed"], maxSlotAgeHours: 24 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(state.connectRearmScope).toHaveBeenCalledWith(
      "youtube",
      undefined,
      expect.objectContaining({ statuses: ["failed"], maxSlotAgeMs: 24 * 3_600_000 })
    );
    expect(body).toMatchObject({ ok: true, recovered: 1, skippedOld: 2, itemIds: ["q1"] });
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it("scopes to one account when given one", async () => {
    await post({ action: "rearm", platform: "tiktok", accountId: "tiktok-second", statuses: ["failed"] });

    expect(state.connectRearmScope).toHaveBeenCalledWith(
      "tiktok",
      "tiktok-second",
      expect.objectContaining({ statuses: ["failed"], maxSlotAgeMs: undefined })
    );
  });

  it("without the new options it asks for everything the connect flow does", async () => {
    await post({ action: "rearm", platform: "youtube" });

    expect(state.connectRearmScope).toHaveBeenCalledWith(
      "youtube",
      undefined,
      expect.objectContaining({ statuses: undefined, maxSlotAgeMs: undefined })
    );
  });

  it("rejects a status that cannot be re-armed", async () => {
    const response = await post({ action: "rearm", platform: "youtube", statuses: ["published"] });

    expect(response.status).toBe(400);
    expect(state.rearmItems).not.toHaveBeenCalled();
  });
});
