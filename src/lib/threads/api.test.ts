import { afterEach, describe, expect, it, vi } from "vitest";
import { accountUserId, createTextContainer, postToThreads, ContainerRejectedError, ThreadsPublishPausedError } from "@/lib/threads/api";
import type { ThreadsAccount, ThreadsConfig } from "@/lib/threads/config";

function config(): ThreadsConfig {
  return {
    enabled: true,
    accounts: [],
    apiBase: "https://graph.threads.net",
    apiVersion: "v1.0",
    timezone: "UTC",
    postsPerDay: 24,
    lateGraceMinutes: 45,
    maxAttempts: 4,
    backoffBaseMinutes: 5,
    backoffCapMinutes: 60,
    claimTimeoutMinutes: 10,
    retentionDays: 14,
    planAheadHour: 21,
    catchUp: true,
    catchUpMinGapMinutes: 20,
    catchUpMinShortfall: 2,
    catchUpCooldownMinutes: 60,
    plugReplies: true,
    plugUrl: "https://colateralai.com",
    plugDelayMinutes: 2,
    plugWindowMinutes: 360
  };
}

let tokenCounter = 0;

function account(overrides: Partial<ThreadsAccount> = {}): ThreadsAccount {
  tokenCounter += 1;
  return {
    id: "primary",
    label: "primary",
    userId: null,
    // A fresh token per account keeps the resolved-id cache from leaking
    // between tests.
    accessToken: `token-${tokenCounter}`,
    posts: "text",
    offsetMinutes: 0,
    ...overrides
  };
}

function stubFetch(id: string) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id, username: "someone" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("postToThreads delivery safety", () => {
  function platformResponses(responses: Array<{ status?: number; id?: string }>) {
    const fetchMock = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("Unexpected platform call");
      return new Response(JSON.stringify(next.id ? { id: next.id } : { error: "Rejected" }), { status: next.status ?? 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("waits for the new container to be saved before publishing it", async () => {
    const fetchMock = platformResponses([{ id: "container" }, { id: "post" }]);
    let release!: () => void;
    const saved = new Promise<void>((resolve) => { release = resolve; });
    const onContainerCreated = vi.fn(async () => saved);
    const posting = postToThreads({ account: account({ userId: "1" }), text: "the post", onContainerCreated }, config());
    await vi.waitFor(() => expect(onContainerCreated).toHaveBeenCalledWith("container"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    await expect(posting).resolves.toEqual({ containerId: "container", postId: "post" });
  });

  it("does not publish when saving the newly created container fails", async () => {
    const fetchMock = platformResponses([{ id: "container" }]);
    const failure = new Error("disk unavailable");
    await expect(postToThreads({
      account: account({ userId: "1" }), text: "the post", onContainerCreated: async () => { throw failure; }
    }, config())).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps permanent publish failures permanent and carries the container", async () => {
    const fetchMock = platformResponses([{ id: "container" }, { status: 400 }]);
    const posting = postToThreads({ account: account({ userId: "1" }), text: "the post" }, config());
    await expect(posting).rejects.toBeInstanceOf(ContainerRejectedError);
    await expect(posting).rejects.toMatchObject({ transient: false, containerId: "container" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses a persisted container without creating one again", async () => {
    const fetchMock = platformResponses([{ id: "post" }]);
    const onContainerCreated = vi.fn();
    await expect(postToThreads({
      account: account({ userId: "1" }), text: "the post", containerId: "existing", onContainerCreated
    }, config())).resolves.toEqual({ containerId: "existing", postId: "post" });
    expect(onContainerCreated).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("threads_publish");
  });

  it("stops before any network call when delivery is switched off", async () => {
    const fetchMock = platformResponses([]);
    await expect(postToThreads({ account: account({ userId: "1" }), text: "the post", shouldPublish: async () => false }, config()))
      .rejects.toBeInstanceOf(ThreadsPublishPausedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks controls again after resolving the account on the network", async () => {
    let allowed = true;
    const fetchMock = vi.fn(async () => {
      allowed = false;
      return new Response(JSON.stringify({ id: "user-id" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(postToThreads({ account: account(), text: "the post", shouldPublish: async () => allowed }, config()))
      .rejects.toBeInstanceOf(ThreadsPublishPausedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("persists the container but skips publishing if paused during creation", async () => {
    const fetchMock = platformResponses([{ id: "container" }]);
    let allowed = true;
    const onContainerCreated = vi.fn(async () => { allowed = false; });
    await expect(postToThreads({
      account: account({ userId: "1" }), text: "the post", onContainerCreated, shouldPublish: async () => allowed
    }, config())).rejects.toMatchObject({ containerId: "container" });
    expect(onContainerCreated).toHaveBeenCalledWith("container");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("checks controls after a publish retry wait instead of retrying after pause", async () => {
    vi.useFakeTimers();
    let allowed = true;
    const fetchMock = vi.fn(async () => {
      allowed = false;
      return new Response(JSON.stringify({ error: "busy" }), { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const posting = postToThreads({ account: account({ userId: "1" }), text: "the post", containerId: "existing", shouldPublish: async () => allowed }, config());
    const rejection = expect(posting).rejects.toMatchObject({ containerId: "existing" });
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("accountUserId", () => {
  it("uses the configured id without calling out", async () => {
    const fetchMock = stubFetch("999");

    await expect(accountUserId(account({ userId: "12345" }), config())).resolves.toBe("12345");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the id from the token when none is configured", async () => {
    stubFetch("777");
    await expect(accountUserId(account(), config())).resolves.toBe("777");
  });

  it("looks a token up once and reuses the answer", async () => {
    const fetchMock = stubFetch("555");
    const connected = account();

    await accountUserId(connected, config());
    await accountUserId(connected, config());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never puts the token in the URL", async () => {
    const fetchMock = stubFetch("321");
    const connected = account({ accessToken: "super-secret-token" });

    await accountUserId(connected, config());

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).not.toContain("super-secret-token");
  });
});

describe("createTextContainer", () => {
  it("sends the Threads attribution link in place of the bare domain", async () => {
    const fetchMock = stubFetch("container-1");

    await createTextContainer(account({ userId: "1" }), "Try it: https://colateralai.com", config());

    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("text")).toBe("Try it: https://colateralai.com/th");
  });

  it("adds the post's code to the Threads link when one is given", async () => {
    const fetchMock = stubFetch("container-1");

    await createTextContainer(account({ userId: "1" }), "Try it: https://colateralai.com", config(), undefined, "a3f9c2");

    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("text")).toBe("Try it: https://colateralai.com/th?c=a3f9c2");
  });

  it("carries the code through postToThreads", async () => {
    const fetchMock = stubFetch("container-1");

    await postToThreads({ account: account({ userId: "1" }), text: "Try it: colateralai.com", attributionCode: "a3f9c2" }, config());

    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("text")).toBe("Try it: colateralai.com/th?c=a3f9c2");
  });

  it("adds the code to a stored link reply that already has its Threads path and utm tags", async () => {
    const fetchMock = stubFetch("container-1");
    const reply = "Explore CoLateral:\nhttps://colateralai.com/th?utm_source=threads&utm_medium=social";

    await createTextContainer(account({ userId: "1" }), reply, config(), "post-main", "a3f9c2");

    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("text")).toBe(`${reply}&c=a3f9c2`);
  });

  describe("the 500 character limit", () => {
    const sent = (fetchMock: ReturnType<typeof stubFetch>) =>
      ((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).get("text")!;

    it("sends a post with its code when the coded text is exactly 500 characters", async () => {
      const fetchMock = stubFetch("container-1");
      const text = `${"a".repeat(472)} colateralai.com`;

      await createTextContainer(account({ userId: "1" }), text, config(), undefined, "a3f9c2");

      expect(sent(fetchMock)).toHaveLength(500);
      expect(sent(fetchMock)).toMatch(/colateralai\.com\/th\?c=a3f9c2$/);
    });

    it("sends a post without its code when the code would take it to 501", async () => {
      const fetchMock = stubFetch("container-1");
      const text = `${"a".repeat(473)} colateralai.com`;

      await createTextContainer(account({ userId: "1" }), text, config(), undefined, "a3f9c2");

      expect(sent(fetchMock)).toBe(`${"a".repeat(473)} colateralai.com/th`);
      expect(sent(fetchMock).length).toBeLessThanOrEqual(500);
    });

    it("sends a link reply with its code when the coded reply is exactly 500 characters", async () => {
      const fetchMock = stubFetch("container-1");
      const link = "https://colateralai.com/th?utm_source=threads";
      const text = `${"b".repeat(500 - "\n".length - link.length - "&c=a3f9c2".length)}\n${link}`;

      await createTextContainer(account({ userId: "1" }), text, config(), "post-main", "a3f9c2");

      expect(sent(fetchMock)).toHaveLength(500);
      expect(sent(fetchMock).endsWith("&c=a3f9c2")).toBe(true);
    });

    it("sends a link reply without its code when the code would take it to 501", async () => {
      const fetchMock = stubFetch("container-1");
      const link = "https://colateralai.com/th?utm_source=threads";
      const text = `${"b".repeat(500 - "\n".length - link.length - "&c=a3f9c2".length + 1)}\n${link}`;

      await createTextContainer(account({ userId: "1" }), text, config(), "post-main", "a3f9c2");

      expect(text + "&c=a3f9c2").toHaveLength(501);
      expect(sent(fetchMock)).toBe(text);
    });
  });
});
