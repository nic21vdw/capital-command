import { describe, expect, it } from "vitest";
import { SCAN_STALE_AFTER_MS, scanHealth } from "@/lib/ingest/ledger";
import type { LedgerScan } from "@/lib/ingest/types";

const now = new Date("2026-08-07T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
const ok = (at: string): LedgerScan => ({ at, status: "ok", ingested: 1 });

describe("whether the nightly scan is actually running", () => {
  it("reports a recent success as fine", () => {
    const health = scanHealth({ lastScan: ok(hoursAgo(6)), lastScanAt: hoursAgo(6) }, now);
    expect(health?.status).toBe("ok");
  });

  it("calls a long-ago success stale — a task switched off looks identical otherwise", () => {
    const at = hoursAgo(72);
    const health = scanHealth({ lastScan: ok(at), lastScanAt: at }, now);
    expect(health?.status).toBe("stale");
    expect(health?.staleSince).toBe(at);
  });

  it("keeps a real failure rather than replacing it with staleness", () => {
    const at = hoursAgo(2);
    const health = scanHealth({ lastScan: { at, status: "failed", error: "yt-dlp is gone" }, lastScanAt: at }, now);
    expect(health?.status).toBe("failed");
    expect(health?.error).toBe("yt-dlp is gone");
  });

  it("says nothing at all when nothing has ever scanned", () => {
    expect(scanHealth({ lastScanAt: null }, now)).toBeNull();
  });

  it("uses a sane threshold — a daily task may legitimately be a day old", () => {
    expect(SCAN_STALE_AFTER_MS).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});
