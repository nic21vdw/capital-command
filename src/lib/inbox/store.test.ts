import { describe, expect, it } from "vitest";
import {
  applyCap,
  markAllSeen,
  mergeIncoming,
  readInbox,
  setItemStatus,
  unreadCount,
  updateInbox
} from "@/lib/inbox/store";
import { emptyInbox } from "@/lib/inbox/types";
import { sampleItem } from "@/lib/inbox/test-helpers";

const NOW = new Date("2026-10-13T09:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("mergeIncoming", () => {
  it("adds new items as unread and keeps the status of ones already stored", () => {
    const stored = { ...emptyInbox(), items: [sampleItem({ id: "youtube:a", externalId: "a", status: "done", statusAt: daysAgo(1) })] };

    const merged = mergeIncoming(
      stored,
      [sampleItem({ id: "youtube:a", externalId: "a", text: "edited text" }), sampleItem({ id: "youtube:b", externalId: "b", at: daysAgo(1) })],
      NOW
    );

    expect(merged.items).toHaveLength(2);
    expect(merged.items.find((item) => item.id === "youtube:a")).toMatchObject({ status: "done", text: "edited text" });
    expect(merged.items.find((item) => item.id === "youtube:b")?.status).toBe("new");
  });

  it("does not let a stale poll overwrite a reply that was already sent", () => {
    const sent = { text: "thanks!", sentAt: daysAgo(0), externalId: "r1" };
    const stored = { ...emptyInbox(), items: [sampleItem({ id: "youtube:a", externalId: "a", status: "replied", reply: sent })] };

    const merged = mergeIncoming(stored, [sampleItem({ id: "youtube:a", externalId: "a" })], NOW);

    expect(merged.items[0]).toMatchObject({ status: "replied", reply: sent });
  });

  it("files history older than two weeks as already seen so it does not flood the unread count", () => {
    const merged = mergeIncoming(
      emptyInbox(),
      [
        sampleItem({ id: "youtube:old", externalId: "old", at: daysAgo(20) }),
        sampleItem({ id: "youtube:fresh", externalId: "fresh", at: daysAgo(2) })
      ],
      NOW
    );

    expect(merged.items.find((item) => item.id === "youtube:old")?.status).toBe("seen");
    expect(merged.items.find((item) => item.id === "youtube:fresh")?.status).toBe("new");
    expect(unreadCount(merged)).toBe(1);
  });

  it("never files a live webhook event as history, whatever its timestamp says", () => {
    const merged = mergeIncoming(emptyInbox(), [sampleItem({ id: "instagram:w", externalId: "w", source: "webhook", at: daysAgo(30) })], NOW);

    expect(merged.items[0].status).toBe("new");
  });

  it("drops anything we already replied to under a different id", () => {
    const stored = {
      ...emptyInbox(),
      items: [sampleItem({ id: "youtube:a", externalId: "a", status: "replied", reply: { text: "hi", sentAt: daysAgo(0), externalId: "mine" } })]
    };

    const merged = mergeIncoming(stored, [sampleItem({ id: "youtube:mine", externalId: "mine", kind: "reply", parentId: "a" })], NOW);

    expect(merged.items.map((item) => item.id)).toEqual(["youtube:a"]);
  });
});

describe("applyCap", () => {
  it("keeps only the newest items once over the cap", () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      sampleItem({ id: `youtube:${index}`, externalId: String(index), at: daysAgo(index) })
    );

    const kept = applyCap(items, NOW, { max: 5 });

    expect(kept.map((item) => item.externalId)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("drops done items after 60 days but keeps unanswered ones of any age", () => {
    const items = [
      sampleItem({ id: "youtube:done-old", externalId: "done-old", status: "done", statusAt: daysAgo(61), at: daysAgo(70) }),
      sampleItem({ id: "youtube:done-recent", externalId: "done-recent", status: "done", statusAt: daysAgo(10), at: daysAgo(70) }),
      sampleItem({ id: "youtube:new-old", externalId: "new-old", status: "new", at: daysAgo(90) })
    ];

    expect(applyCap(items, NOW).map((item) => item.externalId).sort()).toEqual(["done-recent", "new-old"]);
  });

  it("sheds done items before unanswered ones when the cap bites", () => {
    const items = [
      sampleItem({ id: "youtube:keep", externalId: "keep", status: "new", at: daysAgo(30) }),
      sampleItem({ id: "youtube:done", externalId: "done", status: "done", statusAt: daysAgo(1), at: daysAgo(0) })
    ];

    expect(applyCap(items, NOW, { max: 1 }).map((item) => item.externalId)).toEqual(["keep"]);
  });

  it("holds the default cap at 5,000 items", () => {
    const items = Array.from({ length: 5200 }, (_, index) =>
      sampleItem({ id: `youtube:${index}`, externalId: String(index), at: new Date(NOW.getTime() - index * 60_000).toISOString() })
    );
    expect(applyCap(items, NOW)).toHaveLength(5000);
  });
});

describe("status changes", () => {
  const store = {
    ...emptyInbox(),
    items: [
      sampleItem({ id: "youtube:a", externalId: "a" }),
      sampleItem({ id: "instagram:b", externalId: "b", platform: "instagram" }),
      sampleItem({ id: "youtube:c", externalId: "c", status: "replied" })
    ]
  };

  it("counts only new items as unread", () => {
    expect(unreadCount(store)).toBe(2);
  });

  it("marks one item done", () => {
    const next = setItemStatus(store, "youtube:a", "done", NOW);
    expect(next.items.find((item) => item.id === "youtube:a")).toMatchObject({ status: "done", statusAt: NOW.toISOString() });
    expect(unreadCount(next)).toBe(1);
  });

  it("marks every unread item seen, optionally for one platform, and leaves replied ones alone", () => {
    const all = markAllSeen(store, NOW);
    expect(all.items.map((item) => item.status)).toEqual(["seen", "seen", "replied"]);

    const onlyYoutube = markAllSeen(store, NOW, { platform: "youtube" });
    expect(onlyYoutube.items.map((item) => item.status)).toEqual(["seen", "new", "replied"]);
  });

  it("refuses an unknown item", () => {
    expect(() => setItemStatus(store, "youtube:nope", "done", NOW)).toThrow(/not in the inbox/i);
  });
});

describe("data/inbox.json", () => {
  it("round-trips through the shared atomic writer", async () => {
    await updateInbox((current) => mergeIncoming(current, [sampleItem({ id: "youtube:disk", externalId: "disk", at: new Date().toISOString() })], new Date()));

    const read = await readInbox();

    expect(read.items.map((item) => item.id)).toContain("youtube:disk");
  });
});
