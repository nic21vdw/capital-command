import { describe, expect, it } from "vitest";
import {
  alreadyBookedMessage,
  bookedChipText,
  bookedPlatformStatus,
  bookedWhen,
  publishZoneLabel,
  bookingsByCarousel,
  carouselIdFromImagePaths
} from "@/lib/carousels/booked";
import type { QueueItem } from "@/lib/publisher/types";

const post = (id: string, publishAt: string, paths: string[], platforms: Record<string, { status: string }>): QueueItem =>
  ({ id, mediaKind: "image", imagePaths: paths, clipPath: paths[0], title: "t", caption: "", hashtags: [], publishAt, platforms }) as unknown as QueueItem;

const deck = (carouselId: string) => [1, 2].map((n) => `data/carousels/${carouselId}/slide-0${n}.jpg`);
const pending = { status: "pending" };

describe("carouselIdFromImagePaths", () => {
  it("reads the carousel id out of the rendered deck's slide paths, on either slash", () => {
    expect(carouselIdFromImagePaths(deck("c-1"))).toBe("c-1");
    expect(carouselIdFromImagePaths(["data\\carousels\\c-1\\slide-01.jpg"])).toBe("c-1");
  });

  it("is null for any other picture post or a mix of decks", () => {
    expect(carouselIdFromImagePaths(["data/uploads/photo.jpg"])).toBeNull();
    expect(carouselIdFromImagePaths([...deck("a"), ...deck("b")])).toBeNull();
    expect(carouselIdFromImagePaths(undefined)).toBeNull();
  });
});

describe("bookingsByCarousel", () => {
  const now = new Date("2026-10-11T12:00:00Z");

  it("finds the booking for each carousel", () => {
    const found = bookingsByCarousel(
      [post("p1", "2026-10-13T16:30:00.000Z", deck("c-1"), { instagram: pending, facebook: pending })],
      now
    );
    expect(found["c-1"]).toMatchObject({ itemId: "p1", platforms: ["instagram", "facebook"], posted: false });
  });

  it("ignores a post whose every leg failed, since re-booking that is the point", () => {
    expect(bookingsByCarousel([post("p1", "2026-10-13T16:30:00.000Z", deck("c-1"), { instagram: { status: "failed" } })], now)).toEqual({});
  });

  it("prefers the next post still to go out", () => {
    const found = bookingsByCarousel(
      [
        post("old", "2026-10-01T16:30:00.000Z", deck("c-1"), { instagram: { status: "published" } }),
        post("next", "2026-10-14T16:30:00.000Z", deck("c-1"), { instagram: pending })
      ],
      now
    );
    expect(found["c-1"].itemId).toBe("next");
  });
});

describe("wording", () => {
  it("shows the slot in the publish time zone", () => {
    expect(bookedWhen("2026-10-13T16:30:00.000Z", "America/Toronto", "America/Toronto")).toBe("Tue, Oct 13, 12:30 PM");
    expect(alreadyBookedMessage("2026-10-13T16:30:00.000Z", "America/Toronto", "America/Toronto")).toBe(
      "This carousel is already booked for Tue, Oct 13 at 12:30 PM."
    );
  });

  it("builds the chip", () => {
    const booking = { itemId: "p1", publishAt: "2026-10-13T16:30:00.000Z", platforms: ["instagram", "facebook"] as const, posted: false };
    expect(bookedChipText({ ...booking, platforms: [...booking.platforms] }, "America/Toronto", "America/Toronto")).toBe(
      "Booked Tue, Oct 13, 12:30 PM · Instagram + Facebook"
    );
  });
});

describe("zone label", () => {
  const at = "2026-10-13T16:30:00.000Z";
  const booking = { itemId: "p1", publishAt: at, platforms: ["instagram", "facebook"] as ("instagram" | "facebook")[], posted: false };

  it("adds the publish zone's short name when the viewer is in another zone", () => {
    expect(bookedWhen(at, "America/Toronto", "UTC")).toBe("Tue, Oct 13, 12:30 PM EDT");
    expect(bookedChipText(booking, "America/Toronto", "UTC")).toBe("Booked Tue, Oct 13, 12:30 PM EDT · Instagram + Facebook");
    expect(alreadyBookedMessage(at, "America/Toronto", "Asia/Tokyo")).toBe(
      "This carousel is already booked for Tue, Oct 13 at 12:30 PM EDT."
    );
    expect(bookedPlatformStatus(booking, "America/Toronto", "UTC")).toBe("Booked Tue, Oct 13, 12:30 PM EDT");
  });

  it("stays quiet when the viewer reads the same clock", () => {
    expect(publishZoneLabel(at, "America/Toronto", "America/Toronto")).toBe("");
    expect(publishZoneLabel(at, "America/Toronto", "America/New_York")).toBe("");
    expect(publishZoneLabel(at, "UTC", "Etc/UTC")).toBe("");
  });

  it("stays quiet when the viewer's zone is unknown", () => {
    expect(bookedWhen(at, "America/Toronto", null)).toBe("Tue, Oct 13, 12:30 PM");
  });
});
