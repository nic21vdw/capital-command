import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReconnectNeededError, sendReply } from "@/lib/inbox/send";
import { readInbox, updateInbox } from "@/lib/inbox/store";
import { emptyInbox, type InboxItem } from "@/lib/inbox/types";
import { jsonResponse, sampleItem, stubFetch, writeCalls, type FetchCall } from "@/lib/inbox/test-helpers";

vi.mock("@/lib/publisher/adapters/youtube", () => ({ youtubeAccessToken: vi.fn(async () => "yt-token") }));

const NOW = new Date("2026-10-13T12:00:00.000Z");

async function seed(item: InboxItem) {
  await updateInbox(() => ({ ...emptyInbox(), items: [item] }));
}

const stored = async (id: string) => (await readInbox()).items.find((item) => item.id === id);

beforeEach(async () => {
  vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-id");
  vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-secret");
  vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh");
  vi.stubEnv("IG_USER_ID", "ig-user");
  vi.stubEnv("IG_ACCESS_TOKEN", "ig-token");
  vi.stubEnv("IG_APP_ID", "app-id");
  vi.stubEnv("IG_APP_SECRET", "app-secret");
  vi.stubEnv("FB_PAGE_ID", "page1");
  vi.stubEnv("FB_PAGE_ACCESS_TOKEN", "fb-token");
  vi.stubEnv("THREADS_ACCESS_TOKEN", "th-token");
  vi.stubEnv("THREADS_USER_ID", "555");
  await updateInbox(() => emptyInbox());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendReply on YouTube", () => {
  const scopes = (scope: string) => (call: FetchCall) =>
    call.url.includes("tokeninfo")
      ? jsonResponse({ scope })
      : jsonResponse({ id: "reply-1" });

  it("posts comments.insert under the top-level comment once the force-ssl scope is confirmed", async () => {
    await seed(sampleItem({ id: "youtube:top.sub", externalId: "top.sub", kind: "reply", parentId: "top" }));
    const calls = stubFetch(scopes("https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl"));

    const result = await sendReply("youtube:top.sub", "Thanks, it does.", { now: NOW });

    const writes = writeCalls(calls);
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("POST");
    expect(new URL(writes[0].url).pathname).toBe("/youtube/v3/comments");
    expect(new URL(writes[0].url).searchParams.get("part")).toBe("snippet");
    expect(writes[0].headers.Authorization).toBe("Bearer yt-token");
    expect(JSON.parse(writes[0].body)).toEqual({ snippet: { parentId: "top", textOriginal: "Thanks, it does." } });
    expect(result.externalId).toBe("reply-1");
    expect(await stored("youtube:top.sub")).toMatchObject({
      status: "replied",
      statusAt: NOW.toISOString(),
      reply: { text: "Thanks, it does.", sentAt: NOW.toISOString(), externalId: "reply-1" }
    });
  });

  it("does not send when the token lacks youtube.force-ssl", async () => {
    await seed(sampleItem());
    const calls = stubFetch(scopes("https://www.googleapis.com/auth/youtube.upload"));

    await expect(sendReply("youtube:c1", "Thanks", { now: NOW })).rejects.toThrow(ReconnectNeededError);
    await expect(sendReply("youtube:c1", "Thanks", { now: NOW })).rejects.toThrow("Reconnect YouTube with comment permission");

    expect(writeCalls(calls)).toEqual([]);
    expect((await stored("youtube:c1"))?.status).toBe("new");
  });
});

describe("sendReply on Instagram", () => {
  const item = sampleItem({ id: "instagram:ig-c", platform: "instagram", accountId: "instagram-primary", externalId: "ig-c", postId: "m1" });
  const handler = (scopes: string[]) => (call: FetchCall) =>
    call.url.includes("debug_token") ? jsonResponse({ data: { scopes } }) : jsonResponse({ id: "ig-reply" });

  it("replies through /{comment-id}/replies after checking instagram_manage_comments", async () => {
    await seed(item);
    const calls = stubFetch(handler(["instagram_basic", "instagram_manage_comments"]));

    await sendReply(item.id, "Appreciate it", { now: NOW });

    const writes = writeCalls(calls);
    expect(writes).toHaveLength(1);
    expect(new URL(writes[0].url).pathname.endsWith("/ig-c/replies")).toBe(true);
    const form = new URLSearchParams(writes[0].body);
    expect(form.get("message")).toBe("Appreciate it");
    expect(form.get("access_token")).toBe("ig-token");
    expect((await stored(item.id))?.status).toBe("replied");
  });

  it("replies under the parent when answering a reply", async () => {
    await seed({ ...item, kind: "reply", parentId: "ig-parent" });
    const calls = stubFetch(handler(["instagram_manage_comments"]));

    await sendReply(item.id, "Yep", { now: NOW });

    expect(new URL(writeCalls(calls)[0].url).pathname.endsWith("/ig-parent/replies")).toBe(true);
  });

  it("refuses without instagram_manage_comments", async () => {
    await seed(item);
    const calls = stubFetch(handler(["instagram_basic", "instagram_content_publish"]));

    await expect(sendReply(item.id, "Appreciate it", { now: NOW })).rejects.toThrow("Reconnect Instagram with comment permission");

    expect(writeCalls(calls)).toEqual([]);
  });

  it("turns Meta's own permission refusal into the same reconnect message", async () => {
    vi.stubEnv("IG_APP_ID", "");
    await seed(item);
    stubFetch(() =>
      jsonResponse({ error: { message: "(#10) This endpoint requires the 'instagram_manage_comments' permission", type: "OAuthException", code: 10 } }, 400)
    );

    await expect(sendReply(item.id, "Appreciate it", { now: NOW })).rejects.toThrow("Reconnect Instagram with comment permission");
    expect((await stored(item.id))?.status).toBe("new");
  });
});

describe("sendReply on Facebook", () => {
  const item = sampleItem({ id: "facebook:p_5", platform: "facebook", accountId: "facebook-primary", externalId: "p_5", postId: "p" });

  it("comments on the comment after checking pages_manage_engagement", async () => {
    await seed(item);
    const calls = stubFetch((call) =>
      call.url.includes("debug_token") ? jsonResponse({ data: { scopes: ["pages_read_engagement", "pages_manage_engagement"] } }) : jsonResponse({ id: "fb-reply" })
    );

    await sendReply(item.id, "Glad it helped", { now: NOW });

    const writes = writeCalls(calls);
    expect(writes).toHaveLength(1);
    expect(new URL(writes[0].url).pathname.endsWith("/p_5/comments")).toBe(true);
    const form = new URLSearchParams(writes[0].body);
    expect(form.get("message")).toBe("Glad it helped");
    expect(form.get("access_token")).toBe("fb-token");
  });

  it("refuses without pages_manage_engagement", async () => {
    await seed(item);
    const calls = stubFetch((call) =>
      call.url.includes("debug_token") ? jsonResponse({ data: { scopes: ["pages_read_engagement", "pages_manage_posts"] } }) : jsonResponse({ id: "x" })
    );

    await expect(sendReply(item.id, "Glad it helped", { now: NOW })).rejects.toThrow("Reconnect Facebook with comment permission");
    expect(writeCalls(calls)).toEqual([]);
  });
});

describe("sendReply on Threads", () => {
  const item = sampleItem({ id: "threads:th-r", platform: "threads", accountId: "primary", externalId: "th-r", postId: "th-media", kind: "reply" });

  it("creates a reply container and publishes it", async () => {
    await seed(item);
    const calls = stubFetch((call) => (call.url.endsWith("/threads_publish") ? jsonResponse({ id: "th-posted" }) : jsonResponse({ id: "container-1" })));

    const result = await sendReply(item.id, "Appreciate you reading", { now: NOW });

    const writes = writeCalls(calls);
    expect(writes).toHaveLength(2);
    expect(writes[0].url).toBe("https://graph.threads.net/v1.0/555/threads");
    const create = new URLSearchParams(writes[0].body);
    expect(create.get("reply_to_id")).toBe("th-r");
    expect(create.get("media_type")).toBe("TEXT");
    expect(create.get("text")).toContain("Appreciate you reading");
    expect(writes[1].url).toBe("https://graph.threads.net/v1.0/555/threads_publish");
    expect(new URLSearchParams(writes[1].body).get("creation_id")).toBe("container-1");
    expect(result.externalId).toBe("th-posted");
    expect((await stored(item.id))?.status).toBe("replied");
  });

  it("turns a permission refusal into the reconnect message and leaves the item unanswered", async () => {
    await seed(item);
    stubFetch(() => jsonResponse({ error: { message: "(#10) Application does not have permission for this action", type: "THApiException", code: 10 } }, 403));

    await expect(sendReply(item.id, "Thanks", { now: NOW })).rejects.toThrow("Reconnect Threads with comment permission");
    expect((await stored(item.id))?.status).toBe("new");
  });
});

describe("sendReply guards", () => {
  it("refuses empty text, over-long text and unknown items before any call", async () => {
    await seed(sampleItem({ id: "threads:th-r", platform: "threads", accountId: "primary", externalId: "th-r" }));
    const calls = stubFetch(() => jsonResponse({ id: "x" }));

    await expect(sendReply("threads:th-r", "   ", { now: NOW })).rejects.toThrow(/empty/i);
    await expect(sendReply("threads:th-r", "x".repeat(501), { now: NOW })).rejects.toThrow(/too long/i);
    await expect(sendReply("threads:nope", "hi", { now: NOW })).rejects.toThrow(/not in the inbox/i);

    expect(calls).toEqual([]);
  });

  it("does not answer an item twice", async () => {
    await seed(sampleItem({ status: "replied", reply: { text: "already", sentAt: NOW.toISOString() } }));
    const calls = stubFetch(() => jsonResponse({ id: "x" }));

    await expect(sendReply("youtube:c1", "again", { now: NOW })).rejects.toThrow(/already answered/i);
    expect(calls).toEqual([]);
  });
});
