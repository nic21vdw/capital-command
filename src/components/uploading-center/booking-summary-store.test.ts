import { describe, expect, it } from "vitest";
import {
  BOOKING_SUMMARY_TTL_MS,
  bookingSummaryKey,
  clearBookingSummary,
  loadBookingSummary,
  saveBookingSummary
} from "@/components/uploading-center/booking-summary-store";
import { NO_AI_CAPTION_SUMMARY_NOTE } from "@/components/uploading-center/schedule-summary";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data
  };
}

const summary = { level: "warning" as const, message: "4 saved as reminders - connect Instagram to post them." };

describe("booking summary storage", () => {
  it("brings the last summary back for the same run after a reload", () => {
    const storage = memoryStorage();
    saveBookingSummary("job-1", summary, 1000, storage);
    expect(loadBookingSummary("job-1", 2000, storage)).toEqual(summary);
  });

  it("keeps the no-AI-key sentence with the summary until it is dismissed", () => {
    const storage = memoryStorage();
    const withNote = {
      level: "warning" as const,
      message: `4 booked: Mon-Thu. ${NO_AI_CAPTION_SUMMARY_NOTE}`
    };
    saveBookingSummary("job-1", withNote, 1000, storage);
    expect(loadBookingSummary("job-1", 2000, storage)?.message).toContain(NO_AI_CAPTION_SUMMARY_NOTE);
    clearBookingSummary("job-1", storage);
    expect(loadBookingSummary("job-1", 3000, storage)).toBeNull();
  });

  it("keeps each run's summary to itself", () => {
    const storage = memoryStorage();
    saveBookingSummary("job-1", summary, 1000, storage);
    expect(loadBookingSummary("job-2", 2000, storage)).toBeNull();
  });

  it("is gone once dismissed", () => {
    const storage = memoryStorage();
    saveBookingSummary("job-1", summary, 1000, storage);
    clearBookingSummary("job-1", storage);
    expect(loadBookingSummary("job-1", 2000, storage)).toBeNull();
  });

  it("drops a summary a week old", () => {
    const storage = memoryStorage();
    saveBookingSummary("job-1", summary, 1000, storage);
    expect(loadBookingSummary("job-1", 1000 + BOOKING_SUMMARY_TTL_MS + 1, storage)).toBeNull();
    expect(storage.data.has(bookingSummaryKey("job-1"))).toBe(false);
  });

  it("ignores garbage and survives storage that throws or is missing", () => {
    expect(loadBookingSummary("job-1", 1, memoryStorage({ [bookingSummaryKey("job-1")]: "{nope" }))).toBeNull();
    expect(loadBookingSummary("job-1", 1, memoryStorage({ [bookingSummaryKey("job-1")]: JSON.stringify({ level: "weird", message: "x", savedAt: 1 }) }))).toBeNull();
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); }
    };
    expect(() => saveBookingSummary("job-1", summary, 1, broken)).not.toThrow();
    expect(loadBookingSummary("job-1", 1, broken)).toBeNull();
    expect(() => clearBookingSummary("job-1", broken)).not.toThrow();
    expect(loadBookingSummary("job-1", 1, null)).toBeNull();
  });
});
