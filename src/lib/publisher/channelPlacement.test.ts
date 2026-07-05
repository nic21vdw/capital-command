import { describe, expect, it } from "vitest";
import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import { placeChannelVideos } from "@/lib/publisher/channelPlacement";
import { generateSlots } from "@/lib/publisher/slots";

const TZ = "America/Toronto";
// Wed Mar 4 2026, 10:00 in Toronto (EST, UTC-5) → grid window Mar 4-17.
const NOW = new Date("2026-03-04T15:00:00Z");

function video(publishAtUtc: string, overrides: Partial<ChannelVideo> = {}): ChannelVideo {
  return {
    videoId: `vid-${publishAtUtc}`,
    title: `Video at ${publishAtUtc}`,
    status: "scheduled",
    publishAtUtc,
    thumbnailUrl: null,
    url: "https://www.youtube.com/watch?v=x",
    ...overrides
  };
}

function place(videos: ChannelVideo[], options: Partial<Parameters<typeof placeChannelVideos>[0]> = {}) {
  return placeChannelVideos({
    videos,
    slots: generateSlots({ timeZone: TZ, now: NOW }),
    isSlotOccupied: () => false,
    timeZone: TZ,
    ...options
  });
}

describe("placeChannelVideos", () => {
  it("puts a video whose time hits a slot exactly into that slot cell", () => {
    // Fri Mar 6 07:30 Toronto = 12:30Z (EST).
    const result = place([video("2026-03-06T12:30:00.000Z")]);
    expect(result.bySlotUtc.get("2026-03-06T12:30:00.000Z")?.publishAtUtc).toBe("2026-03-06T12:30:00.000Z");
    expect(result.dayMarkers.size).toBe(0);
    expect(result.outsideWindow).toHaveLength(0);
  });

  it("matches a video a couple of minutes off the slot time to that slot", () => {
    const result = place([video("2026-03-06T12:32:15.000Z")]);
    expect(result.bySlotUtc.get("2026-03-06T12:30:00.000Z")?.publishAtUtc).toBe("2026-03-06T12:32:15.000Z");
    expect(result.dayMarkers.size).toBe(0);
  });

  it("turns a video at another time that day into a day marker with its local time", () => {
    // Fri Mar 6 09:00 Toronto = 14:00Z — no grid slot anywhere near.
    const result = place([video("2026-03-06T14:00:00.000Z")]);
    expect(result.bySlotUtc.size).toBe(0);
    expect(result.dayMarkers.get("2026-03-06")?.map((m) => m.time)).toEqual(["09:00"]);
  });

  it("treats the next quarter-hour as a different time, not the slot", () => {
    // 07:45 Toronto = 12:45Z — 15 min past the 07:30 slot, beyond tolerance.
    const result = place([video("2026-03-06T12:45:00.000Z")]);
    expect(result.bySlotUtc.size).toBe(0);
    expect(result.dayMarkers.get("2026-03-06")?.map((m) => m.time)).toEqual(["07:45"]);
  });

  it("demotes a slot-time video to a day marker when a queue item already fills the slot", () => {
    const result = place([video("2026-03-06T12:30:00.000Z")], {
      isSlotOccupied: (slotUtc) => slotUtc === "2026-03-06T12:30:00.000Z"
    });
    expect(result.bySlotUtc.size).toBe(0);
    expect(result.dayMarkers.get("2026-03-06")?.map((m) => m.time)).toEqual(["07:30"]);
  });

  it("gives a slot to one video only; a second at the same time becomes a marker", () => {
    const first = video("2026-03-06T12:30:00.000Z", { videoId: "first" });
    const second = video("2026-03-06T12:31:00.000Z", { videoId: "second" });
    const result = place([first, second]);
    expect(result.bySlotUtc.get("2026-03-06T12:30:00.000Z")?.videoId).toBe("first");
    expect(result.dayMarkers.get("2026-03-06")?.map((m) => m.video.videoId)).toEqual(["second"]);
  });

  it("sorts a day's markers by wall-clock time", () => {
    const result = place([video("2026-03-06T21:00:00.000Z"), video("2026-03-06T14:00:00.000Z")]);
    expect(result.dayMarkers.get("2026-03-06")?.map((m) => m.time)).toEqual(["09:00", "16:00"]);
  });

  it("lists videos on days outside the grid window separately", () => {
    // Mar 20 is past the Mar 4-17 window; Feb 28 is before it.
    const later = video("2026-03-20T12:30:00.000Z");
    const earlier = video("2026-02-28T15:00:00.000Z", { status: "published" });
    const result = place([earlier, later]);
    expect(result.outsideWindow.map((v) => v.publishAtUtc)).toEqual([earlier.publishAtUtc, later.publishAtUtc]);
    expect(result.bySlotUtc.size).toBe(0);
    expect(result.dayMarkers.size).toBe(0);
  });

  it("buckets by the local calendar day, not the UTC one", () => {
    // Tue Mar 17 21:00 Toronto = Mar 18 01:00Z — UTC is already the next day,
    // which lies outside the window; locally it's still the window's last day.
    const result = place([video("2026-03-18T01:00:00.000Z")]);
    expect(result.dayMarkers.get("2026-03-17")?.map((m) => m.time)).toEqual(["21:00"]);
    expect(result.outsideWindow).toHaveLength(0);
  });

  it("places everything outside the window when there are no slots yet", () => {
    const result = place([video("2026-03-06T12:30:00.000Z")], { slots: [] });
    expect(result.outsideWindow).toHaveLength(1);
  });
});
