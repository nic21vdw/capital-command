import { describe, expect, it } from "vitest";
import { COLLAPSED_ROWS, foldRows } from "@/lib/pipeline/review-fold";

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }));
const none = () => false;

describe("foldRows", () => {
  it("shows everything once expanded", () => {
    const items = rows(20);
    expect(foldRows(items, true, none)).toHaveLength(20);
  });

  it("shows every row of a list shorter than the limit", () => {
    expect(foldRows(rows(3), false, none)).toHaveLength(3);
  });

  it("folds a long list down to the limit", () => {
    expect(foldRows(rows(20), false, none)).toHaveLength(COLLAPSED_ROWS);
  });

  // The heading counts dropped and edited rows, so one hidden under the fold
  // would make that count read as a mistake — and hide the edit until approval.
  it("keeps a touched row visible from below the fold", () => {
    const items = rows(20);
    const visible = foldRows(items, false, (item) => item.id === "row-17");
    expect(visible).toHaveLength(COLLAPSED_ROWS + 1);
    expect(visible.map((item) => item.id)).toContain("row-17");
  });

  it("keeps the original order when a touched row is pulled up", () => {
    const items = rows(10);
    const visible = foldRows(items, false, (item) => item.id === "row-8" || item.id === "row-6");
    expect(visible.map((item) => item.id)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-3",
      "row-4",
      "row-6",
      "row-8"
    ]);
  });

  it("takes a caller's own limit", () => {
    expect(foldRows(rows(20), false, none, 2)).toHaveLength(2);
  });
});
