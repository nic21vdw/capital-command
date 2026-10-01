import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAutomationPaused } from "@/lib/automations/store";
import { podcastConfigured, publishEpisode } from "@/lib/podcast/publish";
import {
  DEFAULT_SHOW,
  mutatePodcastState,
  readPodcastState,
} from "@/lib/podcast/store";
import { removeEpisode } from "@/lib/podcast/store";
import {
  managePodcastDelivery,
  nextPodcastSlot,
  podcastAutomationStatus,
  processDuePodcastDeliveries,
  savePodcastAutomation,
  scheduleEpisode,
} from "@/lib/podcast/schedule";
import type { PodcastDelivery } from "@/lib/podcast/types";

vi.mock("@/lib/automations/store", () => ({
  isAutomationPaused: vi.fn(async () => false),
}));
vi.mock("@/lib/podcast/publish", () => ({
  podcastConfigured: vi.fn(() => true),
  publishEpisode: vi.fn(async (input) => ({
    episode: { id: `ep-${input.exportId}` },
    added: true,
    url: "https://cdn.example.com/podcast/feed.xml",
  })),
}));

const automation = {
  enabled: true,
  time: "10:00",
  timeZone: "America/Toronto",
};
const now = new Date("2026-10-01T12:00:00.000Z");
const input = {
  title: "A real episode",
  description: "Show notes",
  filePath: "episode.mp3",
  durationSec: 123,
  exportId: "export-1",
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(podcastConfigured).mockReturnValue(true);
  vi.mocked(isAutomationPaused).mockResolvedValue(false);
  vi.mocked(publishEpisode).mockImplementation(async (input) => ({
    episode: { id: `ep-${input.exportId}` } as never,
    added: true,
    url: "https://cdn.example.com/podcast/feed.xml",
  }));
  await mutatePodcastState((state) => {
    state.show = {
      ...DEFAULT_SHOW,
      email: "owner@example.com",
      artworkUrl: "https://cdn.example.com/art.jpg",
    };
    state.episodes = [];
    state.deliveries = [];
    state.automation = { ...automation };
  });
});

async function due(id = "export-1") {
  return scheduleEpisode(
    { ...input, exportId: id },
    "2026-10-01T13:00:00.000Z",
    now,
  );
}

describe("daily podcast slots", () => {
  it("books one slot per local day and skips occupied days", () => {
    const first = nextPodcastSlot(automation, [], now);
    expect(first).toBe("2026-10-01T14:00:00.000Z");
    expect(
      nextPodcastSlot(
        automation,
        [{ publishAt: first, status: "scheduled" } as PodcastDelivery],
        now,
      ),
    ).toBe("2026-10-02T14:00:00.000Z");
  });

  it("does not double book the repeated autumn hour", () => {
    const settings = { ...automation, time: "01:30" };
    const start = new Date("2026-11-01T04:00:00.000Z");
    const first = nextPodcastSlot(settings, [], start);
    expect(first).toBe("2026-11-01T05:30:00.000Z");
    expect(
      nextPodcastSlot(
        settings,
        [{ publishAt: first, status: "scheduled" } as PodcastDelivery],
        start,
      ),
    ).toBe("2026-11-02T06:30:00.000Z");
  });

  it("skips a nonexistent spring clock time", () => {
    expect(
      nextPodcastSlot(
        { ...automation, time: "02:30" },
        [],
        new Date("2026-03-08T05:00:00.000Z"),
      ),
    ).toBe("2026-03-09T06:30:00.000Z");
  });

  it("rejects invalid schedule and release time inputs", async () => {
    await expect(
      savePodcastAutomation({ ...automation, timeZone: "Invented/Zone" }),
    ).rejects.toThrow("time zone");
    await expect(scheduleEpisode(input, "invalid", now)).rejects.toThrow(
      "future",
    );
    await expect(scheduleEpisode(input, "2020-01-01", now)).rejects.toThrow(
      "future",
    );
  });
});

describe("durable scheduled delivery", () => {
  it("deduplicates simultaneous bookings and keeps independent writes", async () => {
    const [first, second] = await Promise.all([
      due(),
      due(),
      savePodcastAutomation({ ...automation, time: "11:00" }),
    ]);
    expect(first.id).toBe(second.id);
    const state = await readPodcastState();
    expect(state.deliveries).toHaveLength(1);
    expect(state.automation.time).toBe("11:00");
    expect(publishEpisode).not.toHaveBeenCalled();
  });

  it("releases only when due and persists the outcome", async () => {
    const delivery = await due();
    expect(await processDuePodcastDeliveries(now)).toBe(0);
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-01T13:00:00.000Z")),
    ).toBe(1);
    expect(publishEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        exportId: input.exportId,
        publishedAt: delivery.publishAt,
      }),
    );
    expect((await readPodcastState()).deliveries[0]).toMatchObject({
      status: "published",
      episodeId: "ep-export-1",
      attempts: 1,
    });
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-02T13:00:00.000Z")),
    ).toBe(0);
    expect((await podcastAutomationStatus()).deliveries[0]).not.toHaveProperty(
      "filePath",
    );
  });

  it("releases at most one overdue episode per heartbeat", async () => {
    await due();
    await due("export-2");
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-03T13:00:00.000Z")),
    ).toBe(1);
    expect(
      (await readPodcastState()).deliveries.filter(
        (item) => item.status === "scheduled",
      ),
    ).toHaveLength(1);
  });

  it("honors both global pause and the enabled switch", async () => {
    await due();
    vi.mocked(isAutomationPaused).mockResolvedValue(true);
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-02T13:00:00.000Z")),
    ).toBe(0);
    vi.mocked(isAutomationPaused).mockResolvedValue(false);
    await savePodcastAutomation({ ...automation, enabled: false });
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-02T13:00:00.000Z")),
    ).toBe(0);
    expect(publishEpisode).not.toHaveBeenCalled();
  });

  it("retains setup blockers without spending transport retries and resumes after setup", async () => {
    await due();
    vi.mocked(podcastConfigured).mockReturnValue(false);
    for (let tick = 0; tick < 8; tick++)
      await processDuePodcastDeliveries(
        new Date(Date.parse("2026-10-01T13:00:00.000Z") + tick * 90_000),
      );
    expect((await readPodcastState()).deliveries[0]).toMatchObject({
      status: "failed",
      blocked: true,
      attempts: 0,
    });
    vi.mocked(podcastConfigured).mockReturnValue(true);
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-02T13:00:00.000Z")),
    ).toBe(1);
    expect((await readPodcastState()).deliveries[0].status).toBe("published");
  });

  it("backs off transport failures, bounds retries, and permits a manual retry", async () => {
    const delivery = await due();
    vi.mocked(publishEpisode).mockRejectedValue(
      new Error("Bucket unavailable"),
    );
    await processDuePodcastDeliveries(new Date("2026-10-01T13:00:00.000Z"));
    expect((await readPodcastState()).deliveries[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      nextAttemptAt: "2026-10-01T13:05:00.000Z",
      lastError: "Bucket unavailable",
    });
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-01T13:01:00.000Z")),
    ).toBe(0);
    await mutatePodcastState((state) => {
      state.deliveries[0].attempts = 5;
    });
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-02T13:00:00.000Z")),
    ).toBe(0);
    await managePodcastDelivery(delivery.id, "retry");
    expect((await readPodcastState()).deliveries[0]).toMatchObject({
      status: "scheduled",
      attempts: 0,
    });
  });

  it("recovers a publishing lease after a restart but never steals a live lease", async () => {
    await due();
    await mutatePodcastState((state) => {
      Object.assign(state.deliveries[0], {
        status: "publishing",
        lastAttemptAt: "2026-10-01T13:00:00.000Z",
        attempts: 1,
      });
    });
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-01T13:01:00.000Z")),
    ).toBe(0);
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-01T13:31:00.000Z")),
    ).toBe(1);
  });

  it("rechecks cancellation at the claim boundary", async () => {
    const delivery = await due();
    vi.mocked(isAutomationPaused)
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        await managePodcastDelivery(delivery.id, "cancel");
        return false;
      });
    expect(
      await processDuePodcastDeliveries(new Date("2026-10-02T13:00:00.000Z")),
    ).toBe(0);
    expect(publishEpisode).not.toHaveBeenCalled();
  });

  it("retains a cancelled release and requires explicit rescheduling", async () => {
    const delivery = await due();
    await managePodcastDelivery(delivery.id, "cancel");
    await expect(due()).rejects.toThrow("cancelled");
    await managePodcastDelivery(
      delivery.id,
      "reschedule",
      "2030-10-01T13:00:00.000Z",
    );
    expect((await readPodcastState()).deliveries).toHaveLength(1);
    expect((await readPodcastState()).deliveries[0]).toMatchObject({
      status: "scheduled",
      publishAt: "2030-10-01T13:00:00.000Z",
    });
  });

  it("retires delivery records when an episode is removed without auto-reposting", async () => {
    const delivery = await due();
    await mutatePodcastState((state) => {
      Object.assign(state.deliveries[0], {
        status: "published",
        episodeId: "removed",
      });
      state.episodes = [
        { id: "removed", exportId: delivery.exportId } as never,
      ];
    });
    await removeEpisode("removed");
    expect((await readPodcastState()).deliveries[0].status).toBe("cancelled");
    await expect(due()).rejects.toThrow("cancelled");
  });
});
