import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollWhileVisible } from "./visiblePolling";

let hidden = false;
let visibility: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  visibility = undefined;
  vi.stubGlobal("document", {
    get hidden() { return hidden; },
    addEventListener: vi.fn((_name: string, listener: () => void) => { visibility = listener; }),
    removeEventListener: vi.fn()
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("visible UI polling", () => {
  it("cancels an initial read when its mount is superseded immediately", async () => {
    const read = vi.fn(async () => {});
    const stop = pollWhileVisible(read, 100);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does no background reads and refreshes immediately on return", async () => {
    const read = vi.fn(async () => {});
    const stop = pollWhileVisible(read, 60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    hidden = true;
    visibility?.();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(read).toHaveBeenCalledTimes(1);
    hidden = false;
    visibility?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });

  it("waits for slow reads and starts the next interval after completion", async () => {
    let finish!: () => void;
    const read = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = pollWhileVisible(read, 100);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(99);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    finish();
  });

  it("coalesces visibility changes during a read into one fresh follow-up", async () => {
    let finish!: () => void;
    const read = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = pollWhileVisible(read, 100);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 3; i++) {
      hidden = true; visibility?.();
      hidden = false; visibility?.();
    }
    expect(read).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    finish();
  });

  it("cleans up even when a read finishes after unmount", async () => {
    let finish!: () => void;
    const read = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = pollWhileVisible(read, 100);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    visibility?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(document.removeEventListener).toHaveBeenCalledWith("visibilitychange", visibility);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers after a rejected read and does not read on an initially hidden mount", async () => {
    hidden = true;
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const stop = pollWhileVisible(read, 100);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled();
    hidden = false; visibility?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });
});
