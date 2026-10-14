import { rm } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH, POST } from "./route";
import { updateListeningConfig } from "@/lib/listening/config";
import type { ListeningResult } from "@/lib/listening/model";
import { updateListeningStore } from "@/lib/listening/store";
import { readOutreachStore } from "@/lib/outreach/store";
import { dataPath } from "@/lib/paths";

const URL_BASE = "http://localhost:3000/api/listening";

function request(method: string, body?: unknown, headers: Record<string, string> = {}, search = "") {
  return new NextRequest(`${URL_BASE}${search}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function hit(overrides: Partial<ListeningResult> & { id: string }): ListeningResult {
  return {
    source: "reddit",
    title: overrides.id,
    url: `https://www.reddit.com/${overrides.id}`,
    author: "dana",
    createdAt: "2026-10-12T10:00:00.000Z",
    excerpt: "",
    matchedTerms: [],
    status: "new",
    note: "",
    foundAt: "2026-10-12T12:00:00.000Z",
    category: "lead",
    sentiment: 0,
    score: 90,
    reason: "asks for a tool",
    classifiedBy: "ai",
    alsoOn: [],
    ...overrides
  };
}

beforeEach(async () => {
  await rm(dataPath("listening.json"), { force: true });
  await rm(dataPath("listening"), { recursive: true, force: true });
  await rm(dataPath("outreach.json"), { force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/listening", () => {
  it("answers with the keywords, switches and hits together", async () => {
    const body = await (await GET(request("GET"))).json();
    expect(body.groups.length).toBeGreaterThan(0);
    expect(body.sources).toEqual({ hn: true, reddit: true, youtube: false, bluesky: true, x: false });
    expect(body.autoScan).toBe(true);
    expect(body.results).toEqual([]);
  });

  it("answers ?summary=1 with just the new high-score leads, for the badge and the toast", async () => {
    await updateListeningStore((store) => ({
      ...store,
      results: [hit({ id: "a", score: 95 }), hit({ id: "b", score: 40 }), hit({ id: "c", status: "seen" })]
    }));

    const body = await (await GET(request("GET", undefined, {}, "?summary=1"))).json();

    expect(body.newLeads).toBe(1);
    expect(body.leads).toEqual([{ id: "a", title: "a", source: "reddit", score: 95, url: "https://www.reddit.com/a" }]);
    expect(body.lastScanAt).toBeNull();
  });
});

describe("PATCH /api/listening", () => {
  it("saves keyword edits, source switches and the schedule switch to the config", async () => {
    const groups = [{ id: "mine", name: "Mine", intent: "pain", canLead: true, terms: ["my term"] }];
    expect((await (await PATCH(request("PATCH", { groups }))).json()).groups).toEqual(groups);

    const afterSources = await (await PATCH(request("PATCH", { sources: { youtube: true } }))).json();
    expect(afterSources.sources).toMatchObject({ youtube: true, hn: true, bluesky: true });

    expect((await (await PATCH(request("PATCH", { autoScan: false }))).json()).autoScan).toBe(false);
  });

  it("refuses more keyword groups than the limit", async () => {
    const groups = Array.from({ length: 21 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, intent: "pain", canLead: true, terms: [`t${i}`] }));
    expect((await PATCH(request("PATCH", { groups }))).status).toBe(400);
  });

  it("refuses a keyword group with more terms than the limit", async () => {
    const terms = Array.from({ length: 13 }, (_, i) => `term ${i}`);
    const response = await PATCH(request("PATCH", { groups: [{ id: "big", name: "Big", intent: "pain", canLead: true, terms }] }));
    expect(response.status).toBe(400);
  });

  it("triages a hit but will not mark one as sent to Outreach by hand", async () => {
    await updateListeningStore((store) => ({ ...store, results: [hit({ id: "a" })] }));

    const seen = await (await PATCH(request("PATCH", { resultId: "a", status: "seen", note: "replied on site" }))).json();
    expect(seen.results[0]).toMatchObject({ status: "seen", note: "replied on site" });

    expect((await PATCH(request("PATCH", { resultId: "a", status: "sent-to-outreach" }))).status).toBe(400);
    expect((await PATCH(request("PATCH", { resultId: "nope", status: "seen" }))).status).toBe(404);
  });

  it("refuses a request from another origin", async () => {
    expect((await PATCH(request("PATCH", { autoScan: false }, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("POST /api/listening", () => {
  it("files a hit in Outreach and returns the contact", async () => {
    await updateListeningStore((store) => ({ ...store, results: [hit({ id: "a" })] }));

    const response = await POST(request("POST", { action: "send-to-outreach", resultId: "a" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.created).toBe(true);
    expect(body.results[0]).toMatchObject({ status: "sent-to-outreach", outreachContactId: body.contactId });
    expect((await readOutreachStore()).contacts.map((contact) => contact.id)).toEqual([body.contactId]);
  });

  it("answers 404 for a hit that is not on the list", async () => {
    expect((await POST(request("POST", { action: "send-to-outreach", resultId: "nope" }))).status).toBe(404);
  });

  it("scans on demand and reports what happened", async () => {
    await updateListeningConfig((config) => ({
      ...config,
      groups: [{ id: "one", name: "One", intent: "pain", canLead: true, terms: ["structural engineering AI"] }],
      sources: { hn: false, reddit: false, youtube: false, bluesky: true, x: false }
    }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ posts: [] }), { status: 200 })));

    const body = await (await POST(request("POST", { action: "scan" }))).json();

    expect(body.report.sources.map((source: { source: string }) => source.source)).toEqual(["bluesky"]);
    expect(body.joined).toBe(false);
    expect(body.lastScan.at).toBe(body.report.at);
  });

  it("rejects an unknown action and a foreign origin", async () => {
    expect((await POST(request("POST", { action: "delete-everything" }))).status).toBe(400);
    expect((await POST(request("POST", { action: "scan" }, { origin: "https://evil.example" }))).status).toBe(403);
  });
});
