import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { credentialSources, credentialsPresent, saveCredentials } from "@/lib/publisher/credentials";
import { accountIdConfigured } from "@/lib/publisher/accounts";
import { spotifyConnected } from "@/lib/spotify/auth";
import { dataPath } from "@/lib/paths";
import { readAutomationControls, setAutomationPaused, withAutomationControlsLock } from "@/lib/automations/store";

vi.mock("@/lib/publisher/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/credentials")>()),
  credentialsPresent: vi.fn(),
  credentialSources: vi.fn(),
  saveCredentials: vi.fn()
}));
vi.mock("@/lib/publisher/accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publisher/accounts")>()),
  accountIdConfigured: vi.fn()
}));
vi.mock("@/lib/spotify/auth", () => ({
  spotifyConnected: vi.fn(),
  spotifyRedirectUri: (origin: string) => `${origin.replace("localhost", "127.0.0.1")}/api/auth/spotify/callback`
}));

const present = {
  YOUTUBE_CLIENT_ID: true,
  YOUTUBE_CLIENT_SECRET: true,
  TIKTOK_CLIENT_KEY: true,
  TIKTOK_CLIENT_SECRET: true,
  SPOTIFY_CLIENT_ID: true,
  SPOTIFY_CLIENT_SECRET: true
};

describe("account setup status", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(dataPath("automations"), { recursive: true, force: true });
    vi.mocked(credentialsPresent).mockResolvedValue(present);
    vi.mocked(accountIdConfigured).mockResolvedValue(false);
    vi.mocked(spotifyConnected).mockResolvedValue(false);
    vi.mocked(credentialSources).mockResolvedValue({});
    vi.mocked(saveCredentials).mockResolvedValue();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("keeps saved app credentials separate from completed sign-in", async () => {
    const response = await GET(new Request("http://localhost:3000/api/connections"));
    expect(await response.json()).toMatchObject({
      present,
      connected: { youtube: false, tiktok: false, spotify: false }
    });
  });

  it("gives the exact redirect URI to register for each sign-in", async () => {
    vi.stubEnv("TIKTOK_REDIRECT_URI", "");
    const body = await (await GET(new Request("http://localhost:3000/api/connections"))).json();
    expect(body.redirectUris).toEqual({
      youtube: "http://localhost:3000/api/auth/google/callback",
      tiktok: "http://localhost:3000/api/auth/tiktok/callback",
      // Spotify refuses localhost, so the address to register is the loopback IP.
      spotify: "http://127.0.0.1:3000/api/auth/spotify/callback"
    });
    vi.unstubAllEnvs();
  });

  it("reports where each value comes from", async () => {
    vi.mocked(credentialSources).mockResolvedValue({ YOUTUBE_CLIENT_ID: "env", YOUTUBE_CLIENT_SECRET: "saved" });
    const body = await (await GET(new Request("http://localhost:3000/api/connections"))).json();
    expect(body.sources).toEqual({ YOUTUBE_CLIENT_ID: "env", YOUTUBE_CLIENT_SECRET: "saved" });
  });

  it("refuses to save a value .env sets, because .env wins on the next restart", async () => {
    vi.mocked(credentialSources).mockResolvedValue({ YOUTUBE_CLIENT_ID: "env" });
    const response = await POST(new Request("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ values: { YOUTUBE_CLIENT_ID: "new-id" } })
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("set in .env");
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("no longer accepts the unused YouTube API key", async () => {
    const response = await POST(new Request("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ values: { YOUTUBE_API_KEY: "key" } })
    }));
    expect(response.status).toBe(400);
  });

  it("returns refreshed connection status after saving", async () => {
    vi.mocked(accountIdConfigured).mockImplementation(async (platform) => platform === "youtube");
    const response = await POST(new Request("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ values: { YOUTUBE_CLIENT_ID: "new-id" } })
    }));
    expect(response.status).toBe(200);
    expect(saveCredentials).toHaveBeenCalledWith({ YOUTUBE_CLIENT_ID: "new-id" });
    expect((await response.json()).connected).toEqual({ youtube: true, tiktok: false, spotify: false });
  });
});

function saveRequest(values: Record<string, string>) {
  return new Request("http://localhost:3100/api/connections", {
    method: "POST", body: JSON.stringify({ values })
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Threads credential recovery", () => {
  const fixtureToken = "synthetic-replacement-never-a-provider-token";
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(credentialsPresent).mockResolvedValue({ THREADS_ACCESS_TOKEN: true });
    vi.mocked(credentialSources).mockResolvedValue({ THREADS_ACCESS_TOKEN: "saved" });
    vi.mocked(accountIdConfigured).mockResolvedValue(false);
    vi.mocked(spotifyConnected).mockResolvedValue(false);
    vi.mocked(saveCredentials).mockResolvedValue();
    await rm(dataPath("automations"), { recursive: true, force: true });
    fetchMock = vi.fn(() => { throw new Error("Provider requests are forbidden in recovery"); });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports presence, credential source and explicit pause state without testing a token", async () => {
    vi.mocked(credentialSources).mockResolvedValue({ THREADS_ACCESS_TOKEN: "env" });
    const body = await (await GET(new Request("http://localhost:3100/api/connections"))).json();
    expect(body.threadsRecovery).toEqual({ control: "running", tokenSource: "env", envOwnedFields: ["THREADS_ACCESS_TOKEN"] });
    expect(JSON.stringify(body)).not.toContain(fixtureToken);
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it.each([{}, { threads: { paused: false, changedAt: null } }, { publisher: { paused: true, changedAt: null } }])(
    "refuses a save without an explicit Threads pause: %j", async (controls) => {
      await mkdir(dataPath("automations"), { recursive: true });
      await writeFile(dataPath("automations", "control.json"), JSON.stringify(controls));
      const response = await POST(saveRequest({ THREADS_ACCESS_TOKEN: fixtureToken, YOUTUBE_CLIENT_ID: "synthetic-id" }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "threads_pause_required", threadsRecovery: { control: "running" } });
      expect(saveCredentials).not.toHaveBeenCalled();
      expect(await readAutomationControls()).toEqual(controls);
    }
  );

  it.each(["not JSON", '{"threads":{"paused":"true","changedAt":null}}'])("refuses unreadable controls without treating failure as a saved pause: %s", async (raw) => {
    await mkdir(dataPath("automations"), { recursive: true });
    await writeFile(dataPath("automations", "control.json"), raw);
    const response = await POST(saveRequest({ THREADS_USER_ID: "synthetic-user" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "threads_controls_unavailable", threadsRecovery: { control: "unreadable" } });
    expect(saveCredentials).not.toHaveBeenCalled();
    expect(await readFile(dataPath("automations", "control.json"), "utf8")).toBe(raw);
  });

  it("refuses a filesystem read failure without treating it as a saved pause", async () => {
    await mkdir(dataPath("automations", "control.json"), { recursive: true });
    const response = await POST(saveRequest({ THREADS_ACCESS_TOKEN: fixtureToken }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "threads_controls_unavailable", threadsRecovery: { control: "unreadable" } });
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("saves while paused without resuming, retrying or changing the queue", async () => {
    await setAutomationPaused("threads", true);
    const controls = await readFile(dataPath("automations", "control.json"), "utf8");
    const queue = JSON.stringify([{ id: "synthetic-row", status: "pending", attempts: 0 }]);
    await writeFile(dataPath("threads-queue.json"), queue);
    const response = await POST(saveRequest({ THREADS_ACCESS_TOKEN: fixtureToken }));
    expect(response.status).toBe(200);
    expect(saveCredentials).toHaveBeenCalledExactlyOnceWith({ THREADS_ACCESS_TOKEN: fixtureToken }, { strict: true });
    const body = await response.json();
    expect(body.threadsRecovery.control).toBe("paused");
    expect(JSON.stringify(body)).not.toContain(fixtureToken);
    expect(await readFile(dataPath("automations", "control.json"), "utf8")).toBe(controls);
    expect(await readFile(dataPath("threads-queue.json"), "utf8")).toBe(queue);
  });

  it("preserves environment ownership and gives source recovery guidance even while paused", async () => {
    await setAutomationPaused("threads", true);
    vi.mocked(credentialSources).mockResolvedValue({ THREADS_ACCESS_TOKEN: "env" });
    const response = await POST(saveRequest({ THREADS_ACCESS_TOKEN: fixtureToken }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("env_owned");
    expect(body.error).toContain("owner replaces credentials at their source");
    expect(body.error).toContain("Keep Threads paused");
    expect(body.threadsRecovery).toMatchObject({ tokenSource: "env", control: "paused" });
    expect(JSON.stringify(body)).not.toContain(fixtureToken);
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("still saves other platforms when Threads controls are unreadable", async () => {
    await mkdir(dataPath("automations"), { recursive: true });
    await writeFile(dataPath("automations", "control.json"), "broken controls");
    const response = await POST(saveRequest({ YOUTUBE_CLIENT_ID: "synthetic-id" }));
    expect(response.status).toBe(200);
    expect(saveCredentials).toHaveBeenCalledExactlyOnceWith({ YOUTUBE_CLIENT_ID: "synthetic-id" });
  });

  it("holds a concurrent explicit resume until the credential write completes", async () => {
    await setAutomationPaused("threads", true);
    const started = deferred();
    const finish = deferred();
    vi.mocked(saveCredentials).mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      expect((await readAutomationControls()).threads?.paused).toBe(true);
    });
    const saving = POST(saveRequest({ THREADS_ACCESS_TOKEN: fixtureToken }));
    await started.promise;
    let resumed = false;
    const resuming = setAutomationPaused("threads", false).then(() => { resumed = true; });
    try {
      await new Promise((done) => setTimeout(done, 25));
      expect(resumed).toBe(false);
      expect((await readAutomationControls()).threads?.paused).toBe(true);
    } finally {
      finish.resolve();
    }
    expect((await saving).status).toBe(200);
    await resuming;
    expect((await readAutomationControls()).threads?.paused).toBe(false);
  });

  it("refuses a save if a queued resume wins the control lock first", async () => {
    await setAutomationPaused("threads", true);
    const held = deferred();
    const release = deferred();
    const holding = withAutomationControlsLock(async () => { held.resolve(); await release.promise; });
    await held.promise;
    const resuming = setAutomationPaused("threads", false);
    const saving = POST(saveRequest({ THREADS_ACCESS_TOKEN: fixtureToken }));
    release.resolve();
    await holding;
    await resuming;
    const response = await saving;
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("threads_pause_required");
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("does not echo or log values or raw errors when a write fails", async () => {
    await setAutomationPaused("threads", true);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(saveCredentials).mockRejectedValueOnce(new Error(`Write failed with ${fixtureToken}`));
    const response = await POST(saveRequest({ THREADS_ACCESS_TOKEN: fixtureToken }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(fixtureToken);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
    expect((await readAutomationControls()).threads?.paused).toBe(true);
  });
});
