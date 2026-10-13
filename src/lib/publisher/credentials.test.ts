import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath, dataRoot } from "@/lib/paths";
import { applyStoredCredentials, credentialSources, credentialsPresent, forgetCredentials, saveCredentials } from "./credentials";

beforeEach(async () => {
  await rm(dataPath("credentials.json"), { force: true });
  forgetCredentials();
  vi.stubEnv("YOUTUBE_CLIENT_ID", "");
  vi.stubEnv("TIKTOK_CLIENT_KEY", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("connection credential saves", () => {
  it("keeps both connection forms when they save together", async () => {
    await Promise.all([
      saveCredentials({ YOUTUBE_CLIENT_ID: " youtube-id " }),
      saveCredentials({ TIKTOK_CLIENT_KEY: "tiktok-key" })
    ]);
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({
      YOUTUBE_CLIENT_ID: "youtube-id",
      TIKTOK_CLIENT_KEY: "tiktok-key"
    });
    forgetCredentials();
    expect(await credentialsPresent(["YOUTUBE_CLIENT_ID", "TIKTOK_CLIENT_KEY"])).toEqual({
      YOUTUBE_CLIENT_ID: true,
      TIKTOK_CLIENT_KEY: true
    });
  });

  it("clears one saved connection without removing another concurrent save", async () => {
    await saveCredentials({ YOUTUBE_CLIENT_ID: "old-id" });
    await Promise.all([
      saveCredentials({ YOUTUBE_CLIENT_ID: "  " }),
      saveCredentials({ TIKTOK_CLIENT_KEY: "new-key" })
    ]);
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({
      TIKTOK_CLIENT_KEY: "new-key"
    });
    expect(process.env.YOUTUBE_CLIENT_ID).toBeUndefined();
    expect(process.env.TIKTOK_CLIENT_KEY).toBe("new-key");
  });
});

describe("where a credential's value comes from", () => {
  it("says .env for a variable the environment sets and the file does not", async () => {
    vi.stubEnv("THREADS_USER_ID", "from-env");
    expect(await credentialSources(["THREADS_USER_ID"])).toEqual({ THREADS_USER_ID: "env" });
  });

  it("says saved for a value Settings wrote, and null for one nobody set", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "");
    await saveCredentials({ SPOTIFY_CLIENT_ID: "spotify-id" });
    expect(await credentialSources(["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"])).toEqual({
      SPOTIFY_CLIENT_ID: "saved",
      SPOTIFY_CLIENT_SECRET: null
    });
  });

  it("keeps saying .env when a saved value exists but the environment won at start", async () => {
    await mkdir(dataRoot(), { recursive: true });
    await writeFile(dataPath("credentials.json"), JSON.stringify({ IG_APP_ID: "old-saved" }), "utf8");
    forgetCredentials();
    vi.stubEnv("IG_APP_ID", "from-env");
    await applyStoredCredentials();
    expect(process.env.IG_APP_ID).toBe("from-env");
    expect(await credentialSources(["IG_APP_ID"])).toEqual({ IG_APP_ID: "env" });
  });
});
