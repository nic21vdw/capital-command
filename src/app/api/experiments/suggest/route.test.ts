import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getJob: vi.fn(),
  suggestVariants: vi.fn()
}));

vi.mock("@/lib/clipping/jobs", () => ({ getJob: state.getJob }));
vi.mock("@/lib/experiments/suggest", () => ({ suggestVariants: state.suggestVariants }));

const job = {
  id: "job1",
  sourceCaptions: [
    { id: "c1", start: 0, end: 5, text: "Agents never sleep.", words: [] },
    { id: "c2", start: 5, end: 10, text: "That changes everything.", words: [] },
    { id: "c3", start: 50, end: 55, text: "Unrelated.", words: [] }
  ],
  clips: [{ id: "clip1", start: 0, end: 10, title: "Agents" }]
};

function post(payload: unknown) {
  return new NextRequest("http://localhost:3100/api/experiments/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3100", host: "localhost:3100" },
    body: JSON.stringify(payload)
  });
}

beforeEach(() => {
  state.getJob.mockReset();
  state.suggestVariants.mockReset();
  state.getJob.mockResolvedValue(job);
});

describe("POST /api/experiments/suggest", () => {
  it("asks for alternatives to the current text, using only what the clip says", async () => {
    state.suggestVariants.mockResolvedValueOnce(["Why Every App Needs An Agent Now"]);
    const { POST } = await import("@/app/api/experiments/suggest/route");
    const response = await POST(post({ jobId: "job1", clipId: "clip1", kind: "title", base: "Agents Are Eating Software", count: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ variants: ["Why Every App Needs An Agent Now"] });
    const request = state.suggestVariants.mock.calls[0][0];
    expect(request).toMatchObject({ kind: "title", base: "Agents Are Eating Software", count: 2 });
    expect(request.transcript).toContain("Agents never sleep.");
    expect(request.transcript).not.toContain("Unrelated.");
  });

  it("says the variants have to be typed when no model answers", async () => {
    state.suggestVariants.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/experiments/suggest/route");
    const response = await POST(post({ jobId: "job1", clipId: "clip1", kind: "hook", base: "Nobody tells you this.", count: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ variants: null, note: expect.stringMatching(/type/i) });
  });

  it("is a 404 for a clip job that no longer exists and a 400 for a bad request", async () => {
    const { POST } = await import("@/app/api/experiments/suggest/route");
    state.getJob.mockResolvedValueOnce(undefined);
    expect((await POST(post({ jobId: "gone", clipId: "clip1", kind: "title", base: "Base Title Words", count: 2 }))).status).toBe(404);
    expect((await POST(post({ jobId: "job1", kind: "colour" }))).status).toBe(400);
    expect(state.suggestVariants).not.toHaveBeenCalled();
  });
});
