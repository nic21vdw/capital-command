import { describe, expect, it } from "vitest";
import { defaultCalendarView, viewportIsNarrow } from "./default-view";

describe("defaultCalendarView", () => {
  it("opens on the day on a narrow screen", () => {
    expect(defaultCalendarView(true)).toBe("day");
  });

  it("keeps the week everywhere else", () => {
    expect(defaultCalendarView(false)).toBe("week");
  });
});

describe("viewportIsNarrow", () => {
  it("is false where there is no window to measure", () => {
    expect(viewportIsNarrow()).toBe(false);
  });
});
