import { mkdir, rm, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAutomationPaused } from "@/lib/automations/store";
import { dataPath } from "@/lib/paths";
import { changesThreadsCredentials, readThreadsCredentialRecovery, withPausedThreadsCredentialChange } from "./credentialRecovery";

beforeEach(async () => { await rm(dataPath("automations"), { recursive: true, force: true }); });

describe("Threads credential recovery guard", () => {
  it("guards both token and account identity edits, including clearing them", () => {
    expect(changesThreadsCredentials(["THREADS_ACCESS_TOKEN"])).toBe(true);
    expect(changesThreadsCredentials(["THREADS_USER_ID", "YOUTUBE_CLIENT_ID"])).toBe(true);
    expect(changesThreadsCredentials(["YOUTUBE_CLIENT_ID"])).toBe(false);
    expect(changesThreadsCredentials([])).toBe(false);
  });

  it("requires an explicit saved pause even when the control file is absent", async () => {
    const work = vi.fn(async () => {});
    await expect(withPausedThreadsCredentialChange(work)).rejects.toMatchObject({ code: "threads_pause_required" });
    expect(work).not.toHaveBeenCalled();
  });

  it("does not mask a failed save or change the saved pause", async () => {
    await setAutomationPaused("threads", true);
    const failure = new Error("synthetic write failure");
    await expect(withPausedThreadsCredentialChange(async () => { throw failure; })).rejects.toBe(failure);
    expect(await readThreadsCredentialRecovery({})).toMatchObject({ control: "paused" });
  });

  it("reports unavailable controls distinctly from an intentional pause", async () => {
    await mkdir(dataPath("automations"), { recursive: true });
    await writeFile(dataPath("automations", "control.json"), "synthetic invalid controls");
    expect(await readThreadsCredentialRecovery({ THREADS_USER_ID: "env", THREADS_ACCESS_TOKEN: "saved" })).toEqual({
      control: "unreadable", tokenSource: "saved", envOwnedFields: ["THREADS_USER_ID"]
    });
  });
});
