import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { dataPath } from "@/lib/paths";
import { credentialSources, forgetCredentials, saveCredentials } from "@/lib/publisher/credentials";
import { readAutomationControls, setAutomationPaused, withAutomationControlsLock } from "@/lib/automations/store";

// Real route, credentials store, controls and atomic writes. Only fetch is
// blocked: a recovery save must never contact a provider.
const replacement = "synthetic-route-replacement";
const original = { THREADS_ACCESS_TOKEN: "synthetic-route-current", YOUTUBE_CLIENT_SECRET: "synthetic-unrelated-secret" };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await rm(dataPath("credentials.json"), { recursive: true, force: true });
  await rm(dataPath("automations"), { recursive: true, force: true });
  forgetCredentials();
  for (const name of ["THREADS_ACCESS_TOKEN", "THREADS_USER_ID", "YOUTUBE_CLIENT_SECRET", "TIKTOK_CLIENT_KEY"]) vi.stubEnv(name, "");
  fetchMock = vi.fn(() => { throw new Error("No provider request is permitted"); });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request() {
  return new Request("http://localhost:3100/api/connections", {
    method: "POST", body: JSON.stringify({ values: { THREADS_ACCESS_TOKEN: replacement } })
  });
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
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(replacement);
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({ THREADS_ACCESS_TOKEN: replacement });
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(replacement);
    expect((await readAutomationControls()).threads?.paused).toBe(true);
  });

  it("preserves unrelated fresh disk credentials even when the read cache is older", async () => {
    await seedPaused();
    const fresh = { ...original, YOUTUBE_CLIENT_SECRET: "synthetic-fresh-unrelated", FUTURE_PROVIDER_KEY: " synthetic-future " };
    await writeFile(dataPath("credentials.json"), JSON.stringify(fresh));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({ ...fresh, THREADS_ACCESS_TOKEN: replacement });
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
      ...original, THREADS_ACCESS_TOKEN: saveFirst ? replacement : original.THREADS_ACCESS_TOKEN
    });
    expect((await readAutomationControls()).threads?.paused).toBe(false);
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
