import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchBudgetExhausted } from "@/lib/inbox/fetch/common";
import { fetchFacebookComments } from "@/lib/inbox/fetch/facebook";
import { fetchInstagramComments } from "@/lib/inbox/fetch/instagram";
import { fetchThreadsReplies } from "@/lib/inbox/fetch/threads";
import { fetchYoutubeComments } from "@/lib/inbox/fetch/youtube";
import { jsonResponse, samplePost, stubFetch } from "@/lib/inbox/test-helpers";

const NOW = new Date("2026-10-13T09:00:00.000Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

function ytThread(id: string, at: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    snippet: {
      channelId: "UC_me",
      videoId: "vid1",
      topLevelComment: {
        id,
        snippet: {
          authorDisplayName: `Author ${id}`,
          authorChannelId: { value: "UC_other" },
          textDisplay: `text of ${id}`,
          publishedAt: at,
          ...extra
        }
      }
    }
  };
}

describe("YouTube commentThreads", () => {
  const auth = { accessToken: "yt-token" };

  it("reads top-level comments and their replies, skipping the channel's own", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        items: [
          {
            ...ytThread("A", "2026-10-12T10:00:00Z"),
            replies: {
              comments: [
                {
                  id: "A.1",
                  snippet: {
                    authorDisplayName: "Replier",
                    authorChannelId: { value: "UC_other" },
                    textDisplay: "agreed",
                    publishedAt: "2026-10-12T11:00:00Z",
                    parentId: "A"
                  }
                },
                {
                  id: "A.2",
                  snippet: {
                    authorDisplayName: "Me",
                    authorChannelId: { value: "UC_me" },
                    textDisplay: "thanks",
                    publishedAt: "2026-10-12T11:30:00Z",
                    parentId: "A"
                  }
                }
              ]
            }
          },
          ytThread("B", "2026-10-12T09:00:00Z", { authorChannelId: { value: "UC_me" } })
        ]
      })
    );

    const result = await fetchYoutubeComments(samplePost(), null, auth, { now: NOW });

    expect(result.items.map((item) => item.id)).toEqual(["youtube:A", "youtube:A.1"]);
    expect(result.items[0]).toMatchObject({
      platform: "youtube",
      postId: "vid1",
      kind: "comment",
      authorName: "Author A",
      text: "text of A",
      at: "2026-10-12T10:00:00.000Z",
      status: "new",
      source: "poll",
      permalink: "https://www.youtube.com/watch?v=vid1&lc=A"
    });
    expect(result.items[1]).toMatchObject({ kind: "reply", parentId: "A", externalId: "A.1" });
    expect(result.newestAt).toBe("2026-10-12T11:30:00.000Z");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer yt-token");
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/youtube/v3/commentThreads");
    expect(url.searchParams.get("videoId")).toBe("vid1");
    expect(url.searchParams.get("order")).toBe("time");
  });

  it("stops paging at the newest comment it already has", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        items: [ytThread("N", "2026-10-12T10:00:00Z"), ytThread("OLD", "2026-10-12T08:00:00Z")],
        nextPageToken: "p2"
      })
    );

    const result = await fetchYoutubeComments(samplePost(), "2026-10-12T09:00:00.000Z", auth, { now: NOW });

    expect(result.items.map((item) => item.externalId)).toEqual(["N"]);
    expect(calls).toHaveLength(1);
    expect(result.pages).toBe(1);
  });

  it("keeps paging while a whole page is newer, then stops at the last page", async () => {
    const calls = stubFetch((call) =>
      new URL(call.url).searchParams.get("pageToken") === "p2"
        ? jsonResponse({ items: [ytThread("C", "2026-10-12T07:00:00Z")] })
        : jsonResponse({ items: [ytThread("A", "2026-10-12T10:00:00Z"), ytThread("B", "2026-10-12T09:00:00Z")], nextPageToken: "p2" })
    );

    const result = await fetchYoutubeComments(samplePost(), null, auth, { now: NOW });

    expect(result.items.map((item) => item.externalId)).toEqual(["A", "B", "C"]);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("pageToken")).toBe("p2");
  });

  it("never pages past the page limit", async () => {
    const calls = stubFetch(() => jsonResponse({ items: [ytThread("A", "2026-10-12T10:00:00Z")], nextPageToken: "more" }));
    const result = await fetchYoutubeComments(samplePost(), null, auth, { now: NOW, maxPages: 2 });
    expect(calls).toHaveLength(2);
    expect(result.pages).toBe(2);
  });
});

describe("YouTube walks that stop early", () => {
  const auth = { accessToken: "yt-token" };

  it("is not truncated when it reached a known comment or the last page", async () => {
    stubFetch(() => jsonResponse({ items: [ytThread("A", "2026-10-12T10:00:00Z")] }));
    expect((await fetchYoutubeComments(samplePost(), null, auth, { now: NOW })).truncated).toBe(false);

    stubFetch(() => jsonResponse({ items: [ytThread("OLD", "2026-10-12T08:00:00Z")], nextPageToken: "p2" }));
    expect((await fetchYoutubeComments(samplePost(), "2026-10-12T09:00:00.000Z", auth, { now: NOW })).truncated).toBe(false);
  });

  it("is truncated when the page limit stops it with more to read", async () => {
    stubFetch(() => jsonResponse({ items: [ytThread("A", "2026-10-12T10:00:00Z")], nextPageToken: "more" }));
    expect((await fetchYoutubeComments(samplePost(), null, auth, { now: NOW, maxPages: 2 })).truncated).toBe(true);
  });

  it("asks before every request and keeps what it read when the answer is that the budget is spent", async () => {
    const calls = stubFetch(() => jsonResponse({ items: [ytThread(`T${Math.random()}`, "2026-10-12T10:00:00Z")], nextPageToken: "more" }));
    let asked = 0;
    const beforeRequest = async () => {
      asked += 1;
      if (asked > 1) throw new FetchBudgetExhausted();
    };

    const result = await fetchYoutubeComments(samplePost(), null, auth, { now: NOW, beforeRequest });

    expect(asked).toBe(2);
    expect(calls).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result).toMatchObject({ pages: 1, truncated: true, budgetSpent: true });
  });

  it("reports a budget that was spent before the first request", async () => {
    const calls = stubFetch(() => jsonResponse({ items: [] }));
    const result = await fetchYoutubeComments(samplePost(), null, auth, {
      now: NOW,
      beforeRequest: async () => {
        throw new FetchBudgetExhausted();
      }
    });
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ items: [], pages: 0, truncated: true, budgetSpent: true });
  });
});

describe("other walks report truncation", () => {
  it("flags Instagram, Facebook and Threads when the page limit stops them with more to read", async () => {
    stubFetch(() =>
      jsonResponse({
        data: [{ id: "x", text: "t", timestamp: "2026-10-12T10:00:00+0000", created_time: "2026-10-12T10:00:00+0000", username: "u", from: { id: "u", name: "U" } }],
        paging: { cursors: { after: "n" }, next: "https://graph.example/next" }
      })
    );
    const instagram = await fetchInstagramComments(
      samplePost({ platform: "instagram", url: "https://www.instagram.com/p/x/" }),
      null,
      { accessToken: "t", graphApiVersion: "v23.0", selfUsername: null },
      { now: NOW, maxPages: 1 }
    );
    const facebook = await fetchFacebookComments(
      samplePost({ platform: "facebook" }),
      null,
      { accessToken: "t", graphApiVersion: "v23.0", pageId: "p" },
      { now: NOW, maxPages: 1 }
    );
    const threads = await fetchThreadsReplies(
      samplePost({ platform: "threads" }),
      null,
      { accessToken: "t", apiBase: "https://graph.threads.net", apiVersion: "v1.0", selfUsername: null },
      { now: NOW, maxPages: 1 }
    );
    expect([instagram.truncated, facebook.truncated, threads.truncated]).toEqual([true, true, true]);
  });
});

describe("Instagram comments", () => {
  const auth = { accessToken: "ig-token", graphApiVersion: "v21.0", selfUsername: "colateral" };
  const post = samplePost({ platform: "instagram", accountId: "instagram-primary", postId: "media9" });

  const page = (comments: unknown[], after?: string) => ({
    data: comments,
    ...(after ? { paging: { cursors: { after }, next: "https://graph.facebook.com/next" } } : {})
  });

  it("reads comments and nested replies, normalises +0000 stamps and skips our own username", async () => {
    const calls = stubFetch((call) =>
      call.url.includes("/media9?")
        ? jsonResponse({ permalink: "https://www.instagram.com/reel/ABC/" })
        : jsonResponse(
            page([
              {
                id: "100",
                text: "love this",
                timestamp: "2026-10-12T10:00:00+0000",
                username: "fan1",
                replies: {
                  data: [
                    { id: "101", text: "same", timestamp: "2026-10-12T10:30:00+0000", username: "fan2" },
                    { id: "102", text: "thank you", timestamp: "2026-10-12T10:40:00+0000", username: "colateral" }
                  ]
                }
              },
              { id: "99", text: "from us", timestamp: "2026-10-12T09:00:00+0000", username: "colateral" }
            ])
          )
    );

    const result = await fetchInstagramComments(post, null, auth, { now: NOW });

    expect(result.items.map((item) => item.id)).toEqual(["instagram:100", "instagram:101"]);
    expect(result.items[0]).toMatchObject({
      authorName: "@fan1",
      at: "2026-10-12T10:00:00.000Z",
      permalink: "https://www.instagram.com/reel/ABC/c/100/"
    });
    expect(result.items[1]).toMatchObject({ kind: "reply", parentId: "100" });
    expect(result.permalink).toBe("https://www.instagram.com/reel/ABC/");
    expect(result.newestAt).toBe("2026-10-12T10:40:00.000Z");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.filter((call) => call.url.includes("/media9/comments"))).toHaveLength(1);
  });

  it("stops paging once a comment is no newer than the cursor, and follows the cursor otherwise", async () => {
    const calls = stubFetch((call) =>
      new URL(call.url).searchParams.get("after") === "c2"
        ? jsonResponse(page([{ id: "1", text: "old", timestamp: "2026-10-12T06:00:00+0000", username: "u" }]))
        : jsonResponse(
            page(
              [
                { id: "3", text: "new", timestamp: "2026-10-12T12:00:00+0000", username: "u" },
                { id: "2", text: "newer than cursor", timestamp: "2026-10-12T09:30:00+0000", username: "u" }
              ],
              "c2"
            )
          )
    );
    const known = { ...post, url: "https://www.instagram.com/reel/ABC/" };

    const full = await fetchInstagramComments(known, null, auth, { now: NOW });
    expect(full.items.map((item) => item.externalId)).toEqual(["3", "2", "1"]);
    expect(calls).toHaveLength(2);

    calls.length = 0;
    const incremental = await fetchInstagramComments(known, "2026-10-12T09:45:00.000Z", auth, { now: NOW });
    expect(incremental.items.map((item) => item.externalId)).toEqual(["3"]);
    expect(calls).toHaveLength(1);
  });
});

describe("Facebook comments", () => {
  const auth = { accessToken: "fb-token", graphApiVersion: "v21.0", pageId: "page1" };
  const post = samplePost({ platform: "facebook", accountId: "facebook-primary", postId: "fbpost1" });

  it("reads the flat stream, maps parents to replies and skips the Page's own comments", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: "fbpost1_5",
            message: "which tool is this?",
            created_time: "2026-10-12T12:00:00+0000",
            from: { id: "u5", name: "Sam" },
            permalink_url: "https://www.facebook.com/page/posts/1?comment_id=5"
          },
          {
            id: "fbpost1_6",
            message: "same question",
            created_time: "2026-10-12T11:00:00+0000",
            from: { id: "u6", name: "Ari" },
            parent: { id: "fbpost1_5" }
          },
          {
            id: "fbpost1_7",
            message: "it is CoLateral",
            created_time: "2026-10-12T11:30:00+0000",
            from: { id: "page1", name: "CoLateral" }
          },
          { id: "fbpost1_8", message: "no author", created_time: "2026-10-12T08:00:00+0000" }
        ]
      })
    );

    const result = await fetchFacebookComments(post, null, auth, { now: NOW });

    expect(result.items.map((item) => item.externalId)).toEqual(["fbpost1_5", "fbpost1_6", "fbpost1_8"]);
    expect(result.items[0]).toMatchObject({
      authorName: "Sam",
      permalink: "https://www.facebook.com/page/posts/1?comment_id=5",
      kind: "comment"
    });
    expect(result.items[1]).toMatchObject({ kind: "reply", parentId: "fbpost1_5" });
    expect(result.items[2].authorName).toBe("Facebook user");
    expect(result.newestAt).toBe("2026-10-12T12:00:00.000Z");
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v21.0/fbpost1/comments");
    expect(url.searchParams.get("filter")).toBe("stream");
    expect(url.searchParams.get("order")).toBe("reverse_chronological");
    expect(calls[0].method).toBe("GET");
  });

  it("stops at the cursor without asking for another page", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        data: [
          { id: "n", message: "new", created_time: "2026-10-12T12:00:00+0000", from: { id: "u", name: "U" } },
          { id: "o", message: "old", created_time: "2026-10-12T07:00:00+0000", from: { id: "u", name: "U" } }
        ],
        paging: { cursors: { after: "next" }, next: "https://graph.facebook.com/next" }
      })
    );

    const result = await fetchFacebookComments(post, "2026-10-12T08:00:00.000Z", auth, { now: NOW });

    expect(result.items.map((item) => item.externalId)).toEqual(["n"]);
    expect(calls).toHaveLength(1);
  });
});

describe("Threads replies", () => {
  const auth = {
    accessToken: "th-token",
    apiBase: "https://graph.threads.net",
    apiVersion: "v1.0",
    selfUsername: "nic_threads"
  };
  const post = samplePost({ platform: "threads", accountId: "primary", postId: "t1", title: "a thought" });

  it("reads replies newest first, skips our own, and keeps media-only replies", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: "r3",
            text: "good point",
            username: "reader",
            timestamp: "2026-10-12T12:00:00+0000",
            permalink: "https://www.threads.net/@reader/post/r3"
          },
          { id: "r2", username: "pic", timestamp: "2026-10-12T11:00:00+0000" },
          { id: "r1", text: "plug", username: "nic_threads", timestamp: "2026-10-12T10:00:00+0000" }
        ]
      })
    );

    const result = await fetchThreadsReplies(post, null, auth, { now: NOW });

    expect(result.items.map((item) => item.id)).toEqual(["threads:r3", "threads:r2"]);
    expect(result.items[0]).toMatchObject({
      platform: "threads",
      kind: "reply",
      authorName: "@reader",
      text: "good point",
      permalink: "https://www.threads.net/@reader/post/r3",
      at: "2026-10-12T12:00:00.000Z"
    });
    expect(result.items[1].text).toBe("(media reply)");
    expect(result.newestAt).toBe("2026-10-12T12:00:00.000Z");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer th-token");
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://graph.threads.net/v1.0/t1/replies");
    expect(url.searchParams.get("reverse")).toBe("true");
  });

  it("stops paging at the cursor", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        data: [
          { id: "n", text: "new", username: "a", timestamp: "2026-10-12T12:00:00+0000" },
          { id: "o", text: "old", username: "b", timestamp: "2026-10-12T05:00:00+0000" }
        ],
        paging: { cursors: { after: "x" } }
      })
    );

    const result = await fetchThreadsReplies(post, "2026-10-12T06:00:00.000Z", auth, { now: NOW });

    expect(result.items.map((item) => item.externalId)).toEqual(["n"]);
    expect(calls).toHaveLength(1);
  });

  it("follows the paging cursor while every reply on the page is new", async () => {
    const calls = stubFetch((call) =>
      new URL(call.url).searchParams.get("after") === "x"
        ? jsonResponse({ data: [{ id: "b", text: "b", username: "b", timestamp: "2026-10-12T05:00:00+0000" }] })
        : jsonResponse({
            data: [{ id: "a", text: "a", username: "a", timestamp: "2026-10-12T12:00:00+0000" }],
            paging: { cursors: { after: "x" }, next: "https://graph.threads.net/next" }
          })
    );

    const result = await fetchThreadsReplies(post, null, auth, { now: NOW });

    expect(result.items.map((item) => item.externalId)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
  });
});
