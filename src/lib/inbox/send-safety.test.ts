import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReconnectNeededError, ReplyRefusedError, ReplyUnrecordedError, SendUnknownError, sendReply } from "@/lib/inbox/send";
import { readInbox, updateInbox } from "@/lib/inbox/store";
import { emptyInbox, type InboxItem } from "@/lib/inbox/types";
import { jsonResponse, sampleItem, stubFetch, writeCalls, type FetchCall } from "@/lib/inbox/test-helpers";
import { createQuotaLedger, quotaLedgerFile } from "@/lib/youtube/quotaLedger";

const actualStore = await vi.importActual<typeof import("@/lib/inbox/store")>("@/lib/inbox/store");

vi.mock("@/lib/publisher/adapters/youtube", () => ({ youtubeAccessToken: vi.fn(async () => "yt-token") }));
vi.mock("@/lib/inbox/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inbox/store")>();
  return { ...actual, readInbox: vi.fn(actual.readInbox), updateInbox: vi.fn(actual.updateInbox) };
});

const NOW = new Date("2026-10-13T12:00:00.000Z");
const quota = createQuotaLedger({ now: () => NOW });
const FAST = { now: NOW, retryDelaysMs: [0, 0, 0], quota };

const ytScopes = (call: FetchCall) =>
  call.url.includes("tokeninfo") ? jsonResponse({ scope: "https://www.googleapis.com/auth/youtube.force-ssl" }) : null;

async function seed(item: InboxItem) {
  await actualStore.updateInbox(() => ({ ...emptyInbox(), items: [item] }));
  vi.mocked(updateInbox).mockClear();
  vi.mocked(readInbox).mockClear();
}

const onDisk = async (id = "youtube:c1") => (await actualStore.readInbox()).items.find((item) => item.id === id) as InboxItem;

beforeEach(async () => {
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-id");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh");
  vi.stubEnv("IG_USER_ID", "ig-user");
  vi.stubEnv("IG_ACCESS_TOKEN", "ig-token");
  vi.stubEnv("THREADS_ACCESS_TOKEN", "th-token");
  vi.stubEnv("THREADS_USER_ID", "555");
  await actualStore.updateInbox(() => emptyInbox());
  await rm(quotaLedgerFile(), { force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.mocked(updateInbox).mockImplementation(actualStore.updateInbox);
});

describe("two sends at once", () => {
  it("lets exactly one reach the platform, and the refused one never touches the store", async () => {
    await seed(sampleItem());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = stubFetch(async (call) => {
      const scope = ytScopes(call);
      if (scope) return scope;
      await gate;
      return jsonResponse({ id: "r1" });
    });

    const first = sendReply("youtube:c1", "Thanks", FAST);
    const second = sendReply("youtube:c1", "Thanks", FAST);
    await expect(second).rejects.toThrow(/already being sent/i);

    expect(readInbox).not.toHaveBeenCalled();
    expect(updateInbox).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(writeCalls(calls)).toHaveLength(1);
    expect((await onDisk()).status).toBe("replied");
  });

  it("refuses a second send that starts after the first has been recorded", async () => {
    await seed(sampleItem());
    const calls = stubFetch((call) => ytScopes(call) ?? jsonResponse({ id: "r1" }));

    await sendReply("youtube:c1", "Thanks", FAST);
    await expect(sendReply("youtube:c1", "Thanks again", FAST)).rejects.toThrow(/already answered/i);

    expect(writeCalls(calls)).toHaveLength(1);
  });
});

describe("the durable sending record", () => {
  it("is on disk, with a timestamp and the text, before the platform is called", async () => {
    await seed(sampleItem());
    let seen: InboxItem["send"];
    stubFetch(async (call) => {
      const scope = ytScopes(call);
      if (scope) return scope;
      seen = (await onDisk()).send;
      return jsonResponse({ id: "r1" });
    });

    await sendReply("youtube:c1", "Thanks", FAST);

    expect(seen).toEqual({ state: "sending", at: NOW.toISOString(), text: "Thanks" });
    expect((await onDisk()).send).toBeUndefined();
  });

  it("leaves nothing behind when the platform refuses the reply outright", async () => {
    await seed(sampleItem());
    const calls = stubFetch((call) => ytScopes(call) ?? jsonResponse({ error: { code: 400, message: "Invalid parameter" } }, 400));

    await expect(sendReply("youtube:c1", "Thanks", FAST)).rejects.not.toBeInstanceOf(SendUnknownError);

    const item = await onDisk();
    expect(item.send).toBeUndefined();
    expect(item.status).toBe("new");

    stubFetch((call) => ytScopes(call) ?? jsonResponse({ id: "r2" }));
    await sendReply("youtube:c1", "Thanks", FAST);
    expect((await onDisk()).status).toBe("replied");
    expect(writeCalls(calls)).toHaveLength(1);
  });

  it("treats a rate limit as a clean refusal too", async () => {
    await seed(sampleItem());
    stubFetch((call) => ytScopes(call) ?? jsonResponse({ error: { message: "slow down" } }, 429));

    await expect(sendReply("youtube:c1", "Thanks", FAST)).rejects.not.toBeInstanceOf(SendUnknownError);
    expect((await onDisk()).send).toBeUndefined();
  });

  it("turns a permission refusal from the POST into the reconnect message and clears the record", async () => {
    await seed(sampleItem());
    stubFetch(
      (call) =>
        ytScopes(call) ??
        jsonResponse({ error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }] } }, 403)
    );

    await expect(sendReply("youtube:c1", "Thanks", FAST)).rejects.toBeInstanceOf(ReconnectNeededError);
    expect((await onDisk()).send).toBeUndefined();
  });
});

describe("an ambiguous failure", () => {
  const ambiguous: Array<[string, (call: FetchCall) => Response | Promise<Response>]> = [
    [
      "a timeout or dropped connection",
      (call) => {
        const scope = ytScopes(call);
        if (scope) return scope;
        throw new TypeError("fetch failed");
      }
    ],
    ["a 500 from the platform", (call) => ytScopes(call) ?? jsonResponse({ error: { message: "backend error" } }, 500)],
    ["a 408 request timeout", (call) => ytScopes(call) ?? jsonResponse({ error: { message: "timeout" } }, 408)]
  ];

  it.each(ambiguous)("marks the item send-unknown after %s and refuses a plain resend", async (_name, handler) => {
    await seed(sampleItem());
    const calls = stubFetch(handler);

    const failure = await sendReply("youtube:c1", "Thanks", FAST).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SendUnknownError);
    const item = await onDisk();
    expect(item.status).toBe("new");
    expect(item.send).toMatchObject({ state: "send-unknown", text: "Thanks", at: NOW.toISOString() });
    expect(item.send?.error).toBeTruthy();

    const refused = await sendReply("youtube:c1", "Thanks", FAST).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ReplyRefusedError);
    expect(refused).toMatchObject({ status: 409, kind: "send-unknown" });
    expect(writeCalls(calls)).toHaveLength(1);
  });

  it("sends again only with an explicit override, and then records it", async () => {
    await seed(sampleItem({ send: { state: "send-unknown", at: NOW.toISOString(), text: "Thanks", error: "timeout" } }));
    const calls = stubFetch((call) => ytScopes(call) ?? jsonResponse({ id: "r9" }));

    await expect(sendReply("youtube:c1", "Thanks", FAST)).rejects.toMatchObject({ kind: "send-unknown" });
    expect(writeCalls(calls)).toEqual([]);

    await sendReply("youtube:c1", "Thanks", { ...FAST, override: true });

    expect(writeCalls(calls)).toHaveLength(1);
    const item = await onDisk();
    expect(item).toMatchObject({ status: "replied", reply: { externalId: "r9" } });
    expect(item.send).toBeUndefined();
  });

  it("treats a sending record left by a restart as possibly posted", async () => {
    await seed(sampleItem({ send: { state: "sending", at: "2026-10-13T11:00:00.000Z", text: "Thanks" } }));
    const calls = stubFetch((call) => ytScopes(call) ?? jsonResponse({ id: "r1" }));

    await expect(sendReply("youtube:c1", "Thanks", FAST)).rejects.toMatchObject({ status: 409, kind: "send-unknown" });
    expect(writeCalls(calls)).toEqual([]);
  });

  it("is ambiguous on Threads when publishing returns no post id, but not when the container is refused", async () => {
    const item = sampleItem({ id: "threads:th-r", platform: "threads", accountId: "primary", externalId: "th-r", postId: "th-media" });

    await seed(item);
    stubFetch((call) => (call.url.endsWith("/threads_publish") ? jsonResponse({}) : jsonResponse({ id: "container-1" })));
    await expect(sendReply(item.id, "Thanks", FAST)).rejects.toBeInstanceOf(SendUnknownError);
    expect((await onDisk(item.id)).send?.state).toBe("send-unknown");

    await seed(item);
    stubFetch((call) => (call.url.endsWith("/threads_publish") ? jsonResponse({ error: { message: "bad gateway" } }, 502) : jsonResponse({ id: "container-1" })));
    await expect(sendReply(item.id, "Thanks", FAST)).rejects.toBeInstanceOf(SendUnknownError);

    await seed(item);
    stubFetch(() => jsonResponse({ error: { message: "Invalid parameter" } }, 400));
    await expect(sendReply(item.id, "Thanks", FAST)).rejects.not.toBeInstanceOf(SendUnknownError);
    expect((await onDisk(item.id)).send).toBeUndefined();

    await seed(item);
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(sendReply(item.id, "Thanks", FAST)).rejects.not.toBeInstanceOf(SendUnknownError);
    expect((await onDisk(item.id)).send).toBeUndefined();
  });
});

describe("recording the reply after the platform accepted it", () => {
  const platform = (onPost: () => void) =>
    stubFetch((call) => {
      const scope = ytScopes(call);
      if (scope) return scope;
      onPost();
      return jsonResponse({ id: "r1" });
    });

  it("retries a failed save instead of posting again", async () => {
    await seed(sampleItem());
    let failures = 0;
    const calls = platform(() => {
      failures = 2;
    });
    vi.mocked(updateInbox).mockImplementation(async (mutate) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("disk busy");
      }
      return actualStore.updateInbox(mutate);
    });

    const result = await sendReply("youtube:c1", "Thanks", FAST);

    expect(result.externalId).toBe("r1");
    expect(writeCalls(calls)).toHaveLength(1);
    expect((await onDisk()).status).toBe("replied");
  });

  it("keeps the sending record when saving never works, and refuses a plain resend", async () => {
    await seed(sampleItem());
    let failing = false;
    const calls = platform(() => {
      failing = true;
    });
    vi.mocked(updateInbox).mockImplementation(async (mutate) => {
      if (failing) throw new Error("disk full");
      return actualStore.updateInbox(mutate);
    });

    await expect(sendReply("youtube:c1", "Thanks", FAST)).rejects.toBeInstanceOf(ReplyUnrecordedError);

    failing = false;
    const item = await onDisk();
    expect(item.status).toBe("new");
    expect(item.send?.state).toBe("sending");
    await expect(sendReply("youtube:c1", "Thanks", FAST)).rejects.toMatchObject({ kind: "send-unknown" });
    expect(writeCalls(calls)).toHaveLength(1);
  });
});

describe("what is posted", () => {
  it("posts a Threads reply exactly as stored, without rewriting links", async () => {
    const item = sampleItem({ id: "threads:th-r", platform: "threads", accountId: "primary", externalId: "th-r", postId: "th-media" });
    await seed(item);
    const calls = stubFetch((call) => (call.url.endsWith("/threads_publish") ? jsonResponse({ id: "posted" }) : jsonResponse({ id: "container-1" })));
    const text = "Details are on https://colateralai.com now";

    await sendReply(item.id, text, FAST);

    expect(new URLSearchParams(writeCalls(calls)[0].body).get("text")).toBe(text);
    expect((await onDisk(item.id)).reply?.text).toBe(text);
  });

  it("answers an Instagram mention through the mentions endpoint, not the comment replies edge", async () => {
    const item = sampleItem({
      id: "instagram:mention:c-9",
      platform: "instagram",
      accountId: "instagram-primary",
      externalId: "c-9",
      postId: "media77",
      kind: "mention"
    });
    await seed(item);
    const calls = stubFetch((call) => (call.url.includes("debug_token") ? jsonResponse({ data: { scopes: ["instagram_manage_comments"] } }) : jsonResponse({ id: "m-reply" })));

    await sendReply(item.id, "Thanks for the mention", FAST);

    const write = writeCalls(calls)[0];
    expect(new URL(write.url).pathname.endsWith("/ig-user/mentions")).toBe(true);
    const form = new URLSearchParams(write.body);
    expect(form.get("media_id")).toBe("media77");
    expect(form.get("comment_id")).toBe("c-9");
    expect(form.get("message")).toBe("Thanks for the mention");
  });
});

describe("YouTube quota", () => {
  it("charges 50 units as 'inbox-reply' for each reply attempt, including one the platform refused", async () => {
    await seed(sampleItem());
    stubFetch((call) => ytScopes(call) ?? jsonResponse({ error: { message: "Invalid parameter" } }, 400));
    await sendReply("youtube:c1", "Thanks", FAST).catch(() => undefined);
    expect((await quota.snapshot()).byPurpose).toEqual({ "inbox-reply": 50 });

    stubFetch((call) => ytScopes(call) ?? jsonResponse({ id: "r1" }));
    await sendReply("youtube:c1", "Thanks", FAST);
    expect((await quota.snapshot()).byPurpose).toEqual({ "inbox-reply": 100 });
  });

  it("is not blocked by a spent read budget, or by an allowance that is already gone, but is counted", async () => {
    await seed(sampleItem());
    await quota.debit(200, "inbox");
    await quota.debit(100, "listening");
    expect((await quota.snapshot()).nonUploadRemaining).toBe(0);
    const calls = stubFetch((call) => ytScopes(call) ?? jsonResponse({ id: "r1" }));

    await sendReply("youtube:c1", "Thanks", FAST);

    expect((await onDisk()).status).toBe("replied");
    expect(writeCalls(calls)).toHaveLength(1);
    expect((await quota.snapshot()).byPurpose).toEqual({ inbox: 200, listening: 100, "inbox-reply": 50 });
  });

  it("still posts when the ledger cannot be read", async () => {
    await seed(sampleItem());
    await mkdir(path.dirname(quotaLedgerFile()), { recursive: true });
    await writeFile(quotaLedgerFile(), "{ not json");
    stubFetch((call) => ytScopes(call) ?? jsonResponse({ id: "r1" }));

    await sendReply("youtube:c1", "Thanks", FAST);

    expect((await onDisk()).status).toBe("replied");
  });

  it("no longer writes the old counter in the inbox store", async () => {
    await seed(sampleItem());
    stubFetch((call) => ytScopes(call) ?? jsonResponse({ id: "r1" }));

    await sendReply("youtube:c1", "Thanks", FAST);

    expect((await actualStore.readInbox()).youtubeUnits).toBeUndefined();
  });
});
