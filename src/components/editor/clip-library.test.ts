import { afterEach, describe, expect, it, vi } from "vitest";
import { clipProjectSchema } from "@/lib/storage/schemas";
import { clipProjectReadKey, currentClipProjectDetail, loadClipLibrary, loadFullClipProject, selectClipProject } from "./clip-library";
import { ClipProjectPersistence, afterConfirmedSave } from "./project-persistence";

const job = {
  id: "job-1", fileName: "A stream", createdAt: "2026-10-14T14:00:00.000Z", status: "done",
  clips: [{ id: "clip-1", start: 1, end: 5, file: "clip.mp4" }]
};
const project = clipProjectSchema.parse({
  id: "project-1", jobId: "job-1", sourceFile: "clip.mp4", name: "My saved edit",
  createdAt: "2026-10-14T14:00:00.000Z", updatedAt: "2026-10-14T14:30:00.000Z",
  captions: [{ id: "caption-1", start: 1, end: 2, text: "My hand edited words", words: [], enabled: true }]
});

afterEach(() => vi.unstubAllGlobals());

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

describe("Clip Editor library reads", () => {
  it("distinguishes a failed read from a valid empty library and allows a fresh retry", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ error: "Unavailable" }, 503))
      .mockResolvedValueOnce(response({ jobs: [] }))
      .mockResolvedValueOnce(response({ jobs: [job] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadClipLibrary()).rejects.toThrow("HTTP 503");
    await expect(loadClipLibrary()).resolves.toEqual([]);
    await expect(loadClipLibrary()).resolves.toEqual([job]);
  });

  it.each([{}, { jobs: null }, { jobs: [null] }, { jobs: [{ ...job, clips: null }] },
    { jobs: [{ ...job, clips: [{ id: "clip-1", start: "1", end: 5 }] }] }])(
    "rejects malformed success responses instead of replacing the usable library: %j", async (value) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(value)));
      await expect(loadClipLibrary()).rejects.toThrow(/incomplete/i);
    }
  );

  it("propagates a transport failure for the persistent recovery notice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(loadClipLibrary()).rejects.toThrow("Failed to fetch");
  });

  it("passes cancellation through to the bounded read", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason)));
    }));
    const request = loadClipLibrary(controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(signal?.aborted).toBe(true);
  });
});

describe("Clip Editor full project reads", () => {
  it("reloads a newer recovery draft as unsaved and blocks leaving until persistence confirms it", async () => {
    const draft = { ...project, updatedAt: "2026-10-14T15:00:00.000Z", name: "Recovered local edit" };
    const recovered = selectClipProject({ ...project, captionsOmitted: true, captions: [] }, draft, false);
    expect(recovered).toEqual({ project: draft, confirmed: false });
    const mutate = vi.fn().mockRejectedValueOnce(new Error("HTTP 500")).mockResolvedValueOnce(undefined);
    const persistence = new ClipProjectPersistence(mutate);
    const leave = vi.fn();
    const confirm = async () => {
      try { return await persistence.save(recovered.project!, () => true); }
      catch { return false; }
    };
    await afterConfirmedSave(confirm, leave);
    expect(leave).not.toHaveBeenCalled();
    await afterConfirmedSave(confirm, leave);
    expect(leave).toHaveBeenCalledOnce();
    expect(selectClipProject({ ...draft, captionsOmitted: true, captions: [] }, draft, false).confirmed).toBe(true);
  });

  it("does not reuse old detail on close/reopen after saving edited captions", async () => {
    const edited = { ...project, updatedAt: "2026-10-14T15:00:00.000Z",
      captions: [{ ...project.captions[0], text: "Saved changed captions" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ project })).mockResolvedValueOnce(response({ project: edited })));
    const summary = { ...project, captionsOmitted: true, captions: [] };
    const oldDetail = { key: clipProjectReadKey(summary, 1, 0), project: await loadFullClipProject(project.id) };
    const reopenedKey = clipProjectReadKey({ ...edited, captionsOmitted: true, captions: [] }, 3, 0);
    expect(currentClipProjectDetail(oldDetail, reopenedKey)).toBeNull();
    const freshDetail = { key: reopenedKey, project: await loadFullClipProject(project.id) };
    expect(currentClipProjectDetail(freshDetail, reopenedKey)?.project.captions[0].text).toBe("Saved changed captions");
    // A server save response updates the library summary while editing. It must
    // not remount this active editor and discard still-unconfirmed typing.
    expect(clipProjectReadKey(edited, 3, 0)).toBe(reopenedKey);
    expect(currentClipProjectDetail(freshDetail, clipProjectReadKey(edited, 3, 1))).toBeNull();
  });

  it("opens a complete saved project without rebuilding its edited captions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ project })));
    await expect(loadFullClipProject(project.id)).resolves.toEqual(project);
  });

  it.each([
    undefined, { ...project, id: "another-project" }, { ...project, captionsOmitted: true },
    { ...project, captions: undefined }, { ...project, captions: [{ text: "Incomplete" }] }
  ])("refuses unsafe project data before the autosaving editor mounts: %j", async (value) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ project: value })));
    await expect(loadFullClipProject(project.id)).rejects.toThrow("incomplete clip project data");
  });

  it("accepts a genuinely captionless project and encodes the requested id", async () => {
    const id = "project with / slash";
    const fetcher = vi.fn().mockResolvedValue(response({ project: { ...project, id, captions: [] } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadFullClipProject(id)).resolves.toMatchObject({ id, captions: [] });
    expect(fetcher).toHaveBeenCalledWith("/api/clip-projects/project%20with%20%2F%20slash", expect.any(Object));
  });
});
