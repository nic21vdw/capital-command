import { describe, expect, it } from "vitest";
import { describeDiskUsage, formatGb } from "@/lib/disk/format";

const GB = 1024 ** 3;

describe("describeDiskUsage", () => {
  it("reads free space, drive size and the data folder", () => {
    const line = describeDiskUsage({
      freeBytes: 120.4 * GB,
      totalBytes: 465.8 * GB,
      minFreeBytes: 40 * GB,
      low: false,
      dataBytes: 660 * GB,
      dataComputing: false
    });

    expect(line.summary).toBe("120.4 GB free of 465.8 GB · data folder 660.0 GB");
    expect(line.warning).toBeNull();
  });

  it("warns when the drive is under the render minimum", () => {
    const line = describeDiskUsage({
      freeBytes: 12 * GB,
      totalBytes: 465.8 * GB,
      minFreeBytes: 40 * GB,
      low: true,
      dataBytes: 660 * GB,
      dataComputing: false
    });

    expect(line.warning).toBe("Under the 40.0 GB render minimum, so new renders are refused until space is freed.");
  });

  it("says the data folder is being measured instead of showing a wrong size", () => {
    const line = describeDiskUsage({
      freeBytes: 100 * GB,
      totalBytes: 400 * GB,
      minFreeBytes: 40 * GB,
      low: false,
      dataBytes: null,
      dataComputing: true
    });

    expect(line.summary).toContain("data folder measuring");
  });

  it("formats one decimal place", () => {
    expect(formatGb(1.25 * GB)).toBe("1.3 GB");
  });
});
