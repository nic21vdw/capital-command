import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRelease, restartOutcome, type RestartStatus } from "./restart";

const current: RestartStatus = {
  instance: "old-server", running: "old-build", updating: true,
  progress: { step: "Building", failed: null, finished: false, startedAt: 1, quietFor: 2, tail: [] }
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("restart recovery", () => {
  it("reopens on the new server without requiring an observed outage or no pending commits", () => {
    expect(restartOutcome("old-server", { ...current, instance: "new-server", running: "new-build" })).toBe("reload");
  });

  it("does not mistake a dropped request or an on-disk stamp change for a restart", () => {
    expect(restartOutcome("old-server", { ...current, running: "new-build" })).toBe("waiting");
  });

  it("reports failed and abandoned releases instead of spinning forever", () => {
    expect(restartOutcome("old-server", { ...current, progress: { ...current.progress, failed: "Build failed" } })).toBe("failed");
    expect(restartOutcome("old-server", { ...current, updating: false, progress: { ...current.progress, quietFor: 901 } })).toBe("abandoned");
  });

  it("bounds a request that never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    const result = expect(fetchRelease("/api/update/progress", {}, 500)).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(500);
    await result;
  });

  it("treats HTTP errors as offline instead of a healthy restart", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(fetchRelease("/api/update/progress")).rejects.toThrow("503");
  });
});
