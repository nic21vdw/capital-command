import { vi } from "vitest";
import type { HttpDeps } from "@/lib/analytics/http";

export type MockReply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

export type MockCall = { url: string; method: string; headers: Record<string, string>; body: string | null };

export type MockRoute = {
  match: string | RegExp;
  reply: MockReply | MockReply[] | ((call: MockCall) => MockReply);
};

export function jsonResponse(reply: MockReply): Response {
  const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
  return new Response(body, {
    status: reply.status ?? 200,
    headers: { "Content-Type": "application/json", ...(reply.headers ?? {}) }
  });
}

export function mockFetch(routes: MockRoute[]) {
  const calls: MockCall[] = [];
  const counters = new Map<MockRoute, number>();
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: MockCall = {
      url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body === undefined || init.body === null ? null : String(init.body)
    };
    calls.push(call);
    const route = routes.find((candidate) =>
      typeof candidate.match === "string" ? url.includes(candidate.match) : candidate.match.test(url)
    );
    if (!route) return jsonResponse({ status: 599, body: { error: { message: `no mock for ${url}` } } });
    if (typeof route.reply === "function") return jsonResponse(route.reply(call));
    if (Array.isArray(route.reply)) {
      const index = counters.get(route) ?? 0;
      counters.set(route, index + 1);
      return jsonResponse(route.reply[Math.min(index, route.reply.length - 1)]);
    }
    return jsonResponse(route.reply);
  });
  return { fetch: fn as unknown as typeof fetch, calls, mock: fn };
}

export function httpDeps(routes: MockRoute[]) {
  const mocked = mockFetch(routes);
  const sleeps: number[] = [];
  const deps: HttpDeps = {
    fetch: mocked.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  };
  return { deps, calls: mocked.calls, sleeps, mock: mocked.mock };
}
