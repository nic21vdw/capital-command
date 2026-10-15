import { describe, expect, it, vi } from "vitest";
import { followPreviewPlayback, previewNeedsFill } from "./previewPlayback";

class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = true;
  ended = false;
  seeking = false;
  readyState = 0;
  playbackRate = 1;
  preload = "none";
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  emit(name: string) { this.dispatchEvent(new Event(name)); }
}

class FakeVisibility extends EventTarget {
  hidden = false;
  change(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function setup(playing = false) {
  const foreground = new FakeVideo();
  const fill = new FakeVideo();
  const visibility = new FakeVisibility();
  foreground.paused = !playing;
  foreground.readyState = 4;
  const stop = followPreviewPlayback(
    foreground as unknown as HTMLVideoElement,
    fill as unknown as HTMLVideoElement,
    visibility as unknown as Document
  );
  return { foreground, fill, visibility, stop };
}

async function settlePlayback() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("preview fill geometry", () => {
  it("uses one decoder for a finished portrait render and a matching widescreen master", () => {
    expect(previewNeedsFill(9 / 16, 9 / 16, 1.33)).toBe(false);
    expect(previewNeedsFill(16 / 9, 16 / 9, 1)).toBe(false);
  });

  it("keeps the fill for letterboxed footage until the foreground covers it", () => {
    expect(previewNeedsFill(16 / 9, 9 / 16, 1.33)).toBe(true);
    expect(previewNeedsFill(1, 9 / 16, 1)).toBe(true);
    expect(previewNeedsFill(1, 9 / 16, 2)).toBe(false);
    expect(previewNeedsFill(9 / 16, 16 / 9, 1.33)).toBe(true);
    expect(previewNeedsFill(null, 9 / 16, 1.33)).toBe(true);
  });
});

describe("preview fill playback", () => {
  it("does not fetch or seek an idle fill and starts from the driver's clock", async () => {
    const { foreground, fill, stop } = setup();
    foreground.currentTime = 12;
    foreground.emit("timeupdate");
    expect(fill.play).not.toHaveBeenCalled();
    expect(fill.preload).toBe("none");
    expect(fill.currentTime).toBe(0);
    foreground.paused = false;
    foreground.emit("play");
    await settlePlayback();
    expect(fill.play).toHaveBeenCalledTimes(1);
    expect(fill.preload).toBe("auto");
    expect(fill.currentTime).toBe(12);
    foreground.playbackRate = 1.5;
    foreground.emit("ratechange");
    expect(fill.playbackRate).toBe(1.5);
    stop();
  });

  it("loads an explicitly scrubbed paused fill once and retries the seek at metadata", () => {
    const { foreground, fill, stop } = setup();
    let currentTime = 0;
    Object.defineProperty(fill, "currentTime", {
      get: () => currentTime,
      set: (value: number) => {
        if (fill.readyState === 0) throw new Error("not seekable yet");
        currentTime = value;
      }
    });
    foreground.currentTime = 12;
    foreground.emit("timeupdate");
    expect(fill.load).not.toHaveBeenCalled();
    expect(fill.preload).toBe("none");
    foreground.emit("seeked");
    expect(fill.load).toHaveBeenCalledTimes(1);
    expect(fill.preload).toBe("auto");
    expect(fill.currentTime).toBe(0);
    // Further scrubs while the first load is in flight must not restart it.
    foreground.currentTime = 18;
    foreground.emit("seeked");
    expect(fill.load).toHaveBeenCalledTimes(1);
    fill.readyState = 1;
    fill.emit("loadedmetadata");
    expect(fill.currentTime).toBe(18);
    expect(fill.play).not.toHaveBeenCalled();
    expect(fill.paused).toBe(true);
    stop();
  });

  it("pauses while hidden and resumes only if the driver still plays", async () => {
    const { foreground, fill, visibility, stop } = setup(true);
    await settlePlayback();
    visibility.change(true);
    expect(fill.paused).toBe(true);
    foreground.currentTime = 25;
    visibility.change(false);
    await settlePlayback();
    expect(fill.currentTime).toBe(25);
    expect(fill.paused).toBe(false);
    visibility.change(true);
    foreground.paused = true;
    foreground.emit("pause");
    const plays = fill.play.mock.calls.length;
    visibility.change(false);
    expect(fill.play).toHaveBeenCalledTimes(plays);
    expect(fill.paused).toBe(true);
    stop();
  });

  it("stops during buffering, seeks and ending, then resynchronizes on playback", async () => {
    const { foreground, fill, stop } = setup(true);
    await settlePlayback();
    foreground.emit("waiting");
    expect(fill.paused).toBe(true);
    foreground.currentTime = 18;
    foreground.emit("playing");
    await settlePlayback();
    expect(fill.currentTime).toBe(18);
    expect(fill.paused).toBe(false);
    foreground.seeking = true;
    foreground.emit("seeking");
    expect(fill.paused).toBe(true);
    foreground.currentTime = 35;
    foreground.seeking = false;
    foreground.emit("seeked");
    await settlePlayback();
    expect(fill.currentTime).toBe(35);
    expect(fill.paused).toBe(false);
    foreground.ended = true;
    foreground.emit("ended");
    expect(fill.paused).toBe(true);
    stop();
  });

  it("seeks only after visible drift and retries a fill that was not seekable yet", () => {
    const { foreground, fill, stop } = setup();
    fill.readyState = 1;
    foreground.currentTime = 0.2;
    foreground.emit("timeupdate");
    expect(fill.currentTime).toBe(0);
    foreground.currentTime = 1;
    foreground.emit("seeked");
    expect(fill.currentTime).toBe(1);
    let seekable = false;
    let currentTime = 0;
    Object.defineProperty(fill, "currentTime", {
      get: () => currentTime,
      set: (value: number) => {
        if (!seekable) throw new Error("metadata pending");
        currentTime = value;
      }
    });
    expect(() => foreground.emit("seeked")).not.toThrow();
    seekable = true;
    fill.emit("loadedmetadata");
    expect(fill.currentTime).toBe(1);
    stop();
  });

  it("removes listeners and pauses a play request that settles after cleanup", async () => {
    const { foreground, fill, visibility, stop } = setup();
    let finish!: () => void;
    fill.play.mockImplementation(() => new Promise<void>((resolve) => {
      finish = () => { fill.paused = false; resolve(); };
    }));
    foreground.paused = false;
    foreground.emit("play");
    stop();
    finish();
    await settlePlayback();
    await settlePlayback();
    expect(fill.paused).toBe(true);
    foreground.emit("play");
    fill.emit("loadedmetadata");
    visibility.change(true);
    visibility.change(false);
    expect(fill.play).toHaveBeenCalledTimes(1);
  });
});
