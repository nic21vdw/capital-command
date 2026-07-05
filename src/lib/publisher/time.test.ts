import { describe, expect, it } from "vitest";
import { resolvePublishAt, toRfc3339Utc } from "@/lib/publisher/time";

describe("publish time handling", () => {
  it("interprets naive datetimes in the configured timezone (DST-aware)", () => {
    // July: Toronto is EDT (UTC-4).
    expect(resolvePublishAt("2026-07-10T18:30", "America/Toronto").toISOString()).toBe("2026-07-10T22:30:00.000Z");
    // January: Toronto is EST (UTC-5).
    expect(resolvePublishAt("2026-01-10T18:30", "America/Toronto").toISOString()).toBe("2026-01-10T23:30:00.000Z");
  });

  it("passes explicit offsets through unchanged", () => {
    expect(resolvePublishAt("2026-07-10T18:30:00-04:00", "America/Toronto").toISOString()).toBe(
      "2026-07-10T22:30:00.000Z"
    );
    expect(resolvePublishAt("2026-07-10T22:30:00Z", "America/Toronto").toISOString()).toBe("2026-07-10T22:30:00.000Z");
  });

  it("rejects unparseable input with a helpful error", () => {
    expect(() => resolvePublishAt("tomorrow-ish", "America/Toronto")).toThrow(/Could not parse/);
  });

  it("formats RFC3339 UTC without milliseconds for YouTube's publishAt", () => {
    expect(toRfc3339Utc(new Date("2026-07-10T22:30:00.000Z"))).toBe("2026-07-10T22:30:00Z");
  });
});
