import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadLock() {
  vi.resetModules();
  return import("@/lib/publisher/runLock");
}

describe("publish run lock", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("runs the work and reports idle again afterwards", async () => {
    const { withPublishRunLock, publishRunInProgress } = await loadLock();

    const result = await withPublishRunLock(async () => "report");

    expect(result).toBe("report");
    expect(publishRunInProgress()).toBe(false);
  });

  it("turns away a second run instead of letting both post", async () => {
    const { withPublishRunLock } = await loadLock();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;

    const first = withPublishRunLock(async () => {
      runs += 1;
      await gate;
      return "first";
    });
    // Arrives while the first is still in flight — the overlapping tick.
    const second = await withPublishRunLock(async () => {
      runs += 1;
      return "second";
    });

    expect(second).toBeNull();
    expect(runs).toBe(1);

    release();
    expect(await first).toBe("first");
  });

  it("releases the lock when the run throws, so the next tick is not blocked forever", async () => {
    const { withPublishRunLock, publishRunInProgress } = await loadLock();

    await expect(
      withPublishRunLock(async () => {
        throw new Error("upload exploded");
      })
    ).rejects.toThrow("upload exploded");

    expect(publishRunInProgress()).toBe(false);
    expect(await withPublishRunLock(async () => "next")).toBe("next");
  });
});
