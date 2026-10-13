import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDER_MIN_FREE_GB,
  DiskSpaceError,
  assertEnoughDiskSpace,
  dataVolumeSpace,
  diskFullMessage,
  isNoSpaceError,
  renderFailureMessage,
  renderMinFreeBytes
} from "@/lib/disk/space";

const GB = 1024 ** 3;

describe("renderMinFreeBytes", () => {
  it("defaults to 40 GB", () => {
    expect(DEFAULT_RENDER_MIN_FREE_GB).toBe(40);
    expect(renderMinFreeBytes({})).toBe(40 * GB);
  });

  it("reads RENDER_MIN_FREE_GB, fractions included", () => {
    expect(renderMinFreeBytes({ RENDER_MIN_FREE_GB: "100" })).toBe(100 * GB);
    expect(renderMinFreeBytes({ RENDER_MIN_FREE_GB: "0.5" })).toBe(0.5 * GB);
  });

  it("allows 0 to switch the guard off", () => {
    expect(renderMinFreeBytes({ RENDER_MIN_FREE_GB: "0" })).toBe(0);
  });

  it("falls back to the default on junk", () => {
    expect(renderMinFreeBytes({ RENDER_MIN_FREE_GB: "lots" })).toBe(40 * GB);
    expect(renderMinFreeBytes({ RENDER_MIN_FREE_GB: "-5" })).toBe(40 * GB);
    expect(renderMinFreeBytes({ RENDER_MIN_FREE_GB: "" })).toBe(40 * GB);
  });
});

describe("assertEnoughDiskSpace", () => {
  it("refuses with a user-facing message when free space is under the threshold", async () => {
    const error = await assertEnoughDiskSpace({
      space: async () => ({ freeBytes: 12.3 * GB, totalBytes: 500 * GB }),
      minBytes: 40 * GB
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(DiskSpaceError);
    expect(error.message).toContain("12.3 GB free");
    expect(error.message).toContain("40.0 GB");
    expect(error.message).toMatch(/data:prune/);
  });

  it("lets the render start when there is room", async () => {
    await expect(
      assertEnoughDiskSpace({ space: async () => ({ freeBytes: 41 * GB, totalBytes: 500 * GB }), minBytes: 40 * GB })
    ).resolves.toBeUndefined();
  });

  it("does nothing when the threshold is 0", async () => {
    await expect(
      assertEnoughDiskSpace({ space: async () => ({ freeBytes: 0, totalBytes: 500 * GB }), minBytes: 0 })
    ).resolves.toBeUndefined();
  });

  it("does not block renders when free space cannot be read", async () => {
    await expect(
      assertEnoughDiskSpace({
        space: async () => {
          throw new Error("statfs is not supported here");
        },
        minBytes: 40 * GB
      })
    ).resolves.toBeUndefined();
  });

  it("reads the threshold from RENDER_MIN_FREE_GB when none is passed", async () => {
    const previous = process.env.RENDER_MIN_FREE_GB;
    process.env.RENDER_MIN_FREE_GB = "50";
    try {
      await expect(
        assertEnoughDiskSpace({ space: async () => ({ freeBytes: 49 * GB, totalBytes: 500 * GB }) })
      ).rejects.toBeInstanceOf(DiskSpaceError);
    } finally {
      if (previous === undefined) delete process.env.RENDER_MIN_FREE_GB;
      else process.env.RENDER_MIN_FREE_GB = previous;
    }
  });
});

describe("dataVolumeSpace", () => {
  it("measures the volume under a directory that does not exist yet", async () => {
    const space = await dataVolumeSpace(`${os.tmpdir()}/capital-command-not-created-yet/deeper`);

    expect(space.totalBytes).toBeGreaterThan(0);
    expect(space.freeBytes).toBeGreaterThanOrEqual(0);
    expect(space.freeBytes).toBeLessThanOrEqual(space.totalBytes);
  });
});

describe("ENOSPC handling", () => {
  it("recognises a full disk however it surfaces", () => {
    expect(isNoSpaceError(Object.assign(new Error("write failed"), { code: "ENOSPC" }))).toBe(true);
    expect(isNoSpaceError(new Error("ENOSPC: no space left on device, write"))).toBe(true);
    expect(isNoSpaceError(new Error("ffmpeg exited with code 1: av_interleaved_write_frame(): No space left on device"))).toBe(true);
    expect(isNoSpaceError(new Error("ffmpeg exited with code 1: Invalid data found"))).toBe(false);
    expect(isNoSpaceError("nope")).toBe(false);
  });

  it("turns a full disk into one clear message, and leaves other errors alone", () => {
    const full = Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });

    expect(renderFailureMessage(full)).toBe(diskFullMessage());
    expect(diskFullMessage()).toMatch(/disk filled up/i);
    expect(renderFailureMessage(new DiskSpaceError("Not enough room."))).toBe("Not enough room.");
    expect(renderFailureMessage(new Error("Invalid data"))).toBe("Invalid data");
    expect(renderFailureMessage("plain string")).toBe("plain string");
  });
});
