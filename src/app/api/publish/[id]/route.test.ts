import { beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn();
const updateYoutubeVideoTitle = vi.fn();
let stored: Record<string, unknown>;

vi.mock("@/lib/publisher/config", () => ({ publisherConfig: () => ({ enabled: true }) }));
vi.mock("@/lib/publisher/adapters/youtube", () => ({ updateYoutubeVideoTitle }));
vi.mock("@/lib/publisher/queue", () => ({
  publishQueue: () => ({ get: async (id: string) => (id === "a1" ? stored : undefined), add })
}));

const patch = async (body: unknown, id = "a1") => {
  const { PATCH } = await import("@/app/api/publish/[id]/route");
  return PATCH(new Request(`http://localhost:3000/api/publish/${id}`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id })
  });
};

describe("PATCH /api/publish/:id", () => {
  beforeEach(() => {
    add.mockReset();
    updateYoutubeVideoTitle.mockReset();
    stored = {
      id: "a1",
      title: "Old title",
      caption: "Old caption",
      hashtags: ["#old"],
      platforms: { youtube: { status: "scheduled", postId: "yt1" } }
    };
  });

  it("replaces the caption and hashtags without renaming on YouTube", async () => {
    const response = await patch({ caption: "  New caption ", hashtags: ["#new"] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.youtube).toBe("local");
    expect(stored).toMatchObject({ title: "Old title", caption: "New caption", hashtags: ["#new"] });
    expect(add).toHaveBeenCalledWith(stored, "api-publish-edit");
    expect(updateYoutubeVideoTitle).not.toHaveBeenCalled();
  });

  it("still renames on YouTube when the title changes", async () => {
    const response = await patch({ title: "New title" });

    expect((await response.json()).youtube).toBe("updated");
    expect(add).toHaveBeenCalledWith(stored, "api-publish-rename");
    expect(updateYoutubeVideoTitle).toHaveBeenCalledWith("yt1", "New title", undefined);
  });

  it("skips the YouTube call when the title is resent unchanged", async () => {
    await patch({ title: "Old title", caption: "New caption" });

    expect(updateYoutubeVideoTitle).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(stored, "api-publish-edit");
  });

  it("rejects an empty caption and a body with nothing to change", async () => {
    expect((await patch({ caption: " " })).status).toBe(400);
    expect((await patch({ hashtags: [1] })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown post", async () => {
    expect((await patch({ caption: "x" }, "missing")).status).toBe(404);
  });
});
