import { describe, expect, it } from "vitest";
import { buildAgenda } from "@/lib/publisher/agenda";
import type { ChannelVideo } from "@/lib/publisher/channelVideos";
import type { ScheduleSlot } from "@/lib/publisher/slots";
import type { QueueItem } from "@/lib/publisher/types";

// Slots are built in UTC so a UTC timezone makes an instant's local time equal
// its ISO time — the placement maths stays obvious in the assertions.
function slot(dateKey: string, time: string, opts: { past?: boolean; today?: boolean } = {}): ScheduleSlot {
  return {
    id: `${dateKey} ${time}`,
    dateKey,
    dateLabel: dateKey,
    time,
    utc: `${dateKey}T${time}:00.000Z`,
    past: opts.past ?? false,
    today: opts.today ?? false
  };
}

function queueItem(publishAt: string, title: string): QueueItem {
  return {
    id: `q-${publishAt}`,
    clipPath: "x.mp4",
    title,
    caption: "",
    hashtags: [],
    publishAt,
    visibility: "public",
    createdAt: "2026-07-01T00:00:00.000Z",
    platforms: { youtube: { status: "scheduled", attempts: 0 } }
  };
}

function channelVideo(publishAtUtc: string, title: string): ChannelVideo {
  return {
    videoId: `v-${publishAtUtc}`,
    title,
    status: "scheduled",
    publishAtUtc,
    thumbnailUrl: null,
    url: "https://youtu.be/x"
  };
}

const DAY = "2026-07-22";
const PAST_DAY = "2026-07-20";

function baseSlots(): ScheduleSlot[] {
  return [
    slot(PAST_DAY, "07:30", { past: true }),
    slot(PAST_DAY, "12:30", { past: true }),
    slot(PAST_DAY, "19:30", { past: true }),
    slot(DAY, "07:30", { today: true }),
    slot(DAY, "12:30", { today: true }),
    slot(DAY, "19:30", { today: true })
  ];
}

describe("buildAgenda", () => {
  it("places an off-slot upload on its day at its real time without stealing a slot", () => {
    const [, today] = buildAgenda({
      slots: baseSlots(),
      queueItems: [queueItem(`${DAY}T14:30:00.000Z`, "Mid-afternoon clip")],
      channelVideos: [],
      timeZone: "UTC"
    });
    expect(today.entries).toHaveLength(1);
    expect(today.entries[0]).toMatchObject({ kind: "queue", time: "14:30" });
    // 14:30 is near no slot, so all three remain open drop targets.
    expect(today.openSlots.map((s) => s.time)).toEqual(["07:30", "12:30", "19:30"]);
  });

  it("marks a slot occupied when an entry sits within tolerance of it", () => {
    const [, today] = buildAgenda({
      slots: baseSlots(),
      queueItems: [],
      channelVideos: [channelVideo(`${DAY}T12:31:00.000Z`, "On-slot short")],
      timeZone: "UTC"
    });
    expect(today.entries).toHaveLength(1);
    expect(today.openSlots.map((s) => s.time)).toEqual(["07:30", "19:30"]);
  });

  it("keeps past-day entries but offers no open slots there", () => {
    const [past] = buildAgenda({
      slots: baseSlots(),
      queueItems: [queueItem(`${PAST_DAY}T12:30:00.000Z`, "Yesterday")],
      channelVideos: [],
      timeZone: "UTC"
    });
    expect(past.past).toBe(true);
    expect(past.entries).toHaveLength(1);
    expect(past.openSlots).toHaveLength(0);
  });

  it("drops entries that fall outside the visible window", () => {
    const days = buildAgenda({
      slots: baseSlots(),
      queueItems: [queueItem("2026-06-01T12:30:00.000Z", "Ancient history")],
      channelVideos: [],
      timeZone: "UTC"
    });
    expect(days.flatMap((day) => day.entries)).toHaveLength(0);
  });

  it("sorts entries on a day earliest first", () => {
    const [, today] = buildAgenda({
      slots: baseSlots(),
      queueItems: [
        queueItem(`${DAY}T19:00:00.000Z`, "Evening"),
        queueItem(`${DAY}T08:00:00.000Z`, "Morning")
      ],
      channelVideos: [channelVideo(`${DAY}T15:00:00.000Z`, "Afternoon")],
      timeZone: "UTC"
    });
    expect(today.entries.map((e) => e.time)).toEqual(["08:00", "15:00", "19:00"]);
  });
});
