import { vi } from "vitest";
import type { PublisherConfig } from "@/lib/publisher/config";
import type { QueueStore } from "@/lib/publisher/store";
import { newPlatformState } from "@/lib/publisher/queue";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";

/** In-memory QueueStore so tests exercise real (de)serialization. */
export class MemoryQueueStore implements QueueStore {
  text: string | null = null;
  saves = 0;

  describe(): string {
    return "memory";
  }

  async load(): Promise<string | null> {
    return this.text;
  }

  async save(text: string): Promise<void> {
    this.saves += 1;
    this.text = text;
  }
}

export function testConfig(overrides: Partial<PublisherConfig> = {}): PublisherConfig {
  return {
    enabled: true,
    autoEnqueue: false,
    platforms: ["youtube", "instagram", "tiktok"],
    timezone: "America/Toronto",
    defaultVisibility: "private",
    autoEnqueueDelayMinutes: 60,
    queueBackend: "file",
    maxAttempts: 3,
    backoffBaseMinutes: 2,
    backoffCapMinutes: 120,
    claimTimeoutMinutes: 15,
    youtube: { clientId: "yt-id", clientSecret: "yt-secret", refreshToken: "yt-refresh", categoryId: null, dailyUploadBudget: 6 },
    instagram: {
      userId: "17840000000000000",
      accessToken: "ig-token",
      graphApiVersion: "v23.0",
      webhookVerifyToken: "ig-verify-token",
      appSecret: "ig-app-secret"
    },
    facebook: { pageId: "10000000000000000", pageAccessToken: "fb-token", graphApiVersion: "v23.0" },
    tiktok: { clientKey: "tt-key", clientSecret: "tt-secret", refreshToken: "tt-refresh", audited: false },
    s3: { endpoint: null, bucket: null, accessKeyId: null, secretAccessKey: null, region: "auto", publicBaseUrl: null },
    buffer: { enabled: false, accessToken: null, profileIds: [], apiBase: "https://api.bufferapp.com/1", shortenLinks: true },
    ...overrides
  };
}

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Buffer | URLSearchParams | undefined;
};

/**
 * Installs a global fetch mock that routes by URL substring and records every
 * request so tests can assert the exact outgoing shape. Returns the record.
 */
export function mockFetchRoutes(
  routes: Array<{ match: string; respond: (request: RecordedRequest) => Response }>
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const request: RecordedRequest = {
        url: String(url),
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body as RecordedRequest["body"]
      };
      requests.push(request);
      const route = routes.find((r) => request.url.includes(r.match));
      if (!route) throw new Error(`Unexpected fetch in test: ${request.method} ${request.url}`);
      return route.respond(request);
    })
  );
  return requests;
}

export function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), { status: 200, ...init });
}

/** Decodes a recorded form-encoded body into a plain object. */
export function formBody(request: RecordedRequest): Record<string, string> {
  const params = request.body instanceof URLSearchParams ? request.body : new URLSearchParams(String(request.body));
  return Object.fromEntries(params.entries());
}

export function testItem(overrides: Partial<QueueItem> & { platformIds?: PlatformId[] } = {}): QueueItem {
  const { platformIds, ...rest } = overrides;
  return {
    id: "item1",
    clipPath: "data/clips/outputs/job1/export-a.mp4",
    title: "Test clip",
    caption: "A test caption",
    hashtags: ["#clips"],
    publishAt: "2026-07-10T22:30:00.000Z",
    visibility: "private",
    createdAt: "2026-07-01T00:00:00.000Z",
    platforms: Object.fromEntries((platformIds ?? ["youtube", "instagram", "tiktok"]).map((p) => [p, newPlatformState()])),
    ...rest
  };
}
