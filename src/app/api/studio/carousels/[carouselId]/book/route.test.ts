import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  readAppData: vi.fn(),
  renderCarouselDeck: vi.fn(),
  enqueueImagePost: vi.fn(),
  queueGet: vi.fn()
}));

vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => ({ enabled: mocks.enabled, timezone: "America/Toronto" })
}));
vi.mock("@/lib/storage/store", () => ({ readAppData: mocks.readAppData }));
vi.mock("@/lib/carousels/renderDeck", () => ({ renderCarouselDeck: mocks.renderCarouselDeck }));
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ get: mocks.queueGet }) }));
vi.mock("@/lib/publisher/enqueue", () => ({ enqueueImagePost: mocks.enqueueImagePost }));

import { POST } from "@/app/api/studio/carousels/[carouselId]/book/route";
import { DuplicatePostError } from "@/lib/publisher/duplicates";

const slides = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `s${index}`, heading: `Heading ${index}`, body: `Body ${index}` }));

const deck = (overrides: Record<string, unknown> = {}) => ({
  id: "deck-1",
  title: "Five tips",
  sourceType: "script",
  slides: slides(3),
  aspectRatio: "portrait",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides
});

const book = (body: unknown) =>
  POST(new NextRequest("http://localhost:3100/api/studio/carousels/deck-1/book", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ carouselId: "deck-1" })
  });

const valid = { publishAt: "2026-10-13T15:00", platforms: ["instagram", "facebook"], caption: "Fresh tips" };

describe("POST /api/studio/carousels/:id/book", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.readAppData.mockResolvedValue({ videoStudio: { scripts: [], carousels: [deck()] } });
    mocks.renderCarouselDeck.mockResolvedValue(["/d/slide-1.jpg", "/d/slide-2.jpg", "/d/slide-3.jpg"]);
    mocks.enqueueImagePost.mockResolvedValue({
      id: "abc12345",
      publishAt: "2026-10-13T19:00:00.000Z",
      platforms: { instagram: { status: "pending" }, facebook: { status: "manual" } }
    });
  });

  it("books the rendered slides through enqueueImagePost and reports each platform", async () => {
    const response = await book(valid);

    expect(response.status).toBe(201);
    expect(mocks.enqueueImagePost).toHaveBeenCalledWith(
      expect.objectContaining({
        imagePaths: ["/d/slide-1.jpg", "/d/slide-2.jpg", "/d/slide-3.jpg"],
        publishAt: "2026-10-13T15:00",
        caption: "Fresh tips",
        title: "Five tips",
        platforms: ["instagram", "facebook"],
        by: "api-carousel-book"
      })
    );
    expect(await response.json()).toEqual({
      item: {
        id: "abc12345",
        publishAt: "2026-10-13T19:00:00.000Z",
        platforms: { instagram: "pending", facebook: "manual" }
      },
      timeZone: "America/Toronto"
    });
  });

  it("books a deck to LinkedIn, where the publisher renders it as a PDF carousel", async () => {
    const response = await book({ ...valid, platforms: ["linkedin"] });

    expect(response.status).toBe(201);
    expect(mocks.enqueueImagePost).toHaveBeenCalledWith(expect.objectContaining({ platforms: ["linkedin"] }));
  });

  it("refuses TikTok and YouTube: they are reminders, never sent to the publisher", async () => {
    const response = await book({ ...valid, platforms: ["tiktok"] });

    expect(response.status).toBe(400);
    expect(mocks.enqueueImagePost).not.toHaveBeenCalled();
  });

  it("refuses while publishing is switched off", async () => {
    mocks.enabled = false;
    const response = await book(valid);

    expect(response.status).toBe(400);
    expect(mocks.enqueueImagePost).not.toHaveBeenCalled();
  });

  it("returns 404 for a carousel that does not exist", async () => {
    mocks.readAppData.mockResolvedValue({ videoStudio: { scripts: [], carousels: [] } });

    expect((await book(valid)).status).toBe(404);
  });

  it("refuses a story-shaped deck and one with too many slides before rendering", async () => {
    mocks.readAppData.mockResolvedValue({ videoStudio: { scripts: [], carousels: [deck({ aspectRatio: "story" })] } });
    expect((await book(valid)).status).toBe(400);

    mocks.readAppData.mockResolvedValue({ videoStudio: { scripts: [], carousels: [deck({ slides: slides(11) })] } });
    expect((await book(valid)).status).toBe(400);
    expect(mocks.renderCarouselDeck).not.toHaveBeenCalled();
  });

  it("passes the queue's own refusal (same-day, hosting, ...) back in plain words", async () => {
    mocks.enqueueImagePost.mockRejectedValue(new Error("That slot is today - the earliest slot is 2026-10-11."));

    const response = await book(valid);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("earliest slot");
  });

  it("answers 409 for a deck that is already booked, naming the slot in the publish time zone", async () => {
    mocks.enqueueImagePost.mockRejectedValue(
      new DuplicatePostError("That exact file is already scheduled for 2026-10-13T16:30:00.000Z (post fxa10a28).", "fxa10a28")
    );
    mocks.queueGet.mockResolvedValue({ id: "fxa10a28", publishAt: "2026-10-13T16:30:00.000Z" });

    const response = await book(valid);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("This carousel is already booked for Tue, Oct 13 at 12:30 PM.");
    expect(body.itemId).toBe("fxa10a28");
  });

  it("still answers 409 in plain words when the existing post cannot be read", async () => {
    mocks.enqueueImagePost.mockRejectedValue(new DuplicatePostError("raw", "x1"));
    mocks.queueGet.mockRejectedValue(new Error("unreadable"));

    const response = await book(valid);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("This carousel is already booked.");
  });
});
