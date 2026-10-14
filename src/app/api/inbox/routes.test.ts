import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH, POST } from "@/app/api/inbox/route";
import { POST as draftPost } from "@/app/api/inbox/draft/route";
import { POST as sendPost } from "@/app/api/inbox/send/route";
import { readInbox, updateInbox } from "@/lib/inbox/store";
import { emptyInbox } from "@/lib/inbox/types";
import { jsonResponse, sampleItem, stubFetch, writeCalls } from "@/lib/inbox/test-helpers";

const syncInbox = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inbox/sync", () => ({ syncInbox }));
vi.mock("@/lib/ai", () => ({ runAi: vi.fn(async () => ({ text: "Thanks for watching.", refused: false })) }));
vi.mock("@/lib/publisher/adapters/youtube", () => ({ youtubeAccessToken: vi.fn(async () => "yt-token") }));

const request = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });

beforeEach(async () => {
  syncInbox.mockReset();
  await updateInbox(() => ({
    ...emptyInbox(),
    items: [
      sampleItem({ id: "youtube:a", externalId: "a", at: "2026-10-12T10:00:00.000Z" }),
      sampleItem({ id: "instagram:b", externalId: "b", platform: "instagram", at: "2026-10-12T11:00:00.000Z" }),
      sampleItem({ id: "youtube:c", externalId: "c", status: "done", at: "2026-10-11T10:00:00.000Z" })
    ],
    platforms: { youtube: { needs: "scope", message: "Reconnect YouTube with comment permission" } }
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/inbox", () => {
  it("answers the sidebar with just the unread count", async () => {
    const body = await (await GET(request("/api/inbox?summary=1", "GET"))).json();
    expect(body).toMatchObject({ unread: 2 });
    expect(body.items).toBeUndefined();
  });

  it("filters by platform and status, newest first, with counts across the whole inbox", async () => {
    const body = await (await GET(request("/api/inbox?platform=youtube&status=new", "GET"))).json();
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["youtube:a"]);
    expect(body.counts).toMatchObject({ new: 2, done: 1 });
    expect(body.platforms.youtube.message).toBe("Reconnect YouTube with comment permission");
  });
});

describe("mutations", () => {
  it("marks one item done", async () => {
    const response = await PATCH(request("/api/inbox", "PATCH", { id: "youtube:a", status: "done" }));
    expect(response.status).toBe(200);
    expect((await readInbox()).items.find((item) => item.id === "youtube:a")?.status).toBe("done");
  });

  it("refuses a status it does not know", async () => {
    expect((await PATCH(request("/api/inbox", "PATCH", { id: "youtube:a", status: "banana" }))).status).toBe(400);
  });

  it("marks everything seen, optionally per platform", async () => {
    await POST(request("/api/inbox", "POST", { action: "markAllSeen", platform: "instagram" }));
    const items = (await readInbox()).items;
    expect(items.find((item) => item.id === "instagram:b")?.status).toBe("seen");
    expect(items.find((item) => item.id === "youtube:a")?.status).toBe("new");

    await POST(request("/api/inbox", "POST", { action: "markAllSeen" }));
    expect((await readInbox()).items.find((item) => item.id === "youtube:a")?.status).toBe("seen");
  });

  it("runs a forced sync on refresh", async () => {
    syncInbox.mockResolvedValue({ at: "now", added: 3, platforms: {} });
    const response = await POST(request("/api/inbox", "POST", { action: "sync" }));
    expect(syncInbox).toHaveBeenCalledWith({ force: true });
    expect((await response.json()).added).toBe(3);
  });

  it("refuses a request from another origin", async () => {
    const foreign = new NextRequest("http://localhost/api/inbox", {
      method: "POST",
      body: JSON.stringify({ action: "markAllSeen" }),
      headers: { origin: "https://evil.example", "content-type": "application/json" }
    });
    expect((await POST(foreign)).status).toBe(403);
  });
});

describe("POST /api/inbox/draft", () => {
  it("returns a draft and sends nothing", async () => {
    const calls = stubFetch(() => jsonResponse({}));

    const response = await draftPost(request("/api/inbox/draft", "POST", { id: "youtube:a" }));

    expect(response.status).toBe(200);
    expect((await response.json()).draft).toBe("Thanks for watching.");
    expect(calls).toEqual([]);
    expect((await readInbox()).items.find((item) => item.id === "youtube:a")?.status).toBe("new");
  });
});

describe("POST /api/inbox/send", () => {
  beforeEach(() => {
    vi.stubEnv("YOUTUBE_CLIENT_ID", "yt-id");
    vi.stubEnv("YOUTUBE_CLIENT_SECRET", "yt-secret");
    vi.stubEnv("YOUTUBE_REFRESH_TOKEN", "yt-refresh");
  });

  it("sends nothing unless the call says confirm: true", async () => {
    const calls = stubFetch(() => jsonResponse({ id: "r" }));

    expect((await sendPost(request("/api/inbox/send", "POST", { id: "youtube:a", text: "Thanks" }))).status).toBe(400);
    expect((await sendPost(request("/api/inbox/send", "POST", { id: "youtube:a", text: "Thanks", confirm: "yes" }))).status).toBe(400);

    expect(calls).toEqual([]);
    expect((await readInbox()).items.find((item) => item.id === "youtube:a")?.status).toBe("new");
  });

  it("sends exactly one reply on an explicit confirmed call", async () => {
    const calls = stubFetch((call) =>
      call.url.includes("tokeninfo") ? jsonResponse({ scope: "https://www.googleapis.com/auth/youtube.force-ssl" }) : jsonResponse({ id: "r1" })
    );

    const response = await sendPost(request("/api/inbox/send", "POST", { id: "youtube:a", text: "Thanks", confirm: true }));

    expect(response.status).toBe(200);
    expect(writeCalls(calls)).toHaveLength(1);
    expect((await readInbox()).items.find((item) => item.id === "youtube:a")?.status).toBe("replied");
  });

  it("refuses a resend after an unknown outcome unless the request carries override: true", async () => {
    await updateInbox((store) => ({
      ...store,
      items: store.items.map((item) =>
        item.id === "youtube:a" ? { ...item, send: { state: "send-unknown" as const, at: "2026-10-12T10:00:00.000Z", text: "Thanks", error: "timeout" } } : item
      )
    }));
    const calls = stubFetch((call) =>
      call.url.includes("tokeninfo") ? jsonResponse({ scope: "https://www.googleapis.com/auth/youtube.force-ssl" }) : jsonResponse({ id: "r2" })
    );

    const refused = await sendPost(request("/api/inbox/send", "POST", { id: "youtube:a", text: "Thanks", confirm: true }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).kind).toBe("send-unknown");
    expect(writeCalls(calls)).toEqual([]);

    const sent = await sendPost(request("/api/inbox/send", "POST", { id: "youtube:a", text: "Thanks", confirm: true, override: true }));
    expect(sent.status).toBe(200);
    expect(writeCalls(calls)).toHaveLength(1);
    expect((await readInbox()).items.find((item) => item.id === "youtube:a")?.status).toBe("replied");
  });

  it("answers 502 with kind send-unknown when the platform's answer was lost", async () => {
    stubFetch((call) => {
      if (call.url.includes("tokeninfo")) return jsonResponse({ scope: "https://www.googleapis.com/auth/youtube.force-ssl" });
      throw new TypeError("fetch failed");
    });

    const response = await sendPost(request("/api/inbox/send", "POST", { id: "youtube:a", text: "Thanks", confirm: true }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.kind).toBe("send-unknown");
    expect(body.error).toMatch(/check the platform/i);
  });

  it("answers 409 with the reconnect message when the permission is missing", async () => {
    stubFetch((call) => (call.url.includes("tokeninfo") ? jsonResponse({ scope: "https://www.googleapis.com/auth/youtube.upload" }) : jsonResponse({ id: "r" })));

    const response = await sendPost(request("/api/inbox/send", "POST", { id: "youtube:a", text: "Thanks", confirm: true }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Reconnect YouTube with comment permission");
  });
});
