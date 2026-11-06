import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDue: vi.fn(async () => undefined),
  readAppData: vi.fn(),
  renderCarouselDeck: vi.fn()
}));

vi.mock("@/lib/publisher/runner", () => ({ runDue: mocks.runDue }));
vi.mock("@/lib/publisher/vertical", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/vertical")>()),
  prepareVerticalMedia: vi.fn(async (absolute: string) => ({ path: absolute, converted: false }))
}));
vi.mock("@/lib/publisher/hosting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/hosting")>()),
  hostImages: vi.fn(async (paths: string[], itemId: string) => paths.map((entry, index) => `publisher/media/${itemId}/${index}-${path.basename(entry)}`))
}));
vi.mock("@/lib/storage/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/store")>()),
  readAppData: mocks.readAppData
}));
vi.mock("@/lib/carousels/renderDeck", () => ({ renderCarouselDeck: mocks.renderCarouselDeck }));

const API_ROOT = path.resolve(__dirname, "..");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const routes = routeFiles(API_ROOT).map((file) => ({
  file: path.relative(API_ROOT, file).split(path.sep).join("/"),
  source: readFileSync(file, "utf8")
}));

function dateKeyIn(days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Date.now() + days * 86_400_000));
}

let dir: string;
let clip: string;
let slides: string[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "queue-door-"));
  clip = path.join(dir, "clip.mp4");
  await writeFile(clip, Buffer.alloc(256, 7));
  slides = [path.join(dir, "slide-1.png"), path.join(dir, "slide-2.png")];
  for (const [index, slide] of slides.entries()) await writeFile(slide, Buffer.alloc(64, index + 1));

  vi.stubEnv("PUBLISH_ENABLED", "true");
  vi.stubEnv("PUBLISH_PLATFORMS", "youtube,instagram,facebook");
  vi.stubEnv("PUBLISH_TIMEZONE", "America/Toronto");
  vi.stubEnv("IG_USER_ID", "17840000000000000");
  vi.stubEnv("IG_ACCESS_TOKEN", "ig-token");
  vi.stubEnv("S3_ENDPOINT", "https://example.r2.test");
  vi.stubEnv("S3_BUCKET", "bucket");
  vi.stubEnv("S3_ACCESS_KEY_ID", "key");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "secret");
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("no network in this test");
  }));
  mocks.runDue.mockClear();
  mocks.renderCarouselDeck.mockResolvedValue(slides);
  mocks.readAppData.mockResolvedValue({
    videoStudio: {
      scripts: [],
      carousels: [{ id: "deck-1", title: "Five tips", sourceType: "script", aspectRatio: "portrait", createdAt: "2026-01-01T00:00:00.000Z", slides: [{ id: "s0", heading: "One", body: "Body" }, { id: "s1", heading: "Two", body: "Body" }] }]
    }
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function queueItems() {
  const { publishQueue } = await import("@/lib/publisher/queue");
  return publishQueue().list();
}

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function bookClip(publishAt: string, extra: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/publish/route");
  return POST(json("/api/publish", "POST", {
    clipPath: clip,
    publishAt,
    platforms: ["youtube"],
    title: "How I wired agents into my editor",
    caption: "Building in public.",
    hashtags: ["#ai"],
    ...extra
  }));
}

async function uploadClip(publishAt: string) {
  const { POST } = await import("@/app/api/publish/upload/route");
  const query = new URLSearchParams({ name: "upload.mp4", publishAt, platform: "youtube" });
  return POST(new NextRequest(`http://localhost:3000/api/publish/upload?${query}`, {
    method: "POST",
    body: Buffer.alloc(256, 9),
    headers: { "content-type": "video/mp4" },
    duplex: "half"
  } as ConstructorParameters<typeof NextRequest>[1]));
}

async function bookDeck(publishAt: string) {
  const { POST } = await import("@/app/api/studio/carousels/[carouselId]/book/route");
  return POST(json("/api/studio/carousels/deck-1/book", "POST", { publishAt, platforms: ["instagram", "facebook"], caption: "Fresh tips" }), {
    params: Promise.resolve({ carouselId: "deck-1" })
  });
}

describe("every booking route refuses a time later today, through the real enqueue", () => {
  it.each([
    ["POST /api/publish", () => bookClip(`${dateKeyIn(0)}T23:59`)],
    ["POST /api/publish/upload", () => uploadClip(`${dateKeyIn(0)}T23:59`)],
    ["POST /api/studio/carousels/:id/book", () => bookDeck(`${dateKeyIn(0)}T23:59`)]
  ])("%s answers 400 and adds nothing", async (_route, call) => {
    const before = (await queueItems()).length;
    const response = await call();
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/today|tomorrow/i);
    expect(await queueItems()).toHaveLength(before);
    expect(mocks.runDue).not.toHaveBeenCalled();
  });

  it("does not let the request body switch the same-day rule off", async () => {
    const response = await bookClip(`${dateKeyIn(0)}T23:59`, { allowSameDay: true, allowDuplicate: true });
    expect(response.status).toBe(400);
  });
});

describe("every booking route refuses a second copy of what is already booked", () => {
  it("POST /api/publish books once and refuses the same file on another day", async () => {
    expect((await bookClip(`${dateKeyIn(2)}T12:30`)).status).toBe(201);
    const count = (await queueItems()).length;

    const again = await bookClip(`${dateKeyIn(3)}T12:30`, { caption: "rewritten", allowDuplicate: true });

    expect(again.status).toBe(400);
    expect((await again.json()).error).toMatch(/already scheduled/i);
    expect(await queueItems()).toHaveLength(count);
  });

  it("POST /api/studio/carousels/:id/book books once and answers 409 for the same deck", async () => {
    expect((await bookDeck(`${dateKeyIn(2)}T12:30`)).status).toBe(201);
    const count = (await queueItems()).length;

    const again = await bookDeck(`${dateKeyIn(3)}T12:30`);

    expect(again.status).toBe(409);
    expect(await queueItems()).toHaveLength(count);
  });
});

describe("PATCH /api/publish/:id edits copy and nothing else", () => {
  it("cannot move a booked post onto today or create a post that is not there", async () => {
    expect((await bookClip(`${dateKeyIn(2)}T12:30`)).status).toBe(201);
    const [item] = (await queueItems()).filter((entry) => entry.clipPath.endsWith("clip.mp4") && entry.title.includes("agents"));
    const { PATCH } = await import("@/app/api/publish/[id]/route");

    const moved = await PATCH(json(`/api/publish/${item.id}`, "PATCH", { title: "New title", publishAt: `${dateKeyIn(0)}T23:59` }), {
      params: Promise.resolve({ id: item.id })
    });
    expect(moved.status).toBe(200);
    const after = (await queueItems()).find((entry) => entry.id === item.id);
    expect(after?.publishAt).toBe(item.publishAt);
    expect(after?.title).toBe("New title");

    const count = (await queueItems()).length;
    const forged = await PATCH(json("/api/publish/not-booked", "PATCH", { ...item, id: "not-booked", title: "Smuggled in" }), {
      params: Promise.resolve({ id: "not-booked" })
    });
    expect(forged.status).toBe(404);
    expect(await queueItems()).toHaveLength(count);
  });
});

const QUEUE_WRITES = /\.(add|addMany|applyPublishTimes)\s*\(/g;

const EDITS_EXISTING_ITEM: Readonly<Record<string, string>> = {
  "publish/[id]/route.ts": "PATCH re-saves an item it has just read by id (404 otherwise) after changing only title, caption or hashtags."
};

describe("enqueue() is the only door into the publish queue", () => {
  const queueRoutes = routes.filter((route) => /from "@\/lib\/publisher\/queue"/.test(route.source));

  it("finds the routes that touch the queue", () => {
    expect(queueRoutes.map((route) => route.file)).toEqual(expect.arrayContaining(["publish/route.ts", "publish/[id]/route.ts"]));
  });

  it("no route inserts into the queue itself, except an edit of an item it has read", () => {
    const writers = queueRoutes.filter((route) => (route.source.match(QUEUE_WRITES) ?? []).length > 0).map((route) => route.file);
    expect(writers.sort()).toEqual(Object.keys(EDITS_EXISTING_ITEM).sort());
  });

  it("no route writes the queue file or its merge layer directly", () => {
    const direct = routes.filter((route) => /publish-queue\.json|@\/lib\/publisher\/queueMerge|@\/lib\/publisher\/store"/.test(route.source)).map((route) => route.file);
    expect(direct).toEqual([]);
  });

  it("no route can switch off the same-day or duplicate refusal", () => {
    const bypass = routes.filter((route) => /allowSameDay|allowDuplicate/.test(route.source)).map((route) => route.file);
    expect(bypass).toEqual([]);
  });
});
