import { describe, expect, it } from "vitest";
import { postCode } from "@/lib/attribution/code";
import type { AttributionRow } from "@/lib/attribution/readback";
import { formatRevenue, joinAttribution, postLabels, totalsOf } from "@/lib/attribution/view";

const rows: AttributionRow[] = [
  { platform: "th", code: postCode("threads-1"), visits: 12, buys: 2, orders: 1, revenue: { USD: 9900 } },
  { platform: "yt", code: postCode("clip-9"), visits: 40, buys: 0, orders: 0, revenue: {} },
  { platform: "ig", code: "zzzzzz", visits: 5, buys: 1, orders: 1, revenue: { CAD: 13900 } },
  { platform: "yt", code: null, visits: 3, buys: 0, orders: 0, revenue: {} }
];
const posts = [
  { id: "threads-1", label: "The IDE should fit the way you think" },
  { id: "clip-9", label: "Beam check in thirty seconds" }
];

describe("joinAttribution", () => {
  it("labels each row from the post whose code it carries", () => {
    const lines = joinAttribution(rows, posts);
    expect(lines.find((line) => line.platform === "th")?.label).toBe("The IDE should fit the way you think");
    expect(lines.find((line) => line.code === postCode("clip-9"))?.label).toBe("Beam check in thirty seconds");
  });

  it("keeps a code with no local post, unlabelled", () => {
    const line = joinAttribution(rows, posts).find((entry) => entry.code === "zzzzzz")!;
    expect(line.label).toBeNull();
    expect(line.visits).toBe(5);
  });

  it("keeps platform-only visits as their own line", () => {
    const line = joinAttribution(rows, posts).find((entry) => entry.code === null)!;
    expect(line).toMatchObject({ platform: "yt", label: null, visits: 3 });
  });

  it("puts the most visited first", () => {
    expect(joinAttribution(rows, posts).map((line) => line.visits)).toEqual([40, 12, 5, 3]);
  });
});

describe("totalsOf", () => {
  it("adds visits, buys, orders and revenue per currency", () => {
    expect(totalsOf(rows)).toEqual({ visits: 60, buys: 3, orders: 2, revenue: { USD: 9900, CAD: 13900 } });
  });

  it("is zero for no rows", () => {
    expect(totalsOf([])).toEqual({ visits: 0, buys: 0, orders: 0, revenue: {} });
  });
});

describe("formatRevenue", () => {
  it("shows a dash for nothing", () => {
    expect(formatRevenue({})).toBe("—");
  });

  it("shows each currency in dollars", () => {
    const text = formatRevenue({ USD: 9900, CAD: 13900 });
    expect(text).toContain("99.00");
    expect(text).toContain("139.00");
    expect(text).toContain("·");
  });
});

describe("postLabels", () => {
  it("labels publish posts by title and Threads posts by their first words", () => {
    const labels = postLabels(
      [{ id: "clip-1", title: "Beam check" }],
      [{ id: "t-1", text: "  A very long Threads post that goes on and on about workspaces and agents and more" }]
    );
    expect(labels[0]).toEqual({ id: "clip-1", label: "Beam check" });
    expect(labels[1].id).toBe("t-1");
    expect(labels[1].label.length).toBeLessThanOrEqual(61);
    expect(labels[1].label.startsWith("A very long Threads post")).toBe(true);
  });

  it("falls back to the id for a post with no title", () => {
    expect(postLabels([{ id: "clip-2", title: "" }], [])).toEqual([{ id: "clip-2", label: "clip-2" }]);
  });
});
