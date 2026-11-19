import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { dataPath } from "@/lib/paths";
import { credentialSources, forgetCredentials, saveCredentials } from "@/lib/publisher/credentials";
import { readAutomationControls, setAutomationPaused, withAutomationControlsLock } from "@/lib/automations/store";

// Real route, credentials store, controls and atomic writes. Stub all provider
// I/O and admit only the official profile and quota reads.
const replacement = "synthetic-route-replacement";
const userId = "1000000000001";
const handle = "synthetic_profile";
const original = { THREADS_ACCESS_TOKEN: "synthetic-route-current", YOUTUBE_CLIENT_SECRET: "synthetic-unrelated-secret" };
let fetchMock: ReturnType<typeof vi.fn>;
let fixtureResponses: Response[];

beforeEach(async () => {
  await rm(dataPath("credentials.json"), { recursive: true, force: true });
  await rm(dataPath("automations"), { recursive: true, force: true });
  forgetCredentials();
  for (const name of ["THREADS_ACCESS_TOKEN", "THREADS_USER_ID", "THREADS_API_BASE", "THREADS_GRAPH_API_VERSION", "YOUTUBE_CLIENT_SECRET", "TIKTOK_CLIENT_KEY"]) vi.stubEnv(name, "");
  fixtureResponses = [];
  fetchMock = vi.fn((url: string, options: RequestInit) => {
    expect(url).toMatch(/^https:\/\/graph\.threads\.com\/v1\.0\/me(?:\?|\/threads_publishing_limit\?)/);
    expect(options.method).toBe("GET");
    expect(options.redirect).toBe("error");
    expect(url).not.toContain(replacement);
    const response = fixtureResponses.shift();
    if (!response) throw new Error("No provider request is permitted");
    return Promise.resolve(response);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  expect(fixtureResponses).toHaveLength(0);
  expect(console.error).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function post(body: Record<string, unknown>) {
  return new Request("http://localhost:3100/api/connections", { method: "POST", body: JSON.stringify(body) });
}

function request(username = handle) {
  return post({ values: { THREADS_ACCESS_TOKEN: replacement }, threadsHandle: username });
}

function validConnection() {
  fixtureResponses.push(Response.json({ id: userId, username: handle }), Response.json({ data: [{ quota_usage: 1 }] }));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function seedPaused() {
  await setAutomationPaused("threads", true);
  await saveCredentials(original);
}

describe("real Threads credential recovery storage", () => {
  it("refuses the original malformed-file failure with a cold read cache", async () => {
    await setAutomationPaused("threads", true);
    const raw = '{"YOUTUBE_CLIENT_SECRET":"synthetic-unrelated-secret"';
    await writeFile(dataPath("credentials.json"), raw);
    forgetCredentials();
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await response.json()).code).toBe("credential_store_unavailable");
    expect(await readFile(dataPath("credentials.json"), "utf8")).toBe(raw);
    expect(process.env.THREADS_ACCESS_TOKEN).toBe("");
    expect((await readAutomationControls()).threads?.paused).toBe(true);
  });

  it.each([
    '{"YOUTUBE_CLIENT_SECRET":"synthetic-unrelated-secret"',
    "null", "[]", '{"YOUTUBE_CLIENT_SECRET":false}', '{"YOUTUBE_CLIENT_SECRET":""}'
  ])("refuses a damaged store and preserves disk, environment and prior cache: %s", async (raw) => {
    await seedPaused();
    await writeFile(dataPath("credentials.json"), raw);
    const controls = await readFile(dataPath("automations", "control.json"), "utf8");
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.code).toBe("credential_store_unavailable");
    expect(body.error).toContain("repair the credential store");
    expect(JSON.stringify(body)).not.toContain(replacement);
    expect(JSON.stringify(body)).not.toContain(original.YOUTUBE_CLIENT_SECRET);
    expect(JSON.stringify(body)).not.toContain(dataPath("credentials.json"));
    expect(await readFile(dataPath("credentials.json"), "utf8")).toBe(raw);
    expect(await readFile(dataPath("automations", "control.json"), "utf8")).toBe(controls);
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(original.THREADS_ACCESS_TOKEN);
    expect(process.env.YOUTUBE_CLIENT_SECRET).toBe(original.YOUTUBE_CLIENT_SECRET);
    expect(await credentialSources(["THREADS_ACCESS_TOKEN"])).toEqual({ THREADS_ACCESS_TOKEN: "saved" });
  });

  it("refuses an actual filesystem read failure and leaves the unreadable target untouched", async () => {
    await seedPaused();
    await rm(dataPath("credentials.json"));
    await mkdir(dataPath("credentials.json"));
    await writeFile(dataPath("credentials.json", "synthetic-marker"), "preserve this target");
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await response.json()).code).toBe("credential_store_unavailable");
    expect((await stat(dataPath("credentials.json"))).isDirectory()).toBe(true);
    expect(await readFile(dataPath("credentials.json", "synthetic-marker"), "utf8")).toBe("preserve this target");
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(original.THREADS_ACCESS_TOKEN);
    expect((await readAutomationControls()).threads?.paused).toBe(true);
  });

  it("initializes a missing store only while explicitly paused", async () => {
    expect((await POST(request())).status).toBe(409);
    expect(await stat(dataPath("credentials.json")).catch(() => null)).toBeNull();
    await setAutomationPaused("threads", true);
    expect(fetchMock).not.toHaveBeenCalled();
    validConnection();
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.threadsConnection).toMatchObject({ state: "verified", username: handle });
    expect(JSON.stringify(body)).not.toContain(replacement);
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({
      THREADS_ACCESS_TOKEN: replacement, THREADS_USER_ID: userId
    });
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(replacement);
    expect((await readAutomationControls()).threads?.paused).toBe(true);
  });

  it("preserves unrelated fresh disk credentials even when the read cache is older", async () => {
    await seedPaused();
    const fresh = { ...original, YOUTUBE_CLIENT_SECRET: "synthetic-fresh-unrelated", FUTURE_PROVIDER_KEY: " synthetic-future " };
    await writeFile(dataPath("credentials.json"), JSON.stringify(fresh));
    validConnection();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({ ...fresh, THREADS_ACCESS_TOKEN: replacement, THREADS_USER_ID: userId });
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(replacement);
    expect((await readAutomationControls()).threads?.paused).toBe(true);
  });

  it("keeps environment ownership and source recovery guidance with the real store", async () => {
    await setAutomationPaused("threads", true);
    const saved = JSON.stringify({ YOUTUBE_CLIENT_SECRET: original.YOUTUBE_CLIENT_SECRET });
    await writeFile(dataPath("credentials.json"), saved);
    vi.stubEnv("THREADS_ACCESS_TOKEN", "synthetic-env-owned");
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.code).toBe("env_owned");
    expect(body.error).toContain("owner replaces credentials at their source");
    expect(JSON.stringify(body)).not.toContain("synthetic-env-owned");
    expect(await readFile(dataPath("credentials.json"), "utf8")).toBe(saved);
    expect(process.env.THREADS_ACCESS_TOKEN).toBe("synthetic-env-owned");
    expect((await readAutomationControls()).threads?.paused).toBe(true);
  });

  it.each([false, true])("orders the actual save and resume at the same lock, save first=%s", async (saveFirst) => {
    await seedPaused();
    if (saveFirst) validConnection();
    const held = deferred();
    const release = deferred();
    const holding = withAutomationControlsLock(async () => { held.resolve(); await release.promise; });
    await held.promise;
    let saving: Promise<Response>;
    let resuming: ReturnType<typeof setAutomationPaused>;
    try {
      if (saveFirst) {
        saving = POST(request());
        // Let Request.json resolve and enqueue the real guarded save.
        await setImmediate();
        resuming = setAutomationPaused("threads", false);
      } else {
        resuming = setAutomationPaused("threads", false);
        saving = POST(request());
      }
    } finally {
      release.resolve();
    }
    await holding;
    const [response] = await Promise.all([saving!, resuming!]);
    expect(response.status).toBe(saveFirst ? 200 : 409);
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({
      ...original, ...(saveFirst ? { THREADS_ACCESS_TOKEN: replacement, THREADS_USER_ID: userId } : {})
    });
    expect((await readAutomationControls()).threads?.paused).toBe(false);
  });


  it("rejects the wrong profile or a missing publishing permission and leaves the real stores unchanged", async () => {
    await seedPaused();
    const creds = await readFile(dataPath("credentials.json"), "utf8");
    const controls = await readFile(dataPath("automations", "control.json"), "utf8");
    const queued = JSON.stringify([{ id: "synthetic-untouched", status: "pending" }]);
    await writeFile(dataPath("threads-queue.json"), queued);
    fixtureResponses.push(Response.json({ id: userId, username: "wrong_profile" }));
    const wrong = await POST(request());
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).code).toBe("threads_profile_mismatch");
    fixtureResponses.push(
      Response.json({ id: userId, username: handle }),
      Response.json({ error: { code: 200, message: replacement } }, { status: 403 })
    );
    const refused = await POST(request());
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.code).toBe("threads_publish_permission");
    expect(JSON.stringify(body)).not.toContain(replacement);
    expect(await readFile(dataPath("credentials.json"), "utf8")).toBe(creds);
    expect(await readFile(dataPath("automations", "control.json"), "utf8")).toBe(controls);
    expect(await readFile(dataPath("threads-queue.json"), "utf8")).toBe(queued);
  });

  it("checks existing env-owned authorization read-only and distinguishes expiry", async () => {
    await setAutomationPaused("threads", true);
    vi.stubEnv("THREADS_ACCESS_TOKEN", "synthetic-env-existing-token");
    vi.stubEnv("THREADS_USER_ID", userId);
    const before = await readFile(dataPath("automations", "control.json"), "utf8");
    fixtureResponses.push(Response.json({ error: { code: 190, message: "synthetic-env-existing-token" } }, { status: 400 }));
    const expired = await POST(post({ checkThreads: true }));
    expect(expired.status).toBe(409);
    const body = await expired.json();
    expect(body.threadsConnection).toEqual({ state: "reauth_required" });
    expect(JSON.stringify(body)).not.toContain("synthetic-env-existing-token");
    validConnection();
    const verified = await POST(post({ checkThreads: true }));
    expect((await verified.json()).threadsConnection).toMatchObject({ state: "verified", username: handle });
    expect(await stat(dataPath("credentials.json")).catch(() => null)).toBeNull();
    expect(await readFile(dataPath("automations", "control.json"), "utf8")).toBe(before);
  });

  it("retains a configured Threads ID when removing its credential and refuses profile switching", async () => {
    await seedPaused();
    await saveCredentials({ THREADS_USER_ID: userId });
    const refused = await POST(post({ values: { THREADS_USER_ID: "1000000000002" }, threadsHandle: handle }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe("threads_profile_mismatch");
    const removed = await POST(post({ values: { THREADS_ACCESS_TOKEN: "" } }));
    expect(removed.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({
      YOUTUBE_CLIENT_SECRET: original.YOUTUBE_CLIENT_SECRET, THREADS_USER_ID: userId
    });
  });

  it.each(["", "synthetic malformed lock"])("times out on an abandoned unreadable lock without deleting it: %j", async (rawLock) => {
    await seedPaused();
    const lock = dataPath("automations", "control.json.lock");
    await writeFile(lock, rawLock);
    const credentials = await readFile(dataPath("credentials.json"), "utf8");
    const controls = await readFile(dataPath("automations", "control.json"), "utf8");
    const started = performance.now();
    const response = await POST(request());
    expect(performance.now() - started).toBeLessThan(9_000);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("threads_controls_busy");
    expect(body.error).toContain("owner review");
    expect(body.error).toContain("never remove a live lock");
    expect(await readFile(lock, "utf8")).toBe(rawLock);
    expect(await readFile(dataPath("credentials.json"), "utf8")).toBe(credentials);
    expect(await readFile(dataPath("automations", "control.json"), "utf8")).toBe(controls);
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(original.THREADS_ACCESS_TOKEN);
  }, 12_000);
});
