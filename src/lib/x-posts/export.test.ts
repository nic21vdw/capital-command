import { describe, expect, it } from "vitest";
import { scheduledIso, toScheduledPosts, toThreadsCsv, toThreadsJson } from "@/lib/x-posts/export";
import type { XDailyPack } from "@/types/domain";

function pack(overrides: Partial<XDailyPack> = {}): XDailyPack {
  return {
    id: "xpack-1",
    date: "2026-07-22",
    source: "ai",
    posts: [
      {
        id: "xpost-1",
        slot: 1,
        time: "07:15",
        format: "insight",
        topic: "verification",
        text: "X flavored text",
        threadsVariant: "Threads flavored text"
      },
      {
        id: "xpost-2",
        slot: 2,
        time: "09:40",
        format: "contrarian",
        topic: "cost, of code",
        text: "second X",
        threadsVariant: 'Second Threads, with a "quote" and, a comma'
      }
    ],
    replies: [],
    requestedAt: "2026-07-22T13:00:00.000Z",
    createdAt: "2026-07-22T13:00:08.000Z",
    ...overrides
  };
}

describe("toScheduledPosts", () => {
  it("exports the Threads variant, never the X text", () => {
    const rows = toScheduledPosts(pack());
    expect(rows[0].text).toBe("Threads flavored text");
    expect(rows.map((r) => r.text)).not.toContain("X flavored text");
  });

  it("carries slot, format, topic and a scheduled datetime per post", () => {
    const rows = toScheduledPosts(pack());
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ slot: 1, date: "2026-07-22", time: "07:15", format: "insight" });
    expect(rows[0].scheduledAt.startsWith("2026-07-22T07:15:00")).toBe(true);
  });
});

describe("scheduledIso", () => {
  it("builds an ISO 8601 timestamp with a UTC offset for the given wall-clock time", () => {
    // Offset depends on the runtime TZ, so assert the shape, not a fixed zone.
    expect(scheduledIso("2026-07-22", "07:15")).toMatch(/^2026-07-22T07:15:00[+-]\d{2}:\d{2}$/);
  });
});

describe("toThreadsCsv", () => {
  it("emits an RFC 4180 header and one row per post", () => {
    const lines = toThreadsCsv(pack()).split("\r\n");
    expect(lines[0]).toBe("slot,scheduled_at,date,time,format,topic,text");
    expect(lines).toHaveLength(3);
  });

  it("quotes and escapes fields containing commas and quotes", () => {
    const csv = toThreadsCsv(pack());
    expect(csv).toContain('"cost, of code"');
    expect(csv).toContain('"Second Threads, with a ""quote"" and, a comma"');
  });
});

describe("toThreadsJson", () => {
  it("produces a parseable array of scheduled Threads posts", () => {
    const parsed = JSON.parse(toThreadsJson(pack())) as Array<{ text: string; slot: number }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toMatchObject({ slot: 2, text: 'Second Threads, with a "quote" and, a comma' });
  });
});
