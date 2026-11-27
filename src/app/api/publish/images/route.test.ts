import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  enqueueImagePost: vi.fn(),
  queueGet: vi.fn(),
  renderCarouselDeck: vi.fn()
}));

vi.mock("@/lib/publisher/config", () => ({
  publisherConfig: () => ({ enabled: mocks.enabled, timezone: "America/Toronto" })
}));
vi.mock("@/lib/carousels/renderDeck", () => ({ renderCarouselDeck: mocks.renderCarouselDeck }));
vi.mock("@/lib/publisher/queue", () => ({ publishQueue: () => ({ get: mocks.queueGet }) }));
vi.mock("@/lib/publisher/enqueue", () => ({ enqueueImagePost: mocks.enqueueImagePost }));

import { POST } from "@/app/api/publish/images/route";
import { DuplicatePostError } from "@/lib/publisher/duplicates";

const book = (body: unknown) =>
  POST(new NextRequest("http://localhost:3100/api/publish/images", { method: "POST", body: JSON.stringify(body) }));

const paths = ["/slides/03-third.png", "/slides/01-first.png", "/slides/02-second.png"];
const valid = { imagePaths: paths, publishAt: "2026-12-02T12:00", caption: "  Finished deck  ", platforms: ["instagram"] };

describe("POST /api/publish/images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.enqueueImagePost.mockResolvedValue({
      id: "img12345",
      publishAt: "2026-12-02T17:00:00.000Z",
      platforms: { instagram: { status: "pending" } }
    });
  });

  it("books the exact files in the order given, without repainting them", async () => {
    const response = await book({ ...valid, title: "Deck" });

    expect(response.status).toBe(201);
    expect(mocks.renderCarouselDeck).not.toHaveBeenCalled();
    expect(mocks.enqueueImagePost).toHaveBeenCalledTimes(1);
    const options = mocks.enqueueImagePost.mock.calls[0][0];
    expect(options.imagePaths).toEqual(paths);
    expect(options).toMatchObject({
      publishAt: "2026-12-02T12:00",
      caption: "Finished deck",
      title: "Deck",
      platforms: ["instagram"],
      visibility: "public",
      by: "api-image-post-book",
      metadataSource: { streamTitle: "Deck", spokenText: "Finished deck" }
    });
    expect(options.allowSameDay).toBeUndefined();
    expect(options.allowDuplicate).toBeUndefined();
    expect(await response.json()).toEqual({
      item: { id: "img12345", publishAt: "2026-12-02T17:00:00.000Z", platforms: { instagram: "pending" } },
      timeZone: "America/Toronto"
    });
  });

  it("passes pairFacebook through so Instagram can be booked alone", async () => {
    await book({ ...valid, pairFacebook: false });
    expect(mocks.enqueueImagePost.mock.calls[0][0].pairFacebook).toBe(false);

    await book(valid);
    expect(mocks.enqueueImagePost.mock.calls[1][0].pairFacebook).toBeUndefined();
  });

  it.each([
    ["no paths", { ...valid, imagePaths: [] }],
    ["a relative path", { ...valid, imagePaths: ["slides/01.png"] }],
    ["too many pictures", { ...valid, imagePaths: Array.from({ length: 11 }, (_, i) => `/s/${i}.png`) }],
    ["an empty caption", { ...valid, caption: "   " }],
    ["a time that is not wall-clock", { ...valid, publishAt: "tomorrow" }],
    ["no platforms", { ...valid, platforms: [] }],
    ["TikTok", { ...valid, platforms: ["tiktok"] }]
  ])("answers 400 for %s", async (_label, body) => {
    const response = await book(body);

    expect(response.status).toBe(400);
    expect(mocks.enqueueImagePost).not.toHaveBeenCalled();
  });

  it("refuses while publishing is switched off", async () => {
    mocks.enabled = false;

    expect((await book(valid)).status).toBe(400);
    expect(mocks.enqueueImagePost).not.toHaveBeenCalled();
  });

  it("passes the queue's own refusal back as a 400", async () => {
    mocks.enqueueImagePost.mockRejectedValue(new Error("That slot is today - the earliest slot is 2026-11-28."));

    const response = await book(valid);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("earliest slot");
  });

  it("answers 409 for pictures already booked, naming the slot in the publish time zone", async () => {
    mocks.enqueueImagePost.mockRejectedValue(new DuplicatePostError("raw", "fxa10a28"));
    mocks.queueGet.mockResolvedValue({ id: "fxa10a28", publishAt: "2026-12-02T17:30:00.000Z" });

    const response = await book(valid);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "These pictures are already booked for Wed, Dec 2 at 12:30 PM.",
      itemId: "fxa10a28"
    });
  });
});
