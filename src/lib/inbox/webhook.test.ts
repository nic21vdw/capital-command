import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/instagram/webhook/route";
import { readInbox, updateInbox } from "@/lib/inbox/store";
import { emptyInbox, cursorKey } from "@/lib/inbox/types";
import { samplePost } from "@/lib/inbox/test-helpers";
import { queueInstagramEvent, webhookQueueIdle } from "@/lib/inbox/webhookQueue";

const listPosts = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inbox/posts", () => ({ listPublishedPosts: listPosts }));

const SECRET = "app-secret";
const EVENT_TIME = Math.floor(Date.parse("2026-10-12T10:00:00Z") / 1000);

function signed(payload: unknown, secret = SECRET): Request {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return new Request("http://localhost/api/instagram/webhook", {
    method: "POST",
    body,
    headers: { "x-hub-signature-256": signature, "content-type": "application/json" }
  });
}

const commentEvent = (value: Record<string, unknown>, field = "comments") => ({
  object: "instagram",
  entry: [{ id: "ig-user", time: EVENT_TIME, changes: [{ field, value }] }]
});

const knownPosts = () => [
  samplePost({ platform: "instagram", accountId: "instagram-primary", postId: "media1", title: "Reel about worktrees" })
];

beforeEach(async () => {
  vi.stubEnv("IG_APP_SECRET", SECRET);
  listPosts.mockReset();
  listPosts.mockImplementation(async () => knownPosts());
  await updateInbox(() => emptyInbox());
});

afterEach(async () => {
  await webhookQueueIdle();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Instagram webhook", () => {
  it("writes a comment event into the inbox instead of the console", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await POST(
      signed(
        commentEvent({
          id: "c-100",
          text: "does this run on windows?",
          from: { id: "u-1", username: "bob" },
          media: { id: "media1", media_product_type: "REELS" }
        })
      )
    );
    await webhookQueueIdle();

    expect(response.status).toBe(200);
    const store = await readInbox();
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      id: "instagram:c-100",
      platform: "instagram",
      accountId: "instagram-primary",
      postId: "media1",
      postTitle: "Reel about worktrees",
      kind: "comment",
      authorName: "@bob",
      text: "does this run on windows?",
      status: "new",
      source: "webhook",
      at: new Date(EVENT_TIME * 1000).toISOString()
    });
    expect(store.cursors[cursorKey("instagram", "media1")].lastActivityAt).toBe(store.items[0].at);
    expect(log.mock.calls.flat().join(" ")).not.toContain("windows");
  });

  it("answers 200 before it reads the publish queue or writes the inbox", async () => {
    let release: (posts: ReturnType<typeof knownPosts>) => void = () => undefined;
    listPosts.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );

    const response = await POST(signed(commentEvent({ id: "c-1", text: "hi", from: { id: "u", username: "z" }, media: { id: "media1" } })));

    expect(response.status).toBe(200);
    expect(listPosts).not.toHaveBeenCalled();
    expect((await readInbox()).items).toEqual([]);

    await vi.waitFor(() => expect(listPosts).toHaveBeenCalledTimes(1));
    expect((await readInbox()).items).toEqual([]);
    release(knownPosts());
    await webhookQueueIdle();

    expect((await readInbox()).items.map((item) => item.id)).toEqual(["instagram:c-1"]);
  });

  it("folds a burst of events into one read of the publish queue", async () => {
    const events = ["a", "b", "c"].map((id) => commentEvent({ id: `c-${id}`, text: id, from: { id: "u", username: id }, media: { id: "media1" } }));

    for (const event of events) queueInstagramEvent(event);
    await webhookQueueIdle();

    expect(listPosts).toHaveBeenCalledTimes(1);
    expect((await readInbox()).items).toHaveLength(3);
  });

  it("keeps the signature check: a bad signature stores nothing and queues nothing", async () => {
    const response = await POST(signed(commentEvent({ id: "c-1", text: "hi", media: { id: "media1" } }), "wrong-secret"));
    await webhookQueueIdle();

    expect(response.status).toBe(401);
    expect(listPosts).not.toHaveBeenCalled();
    expect((await readInbox()).items).toEqual([]);
  });

  it("refuses every event while the app secret is unset", async () => {
    vi.stubEnv("IG_APP_SECRET", "");

    const response = await POST(signed(commentEvent({ id: "c-1", text: "hi", media: { id: "media1" } })));
    await webhookQueueIdle();

    expect(response.status).toBe(401);
    expect((await readInbox()).items).toEqual([]);
  });

  it("files a reply to a comment as a reply, and skips what the account wrote itself", async () => {
    await POST(
      signed({
        object: "instagram",
        entry: [
          {
            id: "ig-user",
            time: EVENT_TIME,
            changes: [
              { field: "comments", value: { id: "c-2", text: "me too", parent_id: "c-1", from: { id: "u-2", username: "amy" }, media: { id: "media1" } } },
              { field: "comments", value: { id: "c-3", text: "thanks!", parent_id: "c-1", from: { id: "ig-user", username: "colateral" }, media: { id: "media1" } } }
            ]
          }
        ]
      })
    );
    await webhookQueueIdle();

    const items = (await readInbox()).items;
    expect(items.map((item) => item.id)).toEqual(["instagram:c-2"]);
    expect(items[0]).toMatchObject({ kind: "reply", parentId: "c-1" });
  });

  it("stores a mention as its own item", async () => {
    await POST(signed(commentEvent({ comment_id: "c-9", media_id: "media77" }, "mentions")));
    await webhookQueueIdle();

    const items = (await readInbox()).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "instagram:mention:c-9", kind: "mention", externalId: "c-9", postId: "media77", source: "webhook" });
  });

  it("does not duplicate an event Meta delivers twice", async () => {
    const event = commentEvent({ id: "c-5", text: "again", from: { id: "u", username: "z" }, media: { id: "media1" } });

    await POST(signed(event));
    await POST(signed(event));
    await webhookQueueIdle();

    expect((await readInbox()).items).toHaveLength(1);
  });

  it("still stores the event when the publish queue cannot be read, with a placeholder title", async () => {
    listPosts.mockRejectedValue(new Error("queue unreadable"));

    await POST(signed(commentEvent({ id: "c-7", text: "hello", from: { id: "u", username: "z" }, media: { id: "media1" } })));
    await webhookQueueIdle();

    expect((await readInbox()).items[0]).toMatchObject({ id: "instagram:c-7", postTitle: "Instagram post" });
  });

  it("answers 200 and stores nothing for events it does not handle", async () => {
    const response = await POST(
      signed({ object: "instagram", entry: [{ id: "ig-user", time: 1, messaging: [{ message: { text: "private" } }] }] })
    );
    await webhookQueueIdle();

    expect(response.status).toBe(200);
    expect((await readInbox()).items).toEqual([]);
  });

  it("answers 200 to a payload that is not JSON, as before", async () => {
    const body = "not json";
    const signature = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
    const response = await POST(
      new Request("http://localhost/api/instagram/webhook", { method: "POST", body, headers: { "x-hub-signature-256": signature } })
    );
    expect(response.status).toBe(200);
  });
});
