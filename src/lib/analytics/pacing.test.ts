import { describe, expect, it } from "vitest";
import { PacedStop } from "@/lib/analytics/outcome";
import { createPacer, pacedRequest, parseMetaUsage } from "@/lib/analytics/pacing";
import { httpDeps } from "@/lib/analytics/test-helpers";

const headers = (values: Record<string, string>) => new Headers(values);

describe("parseMetaUsage", () => {
  it("reads the app usage header as its highest percentage", () => {
    expect(parseMetaUsage(headers({ "x-app-usage": '{"call_count":28,"total_time":41,"total_cputime":25}' }))).toEqual({ percent: 41, regainMinutes: 0 });
  });

  it("reads every business use case in the header and how long Meta says to wait", () => {
    const usage = parseMetaUsage(
      headers({
        "x-business-use-case-usage": JSON.stringify({
          "1784": [{ type: "instagram", call_count: 80, total_cputime: 10, total_time: 12, estimated_time_to_regain_access: 15 }],
          "999": [{ type: "pages", call_count: 5, total_cputime: 2, total_time: 3, estimated_time_to_regain_access: 0 }]
        })
      })
    );

    expect(usage).toEqual({ percent: 80, regainMinutes: 15 });
  });

  it("is zero when neither header is there or they cannot be read", () => {
    expect(parseMetaUsage(headers({}))).toEqual({ percent: 0, regainMinutes: 0 });
    expect(parseMetaUsage(headers({ "x-app-usage": "nope" }))).toEqual({ percent: 0, regainMinutes: 0 });
  });
});

describe("createPacer", () => {
  it("allows calls up to the cap, then stops with a budget stop", () => {
    const pacer = createPacer({ maxCalls: 3 });

    expect([pacer.take(), pacer.take(), pacer.take()]).toEqual([null, null, null]);
    expect(pacer.take()).toMatchObject({ kind: "budget" });
    expect(pacer.calls()).toBe(3);
  });

  it("stops above 75 percent of Meta's usage, and not at 75", () => {
    const pacer = createPacer({ maxCalls: 100 });

    pacer.observe(headers({ "x-app-usage": '{"call_count":75,"total_time":10,"total_cputime":10}' }));
    expect(pacer.take()).toBeNull();

    pacer.observe(headers({ "x-app-usage": '{"call_count":76,"total_time":10,"total_cputime":10}' }));
    expect(pacer.take()).toMatchObject({ kind: "rate", retryAfterMs: 3_600_000 });
    expect(pacer.peak()).toBe(76);
  });

  it("waits as long as Meta says when it says longer than an hour is not needed", () => {
    const pacer = createPacer({ maxCalls: 100 });
    pacer.observe(headers({ "x-business-use-case-usage": JSON.stringify({ "1": [{ call_count: 90, total_cputime: 1, total_time: 1, estimated_time_to_regain_access: 95 }] }) }));

    expect(pacer.take()).toMatchObject({ kind: "rate", retryAfterMs: 95 * 60_000 });
  });
});

describe("pacedRequest", () => {
  it("counts each call, feeds the headers to the pacer, and refuses the request that would pass a limit", async () => {
    const { deps, calls } = httpDeps([
      { match: "/a", reply: { headers: { "x-app-usage": '{"call_count":90,"total_time":1,"total_cputime":1}' }, body: { ok: 1 } } }
    ]);
    const pacer = createPacer({ maxCalls: 10 });
    const request = pacedRequest(pacer, deps);

    await expect(request("https://example.test/a", { label: "A" })).resolves.toEqual({ ok: 1 });
    const refused = await request("https://example.test/a", { label: "A" }).catch((error) => error);

    expect(refused).toBeInstanceOf(PacedStop);
    expect((refused as PacedStop).stop.kind).toBe("rate");
    expect(calls).toHaveLength(1);
  });

  it("is a plain request when there is no pacer", async () => {
    const { deps, calls } = httpDeps([{ match: "/a", reply: { body: { ok: 1 } } }]);

    await pacedRequest(undefined, deps)("https://example.test/a", { label: "A" });
    await pacedRequest(undefined, deps)("https://example.test/a", { label: "A" });

    expect(calls).toHaveLength(2);
  });
});
