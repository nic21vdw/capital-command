import { readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { credentialsPresent, forgetCredentials, saveCredentials } from "./credentials";

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
