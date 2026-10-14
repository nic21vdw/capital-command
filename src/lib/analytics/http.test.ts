import { describe, expect, it } from "vitest";
import { AnalyticsHttpError, RateLimitedError, classifyFailure, requestJson } from "@/lib/analytics/http";
import { isAuthFailure } from "@/lib/platform-health/auth";
import { httpDeps } from "@/lib/analytics/test-helpers";

const URL = "https://api.example.test/v1/thing";

describe("requestJson", () => {
  it("returns the parsed body and sends the headers it was given", async () => {
    const { deps, calls } = httpDeps([{ match: URL, reply: { body: { ok: 1 } } }]);

    const result = await requestJson<{ ok: number }>(URL, { label: "Thing", headers: { Authorization: "Bearer t" } }, deps);

    expect(result).toEqual({ ok: 1 });
    expect(calls[0]).toMatchObject({ method: "GET", headers: { Authorization: "Bearer t" } });
  });

  it("waits out a 429 for as long as Retry-After says, then carries on", async () => {
    const { deps, sleeps, calls } = httpDeps([
      { match: URL, reply: [{ status: 429, headers: { "Retry-After": "7" }, body: {} }, { body: { ok: 1 } }] }
    ]);

    await expect(requestJson(URL, { label: "Thing" }, deps)).resolves.toEqual({ ok: 1 });

    expect(sleeps).toEqual([7000]);
    expect(calls).toHaveLength(2);
  });

  it("backs off exponentially when a 429 carries no Retry-After", async () => {
    const { deps, sleeps } = httpDeps([
      { match: URL, reply: [{ status: 429 }, { status: 429 }, { status: 429 }, { body: { ok: 1 } }] }
    ]);

    await requestJson(URL, { label: "Thing" }, deps);

    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("gives up after its retries and says how long to leave the platform alone", async () => {
    const { deps, calls, sleeps } = httpDeps([{ match: URL, reply: { status: 429, headers: { "Retry-After": "30" } } }]);

    const error = await requestJson(URL, { label: "Thing" }, { ...deps, maxRetries: 2 }).catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(30_000);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([30_000, 30_000]);
  });

  it("does not sit out a long wait inline: it reports it and lets the caller leave the platform alone", async () => {
    const { deps, calls, sleeps } = httpDeps([{ match: URL, reply: { status: 429, headers: { "Retry-After": "3600" } } }]);

    const error = await requestJson(URL, { label: "Thing" }, deps).catch((caught) => caught);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).retryAfterMs).toBe(3_600_000);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("does not retry a plain client error, and words it so the auth breaker recognises a 401", async () => {
    const { deps, calls } = httpDeps([
      { match: URL, reply: { status: 401, body: { error: { message: "Invalid Credentials" } } } }
    ]);

    const error = await requestJson(URL, { label: "YouTube video statistics" }, deps).catch((caught) => caught);

    expect(error).toBeInstanceOf(AnalyticsHttpError);
    expect((error as AnalyticsHttpError).status).toBe(401);
    expect(isAuthFailure(error)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("hands every response's headers to the observer, including a failing one", async () => {
    const seen: Array<string | null> = [];
    const { deps } = httpDeps([
      { match: URL, reply: [{ status: 400, headers: { "x-app-usage": "a" }, body: {} }, { headers: { "x-app-usage": "b" }, body: { ok: 1 } }] }
    ]);
    const observe = (headers: Headers) => seen.push(headers.get("x-app-usage"));

    await requestJson(URL, { label: "Thing" }, { ...deps, onResponse: observe }).catch(() => undefined);
    await requestJson(URL, { label: "Thing" }, { ...deps, onResponse: observe });

    expect(seen).toEqual(["a", "b"]);
  });

  it("reports a network failure as an error the caller can classify as transient", async () => {
    const deps = {
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      sleep: async () => undefined
    };

    const error = await requestJson(URL, { label: "Thing" }, deps).catch((caught) => caught);

    expect((error as Error).message).toContain("network error");
    expect(classifyFailure(error).kind).toBe("other");
  });
});

describe("classifyFailure", () => {
  const http = (status: number, body: unknown) =>
    new AnalyticsHttpError("Thing", status, typeof body === "string" ? body : JSON.stringify(body));

  it("calls an expired or revoked token an auth failure", () => {
    expect(classifyFailure(http(401, { error: { message: "Invalid Credentials" } })).kind).toBe("auth");
    expect(classifyFailure(http(400, { error: { code: 190, message: "Error validating access token: Session has expired" } })).kind).toBe("auth");
  });

  it("calls a missing permission a scope problem, not an auth failure", () => {
    expect(
      classifyFailure(http(403, { error: { code: 403, message: "Insufficient Permission", errors: [{ reason: "insufficientPermissions" }] } })).kind
    ).toBe("scope");
    expect(classifyFailure(http(400, { error: { code: 10, message: "(#10) Application does not have permission for this action" } })).kind).toBe("scope");
    expect(classifyFailure(http(403, { error: { message: "YouTube Analytics API has not been used in project 1 before or it is disabled." } })).kind).toBe("scope");
    expect(classifyFailure(http(401, { error: { code: "scope_not_authorized", message: "The user did not authorize the scope" } })).kind).toBe("scope");
  });

  it("calls a 429 and the platforms' own limit codes rate limiting", () => {
    expect(classifyFailure(http(429, "")).kind).toBe("rate");
    expect(classifyFailure(http(403, { error: { errors: [{ reason: "quotaExceeded" }] } })).kind).toBe("rate");
    expect(classifyFailure(http(400, { error: { code: 4, message: "(#4) Application request limit reached" } })).kind).toBe("rate");
    expect(classifyFailure(new RateLimitedError("Thing", 5000))).toEqual({ kind: "rate", retryAfterMs: 5000 });
  });

  it("does not call a missing-permissions answer gone, even though Meta words a deleted object the same way", () => {
    const ambiguous = http(400, {
      error: {
        code: 100,
        error_subcode: 33,
        message: "Unsupported get request. Object with ID '1' does not exist, cannot be loaded due to missing permissions, or does not support this operation"
      }
    });

    expect(classifyFailure(ambiguous).kind).toBe("other");
    expect(classifyFailure(http(400, { error: { code: 100, error_subcode: 33, message: "Object with ID '1' does not exist" } })).kind).toBe("gone");
  });

  it("calls a 404 gone, and anything else other", () => {
    expect(classifyFailure(http(404, "{}")).kind).toBe("gone");
    expect(classifyFailure(http(500, "boom")).kind).toBe("other");
    expect(classifyFailure(new Error("something odd")).kind).toBe("other");
  });
});
