import { beforeEach, describe, expect, it, vi } from "vitest";

const runDue = vi.fn();

vi.mock("@/lib/publisher/config", () => ({ publisherConfig: () => ({ enabled: true }) }));
vi.mock("@/lib/publisher/runner", () => ({ runDue }));
vi.mock("@/lib/publisher/queue", () => ({
  publishQueue: () => ({ get: async (id: string) => (id === "a1" ? { id } : undefined) })
}));

const post = async (body?: unknown, id = "a1") => {
  const { POST } = await import("@/app/api/publish/[id]/publish/route");
  return POST(
    new Request(`http://localhost:3000/api/publish/${id}/publish`, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body)
    }),
    { params: Promise.resolve({ id }) }
  );
};

describe("POST /api/publish/:id/publish", () => {
  beforeEach(() => {
    runDue.mockReset();
    runDue.mockResolvedValue({ outcomes: [] });
  });

  it("forces the run only when Publish now says so", async () => {
    await post({ mode: "now" });

    expect(runDue).toHaveBeenCalledWith(expect.any(Date), { itemId: "a1", force: true });
  });

  it.each([
    ["no body", undefined],
    ["an empty object", {}],
    ["an unknown mode", { mode: "everything" }],
    ["a non-string mode", { mode: true }],
    ["a null body", null]
  ])("runs the safe slot mode for %s, never publishing early", async (_label, body) => {
    await post(body);

    expect(runDue).toHaveBeenCalledWith(expect.any(Date), { itemId: "a1", force: false });
  });

  it("never forces the run for a retry - a future slot keeps waiting and nothing else posts early", async () => {
    await post({ mode: "slot" });

    expect(runDue).toHaveBeenCalledWith(expect.any(Date), { itemId: "a1", force: false });
  });

  it("answers 404 for an unknown post without running anything", async () => {
    expect((await post({ mode: "slot" }, "missing")).status).toBe(404);
    expect(runDue).not.toHaveBeenCalled();
  });
});
