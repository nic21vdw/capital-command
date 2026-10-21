import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { CredentialStoreReadError, credentialSources, credentialsPresent, forgetCredentials, saveCredentials } from "./credentials";

const token = "synthetic-strict-replacement";
const original = { YOUTUBE_CLIENT_SECRET: "synthetic-unrelated", THREADS_ACCESS_TOKEN: "synthetic-current" };

beforeEach(async () => {
  await rm(dataPath("credentials.json"), { recursive: true, force: true });
  forgetCredentials();
  for (const name of ["THREADS_ACCESS_TOKEN", "YOUTUBE_CLIENT_SECRET", "TIKTOK_CLIENT_KEY"]) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("strict recovery credential saves", () => {
  it("initializes an absent store and updates disk, cache and environment after saving", async () => {
    await saveCredentials({ THREADS_ACCESS_TOKEN: ` ${token} ` }, { strict: true });
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({ THREADS_ACCESS_TOKEN: token });
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(token);
    expect(await credentialSources(["THREADS_ACCESS_TOKEN"])).toEqual({ THREADS_ACCESS_TOKEN: "saved" });
  });

  it.each([
    '{"YOUTUBE_CLIENT_SECRET":"synthetic-unrelated"',
    "null", "[]", '"not an object"',
    '{"YOUTUBE_CLIENT_SECRET":null}', '{"YOUTUBE_CLIENT_SECRET":17}',
    '{"YOUTUBE_CLIENT_SECRET":{"nested":"synthetic-unrelated"}}',
    '{"YOUTUBE_CLIENT_SECRET":" "}'
  ])("preserves disk, environment and an existing cache when fresh validation refuses %s", async (raw) => {
    await saveCredentials(original);
    await writeFile(dataPath("credentials.json"), raw);
    await expect(saveCredentials({ THREADS_ACCESS_TOKEN: token }, { strict: true })).rejects.toBeInstanceOf(CredentialStoreReadError);
    expect(await readFile(dataPath("credentials.json"), "utf8")).toBe(raw);
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(original.THREADS_ACCESS_TOKEN);
    expect(process.env.YOUTUBE_CLIENT_SECRET).toBe(original.YOUTUBE_CLIENT_SECRET);
    // A saved source proves the failed strict read did not discard the prior
    // cache or replace it with the tolerant loader's empty fallback.
    expect(await credentialSources(["THREADS_ACCESS_TOKEN", "YOUTUBE_CLIENT_SECRET"])).toEqual({
      THREADS_ACCESS_TOKEN: "saved", YOUTUBE_CLIENT_SECRET: "saved"
    });
  });

  it("preserves the cached store and environment on a real filesystem read failure", async () => {
    await saveCredentials(original);
    await rm(dataPath("credentials.json"));
    await mkdir(dataPath("credentials.json"));
    await expect(saveCredentials({ THREADS_ACCESS_TOKEN: token }, { strict: true })).rejects.toBeInstanceOf(CredentialStoreReadError);
    expect(process.env.THREADS_ACCESS_TOKEN).toBe(original.THREADS_ACCESS_TOKEN);
    expect(await credentialsPresent(["YOUTUBE_CLIENT_SECRET"])).toEqual({ YOUTUBE_CLIENT_SECRET: true });
    expect(await readFile(dataPath("credentials.json"), "utf8").catch(() => "still unreadable")).toBe("still unreadable");
  });

  it("uses fresh disk contents instead of a primed cache and preserves unrelated strings exactly", async () => {
    await saveCredentials(original);
    const fresh = { ...original, YOUTUBE_CLIENT_SECRET: " synthetic-new-unrelated ", FUTURE_PROVIDER_KEY: "synthetic-future" };
    await writeFile(dataPath("credentials.json"), JSON.stringify(fresh));
    await saveCredentials({ THREADS_ACCESS_TOKEN: token }, { strict: true });
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({ ...fresh, THREADS_ACCESS_TOKEN: token });
  });

  it.each([false, true])("preserves other connection saves in either queue order, strict first=%s", async (strictFirst) => {
    await saveCredentials(original);
    const strict = () => saveCredentials({ THREADS_ACCESS_TOKEN: token }, { strict: true });
    const compatible = () => saveCredentials({ TIKTOK_CLIENT_KEY: "synthetic-tiktok" });
    await Promise.all(strictFirst ? [strict(), compatible()] : [compatible(), strict()]);
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({
      ...original, THREADS_ACCESS_TOKEN: token, TIKTOK_CLIENT_KEY: "synthetic-tiktok"
    });
  });

  it("does not poison the save queue after a refused store is repaired by its owner", async () => {
    await writeFile(dataPath("credentials.json"), "synthetic malformed store");
    await expect(saveCredentials({ THREADS_ACCESS_TOKEN: token }, { strict: true })).rejects.toBeInstanceOf(CredentialStoreReadError);
    await writeFile(dataPath("credentials.json"), JSON.stringify(original));
    await saveCredentials({ THREADS_ACCESS_TOKEN: token }, { strict: true });
    expect(JSON.parse(await readFile(dataPath("credentials.json"), "utf8"))).toEqual({ ...original, THREADS_ACCESS_TOKEN: token });
  });
});
