import { stat } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { experimentsFile, updateExperiments } from "@/lib/experiments/store";
import { experiment, variant } from "@/lib/experiments/test-helpers";

vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({
  enabled: true,
  createExperiment: vi.fn(),
  ensureVerticalClipFile: vi.fn(async (_jobId: string, file: string) => file)
}));

vi.mock("@/lib/publisher/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publisher/config")>();
  return { ...actual, publisherConfig: () => ({ ...actual.publisherConfig(), enabled: state.enabled }) };
});
vi.mock("@/lib/clipping/jobs", () => ({
  ensureVerticalClipFile: state.ensureVerticalClipFile,
  outputDir: (jobId: string) => path.resolve("/jobs", jobId)
}));
vi.mock("@/lib/experiments/create", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experiments/create")>();
  return { ...actual, createExperiment: state.createExperiment };
});

const body = {
  kind: "title",
  jobId: "job1",
  file: "clip.mp4",
  clipId: "clip1",
  baseTitle: "Agents Are Eating Software",
  baseCaption: "Body.",
  hashtags: ["#AI"],
  variants: [
    { value: "Agents Are Eating Software", origin: "original" },
    { value: "Why Every App Needs An Agent Now", origin: "ai" }
  ],
  platforms: ["youtube", "instagram"]
};

function post(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3100/api/experiments", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3100", host: "localhost:3100", ...headers },
    body: JSON.stringify(payload)
  });
}

beforeEach(() => {
  state.enabled = true;
  state.createExperiment.mockReset();
  state.ensureVerticalClipFile.mockClear();
});

describe("GET /api/experiments", () => {
  it("answers with an empty list and creates no file when no experiment was ever started", async () => {
    const { GET } = await import("@/app/api/experiments/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ experiments: [] });
    expect(state.createExperiment).not.toHaveBeenCalled();
    await expect(stat(experimentsFile())).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("lists what is in data/experiments.json with its status", async () => {
    await updateExperiments((file) => {
      file.experiments.push(
        experiment([variant("A", [{ itemId: "x1", publishAt: "2999-01-01T12:00:00.000Z" }]), variant("B", [{ itemId: "x2", publishAt: "2999-01-04T12:00:00.000Z" }])], { id: "listed" })
      );
    });
    const { GET } = await import("@/app/api/experiments/route");
    const payload = await (await GET()).json();
    expect(payload.experiments).toHaveLength(1);
    expect(payload.experiments[0]).toMatchObject({ id: "listed", kind: "title" });
    expect(["running", "inconclusive"]).toContain(payload.experiments[0].status);
    expect(state.createExperiment).not.toHaveBeenCalled();
  });
});

describe("POST /api/experiments", () => {
  it("starts an experiment from the clip's rendered file and says what was booked", async () => {
    state.createExperiment.mockResolvedValueOnce({
      experiment: experiment([variant("A", [{ itemId: "i1", publishAt: "2026-10-14T11:30:00.000Z" }]), variant("B", [{ itemId: "i2", publishAt: "2026-10-16T11:30:00.000Z" }])]),
      items: [
        { id: "i1", publishAt: "2026-10-14T11:30:00.000Z", platforms: { youtube: { status: "pending", attempts: 0 } } },
        { id: "i2", publishAt: "2026-10-16T11:30:00.000Z", platforms: { youtube: { status: "pending", attempts: 0 } } }
      ]
    });
    const { POST } = await import("@/app/api/experiments/route");
    const response = await POST(post(body));
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.experiment.id).toBe("exp1");
    expect(payload.booked).toEqual([
      { id: "i1", publishAt: "2026-10-14T11:30:00.000Z", platforms: ["youtube"] },
      { id: "i2", publishAt: "2026-10-16T11:30:00.000Z", platforms: ["youtube"] }
    ]);
    const input = state.createExperiment.mock.calls[0][0];
    expect(input).toMatchObject({ kind: "title", jobId: "job1", clipId: "clip1", file: "clip.mp4", platforms: ["youtube", "instagram"], sourceLabel: "Agents Are Eating Software" });
    expect(input.clipPath).toBe(path.resolve("/jobs/job1", "clip.mp4"));
    expect(state.ensureVerticalClipFile).toHaveBeenCalledWith("job1", "clip.mp4");
  });

  it("refuses a file name that points outside the job's folder", async () => {
    const { POST } = await import("@/app/api/experiments/route");
    const response = await POST(post({ ...body, file: "../../secrets.mp4" }));
    expect(response.status).toBe(400);
    expect(state.createExperiment).not.toHaveBeenCalled();
  });

  it("refuses a request that is not shaped like an experiment, and books nothing", async () => {
    const { POST } = await import("@/app/api/experiments/route");
    for (const bad of [{}, { ...body, variants: "A,B" }, { ...body, platforms: ["myspace"] }, { ...body, kind: "colour" }, { ...body, baseTitle: "" }]) {
      const response = await POST(post(bad));
      expect(response.status).toBe(400);
    }
    expect(state.createExperiment).not.toHaveBeenCalled();
  });

  it("refuses a request from another site", async () => {
    const { POST } = await import("@/app/api/experiments/route");
    const response = await POST(post(body, { origin: "https://attacker.invalid" }));
    expect(response.status).toBe(403);
    expect(state.createExperiment).not.toHaveBeenCalled();
  });

  it("says posting is off instead of booking", async () => {
    state.enabled = false;
    const { POST } = await import("@/app/api/experiments/route");
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/off|Settings/i);
    expect(state.createExperiment).not.toHaveBeenCalled();
  });

  it("passes on the reason an experiment was refused", async () => {
    const { ExperimentInputError } = await import("@/lib/experiments/create");
    state.createExperiment.mockRejectedValueOnce(new ExperimentInputError("That clip is already scheduled."));
    const { POST } = await import("@/app/api/experiments/route");
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That clip is already scheduled." });
  });
});
