import { beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn();
const remove = vi.fn();
const updateYoutubeVideoTitle = vi.fn();
const holdYoutubeVideoPrivate = vi.fn();
let stored: Record<string, unknown>;

vi.mock("@/lib/publisher/config", () => ({ publisherConfig: () => ({ enabled: true, claimTimeoutMinutes: 15 }) }));
vi.mock("@/lib/publisher/adapters/youtube", () => ({ updateYoutubeVideoTitle, holdYoutubeVideoPrivate }));
vi.mock("@/lib/publisher/queue", () => ({
  publishQueue: () => ({ get: async (id: string) => (id === "a1" ? stored : undefined), add, remove })
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

  it.each([null, false, 42, "caption", []])("rejects a non-object JSON body: %j", async (body) => {
    expect((await patch(body)).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
    expect(updateYoutubeVideoTitle).not.toHaveBeenCalled();
  });
});

const del = async (query = "", id = "a1") => {
  const { DELETE } = await import("@/app/api/publish/[id]/route");
  return DELETE(new Request(`http://localhost:3000/api/publish/${id}${query}`, { method: "DELETE" }), {
    params: Promise.resolve({ id })
  });
};

describe("DELETE /api/publish/:id", () => {
  beforeEach(() => {
    remove.mockReset();
    remove.mockResolvedValue(true);
    holdYoutubeVideoPrivate.mockReset();
    stored = {
      id: "a1",
      title: "A title",
      accountId: "acct-2",
      platforms: { youtube: { status: "scheduled", postId: "yt1", attempts: 0 }, instagram: { status: "pending", attempts: 0 } }
    };
  });

  it("keeps a video YouTube already holds private instead of leaving it to go live, then removes the post", async () => {
    holdYoutubeVideoPrivate.mockResolvedValue("held");

    const response = await del();
    const body = await response.json();

    expect(holdYoutubeVideoPrivate).toHaveBeenCalledWith("yt1", "acct-2");
    expect(remove).toHaveBeenCalledWith("a1", "api-publish-delete");
    expect(body).toMatchObject({ removed: true, youtube: "held", youtubeVideoId: "yt1" });
  });

  it("reports a video that is already public rather than pretending it was cancelled", async () => {
    holdYoutubeVideoPrivate.mockResolvedValue("already-public");

    expect((await (await del()).json()).youtube).toBe("already-public");
    expect(remove).toHaveBeenCalled();
  });

  it("does not remove the post when YouTube could not be told, because it would still go live", async () => {
    holdYoutubeVideoPrivate.mockRejectedValue(new Error("YouTube connection expired"));

    const response = await del();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe("youtube-hold-failed");
    expect(body.error).toContain("still go live");
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes it anyway when asked to, and says YouTube was not told", async () => {
    holdYoutubeVideoPrivate.mockRejectedValue(new Error("YouTube connection expired"));

    const body = await (await del("?anyway=1")).json();

    expect(remove).toHaveBeenCalled();
    expect(body).toMatchObject({ removed: true, youtube: "unchecked" });
  });

  it("leaves YouTube alone when it holds nothing, and flags a Facebook post it cannot cancel", async () => {
    stored = {
      id: "a1",
      platforms: { youtube: { status: "pending", attempts: 0 }, facebook: { status: "scheduled", postId: "fb1", attempts: 0 } }
    };

    const body = await (await del()).json();

    expect(holdYoutubeVideoPrivate).not.toHaveBeenCalled();
    expect(body).toMatchObject({ removed: true, youtube: "none", facebookPostId: "fb1" });
  });

  describe("while an upload may be in flight", () => {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

    it("refuses with 409 when a leg has a fresh claim, and removes nothing", async () => {
      stored = {
        id: "a1",
        platforms: { instagram: { status: "pending", attempts: 0, claimedAt: minutesAgo(2) } }
      };

      const response = await del();
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body).toMatchObject({
        code: "uploading",
        error: "This post is uploading right now - try again in a minute."
      });
      expect(remove).not.toHaveBeenCalled();
      expect(holdYoutubeVideoPrivate).not.toHaveBeenCalled();
    });

    it("treats a claim older than the claim timeout as abandoned", async () => {
      stored = {
        id: "a1",
        platforms: { instagram: { status: "pending", attempts: 0, claimedAt: minutesAgo(16) } }
      };

      expect((await del()).status).toBe(200);
      expect(remove).toHaveBeenCalled();
    });

    it("removes it anyway with ?anyway=1", async () => {
      stored = {
        id: "a1",
        platforms: { instagram: { status: "pending", attempts: 0, claimedAt: minutesAgo(2) } }
      };

      expect((await del("?anyway=1")).status).toBe(200);
      expect(remove).toHaveBeenCalled();
    });

    it("asks for confirmation when a YouTube upload session exists but no video id came back", async () => {
      stored = {
        id: "a1",
        platforms: { youtube: { status: "pending", attempts: 1, containerId: "https://upload.example/session" } }
      };

      const response = await del();
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.code).toBe("youtube-may-exist");
      expect(body.error).toContain("may already exist on YouTube");
      expect(body.error).toContain("YouTube Studio");
      expect(remove).not.toHaveBeenCalled();
    });

    it("removes it with ?anyway=1 and says a video may exist", async () => {
      stored = {
        id: "a1",
        platforms: { youtube: { status: "failed", attempts: 3, containerId: "https://upload.example/session" } }
      };

      const body = await (await del("?anyway=1")).json();

      expect(remove).toHaveBeenCalled();
      expect(body).toMatchObject({ removed: true, youtube: "none", youtubeMayExist: true });
    });

    it("does not stop a YouTube leg that has its video id: that one is held private as before", async () => {
      holdYoutubeVideoPrivate.mockResolvedValue("held");
      stored = {
        id: "a1",
        platforms: { youtube: { status: "scheduled", attempts: 0, postId: "yt1", containerId: "https://upload.example/session" } }
      };

      const response = await del();

      expect(response.status).toBe(200);
      expect(holdYoutubeVideoPrivate).toHaveBeenCalledWith("yt1", undefined);
    });
  });

  it("answers 404 for an unknown post", async () => {
    expect((await del("", "missing")).status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
  });
});
