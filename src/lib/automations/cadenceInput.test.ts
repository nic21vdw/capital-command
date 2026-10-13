import { describe, expect, it } from "vitest";
import { checkCadenceInput } from "@/lib/automations/cadenceInput";

describe("checkCadenceInput", () => {
  it("accepts shorts per day from 1 to 6", () => {
    for (const count of [1, 3, 6]) expect(checkCadenceInput({ shortsPerDay: count })).toEqual({ ok: true, value: { shortsPerDay: count } });
  });

  it.each([0, 7, 2.5, -1, "3", null, Number.NaN])("rejects shorts per day %j", (shortsPerDay) => {
    expect(checkCadenceInput({ shortsPerDay }).ok).toBe(false);
  });

  it("accepts Threads posts per day from 1 to 48, the same clamp threadsConfig() applies", () => {
    for (const count of [1, 24, 48]) expect(checkCadenceInput({ threadsPostsPerDay: count })).toEqual({ ok: true, value: { threadsPostsPerDay: count } });
  });

  it.each([0, 49, 2.5, -1, "24", null, Number.NaN])("rejects Threads posts per day %j", (threadsPostsPerDay) => {
    expect(checkCadenceInput({ threadsPostsPerDay }).ok).toBe(false);
  });

  it("sorts and de-duplicates slot times", () => {
    expect(checkCadenceInput({ slotTimes: ["15:00", "09:30", "15:00", " 07:05 "] })).toEqual({ ok: true, value: { slotTimes: ["07:05", "09:30", "15:00"] } });
  });

  it.each([["9:30"], ["24:00"], ["12:60"], ["noon"], ["09:30:00"]])("rejects the time %j", (time) => {
    const result = checkCadenceInput({ slotTimes: ["10:00", time] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain("HH:MM");
  });

  it("tells an empty time apart from a malformed one", () => {
    const result = checkCadenceInput({ slotTimes: ["10:00", ""] });
    expect(result.ok === false && result.problem).toContain("empty time");
  });

  it("allows between 1 and 8 different times", () => {
    expect(checkCadenceInput({ weekendSlotTimes: [] }).ok).toBe(false);
    const eight = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];
    expect(checkCadenceInput({ weekendSlotTimes: eight }).ok).toBe(true);
    expect(checkCadenceInput({ weekendSlotTimes: [...eight, "21:00"] }).ok).toBe(false);
    // Nine entries that are really one time are one time, not nine.
    expect(checkCadenceInput({ slotTimes: Array(9).fill("10:00") })).toEqual({ ok: true, value: { slotTimes: ["10:00"] } });
  });

  it("refuses anything else, including an empty change", () => {
    expect(checkCadenceInput({}).ok).toBe(false);
    expect(checkCadenceInput({ shortsPerDay: 2, timezone: "UTC" }).ok).toBe(false);
    expect(checkCadenceInput({ slotTimes: "09:00,10:00" }).ok).toBe(false);
    expect(checkCadenceInput(null).ok).toBe(false);
  });
});
