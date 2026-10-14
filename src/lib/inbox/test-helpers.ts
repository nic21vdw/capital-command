import { vi } from "vitest";
import type { InboxItem, PublishedPost } from "@/lib/inbox/types";

export type FetchCall = { url: string; method: string; headers: Record<string, string>; body: string };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: FetchCall = {
        url: String(input),
        method: (init?.method ?? "GET").toUpperCase(),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? String(init.body) : ""
      };
      calls.push(call);
      return handler(call);
    })
  );
  return calls;
}

export function writeCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.method !== "GET");
}

export function samplePost(overrides: Partial<PublishedPost> = {}): PublishedPost {
  return {
    platform: "youtube",
    accountId: "youtube-primary",
    postId: "vid1",
    title: "A short about worktrees",
    publishedAt: "2026-10-10T12:00:00.000Z",
    ...overrides
  };
}

export function sampleItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "youtube:c1",
    platform: "youtube",
    accountId: "youtube-primary",
    postId: "vid1",
    postTitle: "A short about worktrees",
    externalId: "c1",
    kind: "comment",
    authorName: "Dana",
    text: "Does this work with Codex too?",
    at: "2026-10-12T10:00:00.000Z",
    status: "new",
    statusAt: "2026-10-12T10:05:00.000Z",
    fetchedAt: "2026-10-12T10:05:00.000Z",
    source: "poll",
    ...overrides
  };
}
