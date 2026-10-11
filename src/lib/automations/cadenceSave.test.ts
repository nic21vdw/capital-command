import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { saveCadence } from "@/lib/automations/cadenceSave";
import { EnvWriteError, writeEnvValues } from "@/lib/envFile";

async function tempEnv() {
  return path.join(await mkdtemp(path.join(tmpdir(), "cc-cadence-")), ".env");
}

describe("saveCadence", () => {
  it("writes the three keys, keeps every other line and sets the live environment", async () => {
    const file = await tempEnv();
    await writeFile(file, ["# rhythm", "PUBLISH_SHORTS_PER_DAY=2", "YOUTUBE_REFRESH_TOKEN=keep-me", "OTHER=keep"].join("\r\n"), "utf8");
    const env: Record<string, string | undefined> = {};

    await saveCadence({ shortsPerDay: 3, slotTimes: ["09:00", "18:30"], weekendSlotTimes: ["11:00"] }, { file, env });

    const after = await readFile(file, "utf8");
    expect(after).toContain("PUBLISH_SHORTS_PER_DAY=3");
    expect(after).toContain("PUBLISH_SLOT_TIMES=09:00,18:30");
    expect(after).toContain("PUBLISH_WEEKEND_SLOT_TIMES=11:00");
    expect(after).toContain("# rhythm\r\n");
    expect(after).toContain("YOUTUBE_REFRESH_TOKEN=keep-me");
    expect(after).toContain("OTHER=keep");
    expect(env).toEqual({ PUBLISH_SHORTS_PER_DAY: "3", PUBLISH_SLOT_TIMES: "09:00,18:30", PUBLISH_WEEKEND_SLOT_TIMES: "11:00" });
  });

  it("only touches the keys it was given", async () => {
    const file = await tempEnv();
    await writeFile(file, "PUBLISH_SLOT_TIMES=08:00\nPUBLISH_SHORTS_PER_DAY=2\n", "utf8");
    const env: Record<string, string | undefined> = {};
    await saveCadence({ shortsPerDay: 4 }, { file, env });
    expect(await readFile(file, "utf8")).toBe("PUBLISH_SLOT_TIMES=08:00\nPUBLISH_SHORTS_PER_DAY=4\n");
    expect(env).toEqual({ PUBLISH_SHORTS_PER_DAY: "4" });
  });

  it("creates the file when there is no .env", async () => {
    const file = await tempEnv();
    await saveCadence({ shortsPerDay: 5 }, { file, env: {} });
    expect(await readFile(file, "utf8")).toContain("PUBLISH_SHORTS_PER_DAY=5");
  });
});

describe("writeEnvValues failures", () => {
  it("says so plainly and changes nothing when the file cannot be written", async () => {
    const env: Record<string, string | undefined> = { PUBLISH_SHORTS_PER_DAY: "2" };
    const denied = Object.assign(new Error("EROFS"), { code: "EROFS" });
    const failure = writeEnvValues({ PUBLISH_SHORTS_PER_DAY: "4" }, {
      file: "/nowhere/.env",
      read: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      write: async () => { throw denied; },
      env
    });
    await expect(failure).rejects.toBeInstanceOf(EnvWriteError);
    await expect(failure).rejects.toThrow(/could not be saved.*read-only.*Nothing was changed/);
    expect(env.PUBLISH_SHORTS_PER_DAY).toBe("2");
  });

  it("does not write over a file it could not read", async () => {
    let wrote = false;
    await expect(writeEnvValues({ A: "1" }, {
      file: "/x/.env",
      read: async () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); },
      write: async () => { wrote = true; },
      env: {}
    })).rejects.toThrow(/could not be read/);
    expect(wrote).toBe(false);
  });
});
