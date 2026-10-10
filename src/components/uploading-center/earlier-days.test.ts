import { describe, expect, it } from "vitest";
import { splitEarlierDays } from "@/components/uploading-center/earlier-days";
import type { AgendaDay } from "@/lib/publisher/agenda";

const day = (dateKey: string, over: Partial<AgendaDay> = {}): AgendaDay => ({
  dateKey,
  dateLabel: dateKey,
  today: false,
  past: false,
  entries: [],
  openSlots: [],
  shortsFull: false,
  ...over
});

describe("splitEarlierDays", () => {
  const days = [
    day("2026-10-08", { past: true, entries: [{} as never, {} as never] }),
    day("2026-10-09", { past: true }),
    day("2026-10-10", { today: true }),
    day("2026-10-11")
  ];

  it("folds the days before today and counts what is hidden in them", () => {
    const split = splitEarlierDays(days, true);
    expect(split.earlier.map((entry) => entry.dateKey)).toEqual(["2026-10-08", "2026-10-09"]);
    expect(split.shown.map((entry) => entry.dateKey)).toEqual(["2026-10-10", "2026-10-11"]);
    expect(split.earlierPosts).toBe(2);
  });

  it("shows everything once the earlier days are opened", () => {
    expect(splitEarlierDays(days, false).shown).toHaveLength(4);
  });

  it("shows every day of a window that does not contain today", () => {
    const paged = [day("2026-10-20"), day("2026-10-21")];
    expect(splitEarlierDays(paged, true)).toEqual({ earlier: [], shown: paged, earlierPosts: 0 });
  });
});
