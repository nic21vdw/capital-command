import { describe, expect, it } from "vitest";
import {
  MIN_POSTS_PER_ACCOUNT,
  MIN_POSTS_PER_HOUR,
  SLOT_AGE_HOURS,
  learnBestTimes,
  type AccountSlots
} from "@/lib/analytics/bestTimes";
import type { PostRecord } from "@/lib/analytics/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-20T15:00:00.000Z");
const ZONE = "America/Toronto";
const FIRST_MONDAY = Date.parse("2026-08-03T00:00:00.000Z");

type Spec = { time: string; count: number; views: number; weekend?: boolean; platform?: PostRecord["platform"]; accountId?: string };

let serial = 0;

function localToUtc(dayOffset: number, time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return new Date(FIRST_MONDAY + dayOffset * DAY + (hour + 4) * HOUR + minute * 60_000).toISOString();
}

function dayOffsets(count: number, weekend: boolean): number[] {
  const offsets: number[] = [];
  for (let day = 0; offsets.length < count; day += 1) {
    const dow = day % 7;
    const isWeekend = dow === 5 || dow === 6;
    if (isWeekend === weekend) offsets.push(day);
  }
  return offsets;
}

function post(spec: Spec, index: number, dayOffset: number, overrides: Partial<PostRecord> = {}): PostRecord {
  serial += 1;
  const platform = spec.platform ?? "youtube";
  const publishedAt = localToUtc(dayOffset, spec.time);
  const published = Date.parse(publishedAt);
  const views = Math.round(spec.views * (1 + ((index % 3) - 1) * 0.05));
  const at48 = new Date(published + SLOT_AGE_HOURS * HOUR).toISOString();
  const at96 = new Date(published + 96 * HOUR).toISOString();
  return {
    key: `${platform}:p${serial}`,
    platform,
    accountId: spec.accountId ?? `${platform}-primary`,
    postId: `p${serial}`,
    itemId: `item-${serial}`,
    format: "video",
    title: "t",
    caption: "",
    publishedAt,
    status: "ok",
    latest: { at: at96, metrics: { views: views * 40 } },
    history: [
      { date: at48.slice(0, 10), at: at48, views },
      { date: at96.slice(0, 10), at: at96, views: views * 40 }
    ],
    misses: 0,
    ...overrides
  };
}

function build(specs: Spec[]): PostRecord[] {
  return specs.flatMap((spec) => dayOffsets(spec.count, spec.weekend ?? false).map((offset, index) => post(spec, index, offset)));
}

const GRID = ["07:30", "10:00", "12:30", "15:00", "17:30", "20:00"];
const WEEKEND_GRID = ["09:00", "11:30", "14:00", "16:30", "19:00", "21:30"];

function learn(posts: PostRecord[], current = { weekday: GRID, weekend: WEEKEND_GRID }) {
  return learnBestTimes(posts, { timeZone: ZONE, now: NOW, current });
}

function youtube(report: ReturnType<typeof learn>): AccountSlots {
  const found = report.accounts.find((entry) => entry.platform === "youtube" && entry.accountId === "youtube-primary");
  if (!found) throw new Error("no youtube account in the report");
  return found;
}

const EIGHT_HOURS: Spec[] = [
  { time: "07:30", count: 8, views: 600 },
  { time: "09:00", count: 8, views: 4200 },
  { time: "10:00", count: 8, views: 3000 },
  { time: "12:30", count: 8, views: 900 },
  { time: "15:00", count: 8, views: 1200 },
  { time: "17:30", count: 8, views: 3600 },
  { time: "19:00", count: 8, views: 2600 },
  { time: "20:00", count: 8, views: 700 }
];

describe("learnBestTimes on synthetic history", () => {
  it("measures views at 48 hours old, not whatever the post has now", () => {
    expect(SLOT_AGE_HOURS).toBe(48);
    const slots = youtube(learn(build(EIGHT_HOURS))).weekday;
    expect(slots.hours.find((entry) => entry.hour === 9)?.meanViews).toBeGreaterThan(3500);
    expect(slots.hours.find((entry) => entry.hour === 9)?.meanViews).toBeLessThan(5000);
  });

  it("suggests the hours that earn the most, as many as the grid has today, in order", () => {
    const slots = youtube(learn(build(EIGHT_HOURS))).weekday;
    expect(slots.status).toBe("ready");
    expect(slots.times).toHaveLength(GRID.length);
    expect(slots.times).toEqual(["07:30", "09:00", "12:30", "15:00", "17:30", "19:00"]);
  });

  it("keeps the minutes of a current slot when its hour is still a best hour", () => {
    const slots = youtube(learn(build(EIGHT_HOURS))).weekday;
    expect(slots.times).toContain("17:30");
    expect(slots.times).not.toContain("17:00");
  });

  it("reports a gain over the current slots when every current hour has data", () => {
    const slots = youtube(learn(build(EIGHT_HOURS))).weekday;
    expect(slots.gainPercent).not.toBeNull();
    expect(slots.gainPercent!).toBeGreaterThan(0);
  });

  it("says the slots already match when the best hours are the ones in use", () => {
    const specs: Spec[] = GRID.map((time, index) => ({ time, count: 6, views: 1000 + index * 400 }));
    const slots = youtube(learn(build(specs))).weekday;
    expect(slots.status).toBe("unchanged");
    expect(slots.times).toEqual(GRID);
  });

  it(`says not enough data below ${MIN_POSTS_PER_ACCOUNT} posts, and proposes nothing`, () => {
    const specs: Spec[] = [
      { time: "09:00", count: 4, views: 4000 },
      { time: "10:00", count: 4, views: 3000 },
      { time: "12:30", count: 4, views: 900 },
      { time: "15:00", count: 4, views: 1200 },
      { time: "17:30", count: 3, views: 3600 }
    ];
    const slots = youtube(learn(build(specs))).weekday;
    expect(build(specs)).toHaveLength(19);
    expect(slots.status).toBe("not-enough-data");
    expect(slots.times).toEqual(GRID);
    expect(slots.confidence).toBeNull();
    expect(slots.reason).toMatch(/not enough data yet/i);
    expect(slots.reason).toContain(String(MIN_POSTS_PER_ACCOUNT));
  });

  it(`does not consider an hour with fewer than ${MIN_POSTS_PER_HOUR} posts, however well they did`, () => {
    const specs: Spec[] = [...EIGHT_HOURS.slice(1), { time: "06:00", count: MIN_POSTS_PER_HOUR - 1, views: 90_000 }];
    const slots = youtube(learn(build(specs))).weekday;
    expect(slots.times.some((time) => time.startsWith("06"))).toBe(false);
    expect(slots.hours.find((entry) => entry.hour === 6)?.considered).toBe(false);
  });

  it("says not enough data when too few hours qualify to fill the grid", () => {
    const specs: Spec[] = [
      { time: "09:00", count: 12, views: 4000 },
      { time: "10:00", count: 12, views: 3000 },
      { time: "17:30", count: 12, views: 3600 }
    ];
    const slots = youtube(learn(build(specs))).weekday;
    expect(slots.status).toBe("not-enough-data");
    expect(slots.times).toEqual(GRID);
    expect(slots.reason).toMatch(/3 hours/);
  });

  it("smooths: a lucky hour with a handful of posts does not outrank an hour with a long record", () => {
    const specs: Spec[] = [
      { time: "05:00", count: 3, views: 2000 },
      { time: "14:00", count: 20, views: 1800 },
      { time: "09:00", count: 20, views: 500 }
    ];
    const slots = youtube(learn(build(specs), { weekday: ["14:00"], weekend: WEEKEND_GRID })).weekday;
    expect(slots.status).toBe("unchanged");
    expect(slots.times).toEqual(["14:00"]);
  });

  it("never suggests two slots in neighbouring hours", () => {
    const specs: Spec[] = [
      { time: "09:00", count: 8, views: 4200 },
      { time: "10:00", count: 8, views: 4100 },
      { time: "15:00", count: 8, views: 1200 },
      { time: "18:00", count: 8, views: 1000 }
    ];
    const slots = youtube(learn(build(specs), { weekday: ["09:00", "15:00", "18:00"], weekend: WEEKEND_GRID })).weekday;
    expect(slots.times).not.toContain("10:00");
    const hours = slots.times.map((time) => Number(time.slice(0, 2)));
    for (let i = 1; i < hours.length; i += 1) expect(hours[i] - hours[i - 1]).toBeGreaterThanOrEqual(2);
  });

  it("reads the hour in the publish timezone, not UTC", () => {
    const specs: Spec[] = [{ time: "10:00", count: 20, views: 1000 }];
    const slots = youtube(learn(build(specs))).weekday;
    expect(slots.hours.map((entry) => entry.hour)).toEqual([10]);
    expect(build(specs)[0].publishedAt.slice(11, 13)).toBe("14");
  });

  it("learns weekdays and weekends separately, and leaves weekend slots alone when weekends have too little history", () => {
    const specs: Spec[] = [...EIGHT_HOURS, { time: "11:30", count: 5, views: 5000, weekend: true }];
    const account = youtube(learn(build(specs)));
    expect(account.weekday.status).toBe("ready");
    expect(account.weekend.status).toBe("not-enough-data");
    expect(account.weekend.times).toEqual(WEEKEND_GRID);
    expect(account.weekend.posts).toBe(5);
  });

  it("keeps platforms and accounts apart", () => {
    const specs: Spec[] = [
      ...EIGHT_HOURS,
      ...EIGHT_HOURS.map((spec) => ({ ...spec, platform: "instagram" as const, views: 10_000 - spec.views }))
    ];
    const report = learn(build(specs));
    const yt = report.accounts.find((entry) => entry.platform === "youtube")!;
    const ig = report.accounts.find((entry) => entry.platform === "instagram")!;
    expect(yt.weekday.times).toContain("09:00");
    expect(ig.weekday.times).not.toContain("09:00");
    expect(ig.weekday.times).toContain("07:30");
  });

  it("leaves out posts that are too young, private, long-form, unsupported or gone", () => {
    const base = build(EIGHT_HOURS);
    const extras = [
      post({ time: "09:00", count: 1, views: 4000 }, 0, 0, { visibility: "private" }),
      post({ time: "09:00", count: 1, views: 4000 }, 0, 1, { format: "long-form" }),
      post({ time: "09:00", count: 1, views: 4000 }, 0, 2, { status: "unsupported" }),
      post({ time: "09:00", count: 1, views: 4000 }, 0, 3, { status: "gone" }),
      post({ time: "09:00", count: 1, views: 4000 }, 0, 4, { publishedAt: new Date(NOW.getTime() - 20 * HOUR).toISOString(), history: [] })
    ];
    const withExtras = youtube(learn([...base, ...extras])).weekday;
    const without = youtube(learn(base)).weekday;
    expect(withExtras.posts).toBe(without.posts);
  });

  it("grades confidence by how much history stands behind the suggestion", () => {
    const small = youtube(learn(build(EIGHT_HOURS.map((spec) => ({ ...spec, count: 3 }))))).weekday;
    const medium = youtube(learn(build(EIGHT_HOURS.map((spec) => ({ ...spec, count: 5 }))))).weekday;
    const large = youtube(learn(build(EIGHT_HOURS.map((spec) => ({ ...spec, count: 9 }))))).weekday;
    expect(small.confidence).toBe("low");
    expect(medium.confidence).toBe("medium");
    expect(large.confidence).toBe("high");
    expect(large.basis).toMatch(/72 posts/);
  });

  it("describes how many posts each chosen hour stands on", () => {
    const slots = youtube(learn(build(EIGHT_HOURS))).weekday;
    expect(slots.basis).toMatch(/64 posts/);
    expect(slots.basis).toMatch(/8 per hour/);
  });
});
