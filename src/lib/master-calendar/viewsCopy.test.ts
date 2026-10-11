import { describe, expect, it } from "vitest";
import { dayViewsLabel, postedWhen, sameAsWeek, WEEK_VIEWS_LABEL } from "@/lib/master-calendar/viewsCopy";

describe("the YouTube views label", () => {
  it("says the views are lifetime views of what was posted that day", () => {
    expect(dayViewsLabel(2, "Yesterday", "Friday, October 9")).toBe("Views so far on the 2 videos posted yesterday");
    expect(dayViewsLabel(1, "Today", "Saturday, October 10")).toBe("Views so far on the video posted today");
  });

  it("names a farther day outright", () => {
    expect(postedWhen("Wednesday", "Wednesday, October 7")).toBe("on Wednesday, October 7");
    expect(dayViewsLabel(3, "Wednesday", "Wednesday, October 7")).toBe("Views so far on the 3 videos posted on Wednesday, October 7");
  });

  it("does not claim a count before the videos are known", () => {
    expect(dayViewsLabel(0, "Today", "")).toBe("Views so far on videos posted today");
  });

  it("calls the week's number the same thing", () => {
    expect(WEEK_VIEWS_LABEL).toMatch(/^Views so far on videos posted/);
  });
});

describe("sameAsWeek", () => {
  const week = { views: 3900, likes: 143, videos: 2 };
  it("matches only identical numbers", () => {
    expect(sameAsWeek({ ...week }, week)).toBe(true);
    expect(sameAsWeek({ ...week, views: 10, videos: 1 }, week)).toBe(false);
    expect(sameAsWeek({ views: 0, likes: 0, videos: 0 }, { views: 0, likes: 0, videos: 0 })).toBe(false);
    expect(sameAsWeek(week, null)).toBe(false);
  });
});
