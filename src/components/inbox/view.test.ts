import { describe, expect, it } from "vitest";
import { filterItems, groupByPost, surfaceLine, timeAgo } from "@/components/inbox/view";
import { sampleItem } from "@/lib/inbox/test-helpers";

const items = [
  sampleItem({ id: "youtube:a", externalId: "a", postId: "v1", status: "new", at: "2026-10-12T10:00:00.000Z" }),
  sampleItem({ id: "youtube:b", externalId: "b", postId: "v1", status: "seen", at: "2026-10-12T09:00:00.000Z" }),
  sampleItem({ id: "youtube:c", externalId: "c", postId: "v2", postTitle: "Other video", status: "done", at: "2026-10-12T12:00:00.000Z" }),
  sampleItem({ id: "threads:d", externalId: "d", platform: "threads", postId: "t1", postTitle: "a thought", status: "replied", at: "2026-10-12T08:00:00.000Z" })
];

describe("filterItems", () => {
  it("filters by platform and by status, where open means new or seen", () => {
    expect(filterItems(items, { platform: "all", status: "open" }).map((item) => item.id)).toEqual(["youtube:a", "youtube:b"]);
    expect(filterItems(items, { platform: "threads", status: "all" }).map((item) => item.id)).toEqual(["threads:d"]);
    expect(filterItems(items, { platform: "youtube", status: "done" }).map((item) => item.id)).toEqual(["youtube:c"]);
    expect(filterItems(items, { platform: "all", status: "new" }).map((item) => item.id)).toEqual(["youtube:a"]);
  });
});

describe("groupByPost", () => {
  it("groups by post, counts unread and puts posts with unread comments first", () => {
    const groups = groupByPost(items);

    expect(groups.map((group) => [group.key, group.unread, group.items.length])).toEqual([
      ["youtube:v1", 1, 2],
      ["youtube:v2", 0, 1],
      ["threads:t1", 0, 1]
    ]);
    expect(groups[1].title).toBe("Other video");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");
  it.each([
    ["2026-10-13T11:59:40.000Z", "just now"],
    ["2026-10-13T11:15:00.000Z", "45m ago"],
    ["2026-10-13T07:00:00.000Z", "5h ago"],
    ["2026-10-10T12:00:00.000Z", "3d ago"]
  ])("reads %s as %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
});

describe("surfaceLine", () => {
  it("gives a canvas agent the id, who, where and what, on one line", () => {
    const line = surfaceLine(sampleItem({ text: "line one\nline two" }));
    expect(line).toBe('[youtube:c1] YouTube Dana on "A short about worktrees": line one line two');
  });
});
