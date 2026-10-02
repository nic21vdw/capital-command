import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import type { OutputQuality } from "@/lib/pipeline/outputQuality";

const state = vi.hoisted(() => ({ quality: { resolution: "source", frameRate: "source" } as OutputQuality }));
vi.mock("@/lib/storage/store", () => ({
  readAppData: async () => ({ settings: { outputQuality: state.quality } })
}));
// Stop before any download. The job record and persistence below are real.
vi.mock("@/lib/clipping/download", () => ({
  fetchVideoMeta: async () => { throw new Error("Offline fixture: no download"); },
  downloadAudio: async () => { throw new Error("Offline fixture: no download"); },
  downloadSection: async () => { throw new Error("Offline fixture: no download"); }
}));

const { createJobFromUrl } = await import("./jobs");

describe("a clip job owns its chosen quality", () => {
  it("retains an explicit pipeline choice despite different global preferences", async () => {
    state.quality = { resolution: "720", frameRate: "24" };
    const job = await createJobFromUrl("https://example.com/fixture", undefined, 1, false, {
      output: { resolution: "2160", frameRate: "source" }
    });
    await vi.waitFor(() => expect(job.status).toBe("error"));
    expect(job.output).toEqual({ resolution: "2160", frameRate: "source" });
    const persisted = JSON.parse(await readFile(dataPath("clips", "jobs.json"), "utf8"));
    expect(persisted.find((entry: { id: string }) => entry.id === job.id).output).toEqual(job.output);
  });

  it("snapshots the current preference for a standalone job", async () => {
    state.quality = { resolution: "source", frameRate: "60" };
    const job = await createJobFromUrl("https://example.com/fixture", undefined, 1);
    state.quality = { resolution: "720", frameRate: "24" };
    await vi.waitFor(() => expect(job.status).toBe("error"));
    expect(job.output).toEqual({ resolution: "source", frameRate: "60" });
  });
});
