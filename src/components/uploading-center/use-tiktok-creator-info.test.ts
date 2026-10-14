import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INFO = {
  nickname: "Nic",
  handle: "nicvandewetering",
  avatarUrl: "https://p16.tiktokcdn.example/a.jpeg",
  privacyLevels: ["SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: false,
  maxVideoSeconds: 600,
  audited: false
};

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function load() {
  vi.resetModules();
  return (await import("@/components/uploading-center/use-tiktok-creator-info")).loadCreatorInfo;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loadCreatorInfo", () => {
  it("asks TikTok once for panels opened together, and splits audited off the creator's own settings", async () => {
    const fetchMock = vi.fn(async () => answer(INFO));
    vi.stubGlobal("fetch", fetchMock);
    const loadCreatorInfo = await load();

    const [first, second] = await Promise.all([loadCreatorInfo("tiktok"), loadCreatorInfo("tiktok")]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.status).toBe("ready");
    if (first.status === "ready") {
      expect(first.audited).toBe(false);
      expect(first.info.avatarUrl).toBe(INFO.avatarUrl);
      expect(first.info).not.toHaveProperty("audited");
    }
  });

  it("asks again once the answer is old, so the panel never shows last hour's settings", async () => {
    const fetchMock = vi.fn(async () => answer(INFO));
    vi.stubGlobal("fetch", fetchMock);
    const loadCreatorInfo = await load();

    await loadCreatorInfo("tiktok");
    vi.setSystemTime(new Date("2026-10-13T12:01:00Z"));
    await loadCreatorInfo("tiktok");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps two connected accounts apart", async () => {
    const fetchMock = vi.fn(async () => answer(INFO));
    vi.stubGlobal("fetch", fetchMock);
    const loadCreatorInfo = await load();

    await loadCreatorInfo("tiktok");
    await loadCreatorInfo("tiktok-second");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not remember a failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(answer({ error: "TikTok would not answer." }, 502))
      .mockResolvedValueOnce(answer(INFO));
    vi.stubGlobal("fetch", fetchMock);
    const loadCreatorInfo = await load();

    const failed = await loadCreatorInfo("tiktok");
    const retried = await loadCreatorInfo("tiktok");

    expect(failed).toEqual({ status: "error", message: "TikTok would not answer.", cannotPostNow: false });
    expect(retried.status).toBe("ready");
  });

  it("marks an account TikTok will not let post right now", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer({ error: "This account cannot post to TikTok right now. Try again later.", cannotPostNow: true }, 429))
    );
    const loadCreatorInfo = await load();

    const state = await loadCreatorInfo("tiktok");

    expect(state).toEqual({
      status: "error",
      message: "This account cannot post to TikTok right now. Try again later.",
      cannotPostNow: true
    });
  });
});
