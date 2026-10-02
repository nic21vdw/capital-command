import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipProjectSchema } from "@/lib/storage/schemas";
import type { ClipProject } from "@/types/domain";
import { ClipExportTracker, loadPersistedExports, saveProjectForExport, type TrackedExport } from "./export-tracker";
import { readDraftProject } from "./drafts";

const PREFIX = "capital-command:clip-export:";
const project = () => clipProjectSchema.parse({
  id: "project-1", jobId: "job-1", sourceFile: "clip.mp4", name: "Synthetic edit",
  createdAt: "2026-10-02T14:00:00.000Z", updatedAt: "2026-10-02T14:30:00.000Z"
});
const json = (body: unknown, status = 200) => Response.json(body, { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() { return entries.size; }, key: (i) => [...entries.keys()][i] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: (key) => { entries.delete(key); }, clear: () => { entries.clear(); }
  };
}
function setup(saveProject = vi.fn<(project: ClipProject, signal: AbortSignal) => Promise<void>>(async () => undefined)) {
  const request = vi.fn<typeof fetch>();
  const changed = vi.fn<(state: Record<string, TrackedExport>) => void>();
  const notify = vi.fn();
  const tracker = new ClipExportTracker({ saveProject, request, changed, notify });
  const state = () => changed.mock.calls.at(-1)?.[0]["project-1"];
  return { tracker, request, changed, notify, saveProject, state };
}

describe("clip export workflow", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("saves edits before rendering, tracks progress, and retains the finished download", async () => {
    const { tracker, request, saveProject, state, notify } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } }, 201))
      .mockResolvedValueOnce(json({ export: { status: "processing", progress: 55 } }))
      .mockResolvedValueOnce(json({ export: { status: "done", progress: 100, file: "finished.mp4" } }));
    await tracker.start(project());
    expect(saveProject).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1", sourceFile: "clip.mp4" }), expect.any(AbortSignal));
    expect(saveProject.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
    expect(JSON.parse(storage.getItem(PREFIX + "project-1")!)).toMatchObject({ exportId: "export-1", jobId: "job-1" });
    await tracker.poll();
    expect(state()).toMatchObject({ status: "processing", progress: 55 });
    await tracker.poll();
    expect(state()).toMatchObject({ status: "done", progress: 100, file: "finished.mp4" });
    expect(storage.getItem(PREFIX + "project-1")).toBeNull();
    expect(notify).toHaveBeenCalledWith("Export complete.", false);
  });

  it("does not render after a failed project save and names the recoverable failure", async () => {
    const save = vi.fn(async () => { throw new Error("Disk unavailable"); });
    const { tracker, request, state } = setup(save);
    await tracker.start(project());
    expect(request).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ status: "error", error: expect.stringContaining("could not be saved") });
    expect(readDraftProject("project-1")?.sourceFile).toBe("clip.mp4");
  });

  it("does not save or render a project list payload whose captions were omitted", async () => {
    const { tracker, request, saveProject, state } = setup();
    await tracker.start({ ...project(), captionsOmitted: true });
    expect(request).not.toHaveBeenCalled();
    expect(saveProject).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ status: "error", error: expect.stringContaining("full project") });
  });

  it.each(["getter", "write", "remove"])("keeps successful live export state when storage %s fails", async (failure) => {
    if (failure === "getter") Object.defineProperty(window, "localStorage", { get: () => { throw new Error("Blocked"); } });
    if (failure === "write") vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    if (failure === "remove") vi.spyOn(storage, "removeItem").mockImplementation(() => { throw new Error("Blocked"); });
    const { tracker, request, state } = setup();
    expect(() => tracker.restore()).not.toThrow();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockResolvedValueOnce(json({ export: { status: "done", file: "finished.mp4" } }));
    await tracker.start(project());
    await tracker.poll();
    expect(state()).toMatchObject({ status: "done", file: "finished.mp4" });
  });

  it("deduplicates repeated starts while saving and while rendering", async () => {
    const saving = deferred<void>();
    const save = vi.fn(() => saving.promise);
    const { tracker, request } = setup(save);
    request.mockResolvedValue(json({ export: { id: "export-1" } }));
    const start = tracker.start(project());
    await tracker.start(project());
    expect(save).toHaveBeenCalledTimes(1);
    saving.resolve(undefined);
    await start;
    await tracker.start(project());
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stops before creating a render when cancellation arrives during saving", async () => {
    const saving = deferred<void>();
    const { tracker, request, state } = setup(vi.fn(() => saving.promise));
    const start = tracker.start(project());
    await tracker.stop("project-1");
    saving.resolve(undefined);
    await start;
    expect(request).not.toHaveBeenCalled();
    expect(state()?.status).toBe("canceled");
  });

  it("ends a never-settling required save at the deadline and lets the creator retry", async () => {
    vi.useFakeTimers();
    const never = deferred<void>();
    const save = vi.fn<(project: ClipProject, signal: AbortSignal) => Promise<void>>()
      .mockImplementationOnce(() => never.promise).mockResolvedValue(undefined);
    const { tracker, request, state } = setup(save);
    request.mockResolvedValue(json({ export: { id: "export-retry" } }));
    const first = tracker.start(project());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state()).toMatchObject({ status: "error", error: expect.stringContaining("timed out") });
    expect(save.mock.calls[0][1].aborted).toBe(true);
    await first;
    await tracker.start(project());
    expect(save).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ status: "processing", exportId: "export-retry" });
    never.resolve(undefined);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("retries immediately after stopping a stalled save; an old completion cannot unlock the newer save", async () => {
    const oldSave = deferred<void>();
    const newSave = deferred<void>();
    const save = vi.fn().mockImplementationOnce(() => oldSave.promise).mockImplementationOnce(() => newSave.promise);
    const { tracker, request, state } = setup(save);
    request.mockResolvedValue(json({ export: { id: "export-new" } }));
    const first = tracker.start(project());
    await Promise.resolve();
    await tracker.stop("project-1");
    const retry = tracker.start({ ...project(), title: "New revision" });
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    const current = state();
    oldSave.resolve(undefined);
    await first;
    await tracker.start(project());
    expect(save).toHaveBeenCalledTimes(2);
    expect(state()).toBe(current);
    expect(request).not.toHaveBeenCalled();
    newSave.resolve(undefined);
    await retry;
    expect(state()).toMatchObject({ status: "processing", exportId: "export-new" });
    expect(JSON.parse(request.mock.calls[0][1]!.body as string).title).toBe("New revision");
  });

  it("passes the same abort signal and required-save failure semantics through the provider adapter", async () => {
    const pending = deferred<void>();
    const mutation = vi.fn<(action: string, payload?: unknown, options?: { rethrow?: boolean; signal?: AbortSignal }) => Promise<void>>()
      .mockReturnValue(pending.promise);
    const adapter = vi.fn((project: ClipProject, signal: AbortSignal) => saveProjectForExport(mutation, project, signal));
    const { tracker, request, state } = setup(adapter);
    const start = tracker.start(project());
    await Promise.resolve();
    expect(mutation).toHaveBeenCalledWith("upsertClipProject", expect.objectContaining({ id: "project-1" }), { rethrow: true, signal: adapter.mock.calls[0][1] });
    const signal = mutation.mock.calls[0][2]!.signal!;
    expect(signal.aborted).toBe(false);
    await tracker.stop("project-1");
    await start;
    expect(signal.aborted).toBe(true);
    expect(state()?.status).toBe("canceled");
    pending.reject(new DOMException("Canceled", "AbortError"));
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it("retains reload recovery until a pending DELETE confirms cancellation", async () => {
    const deleting = deferred<Response>();
    const { tracker, request, state, notify } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockReturnValueOnce(deleting.promise);
    await tracker.start(project());
    const stop = tracker.stop("project-1");
    expect(state()).toMatchObject({ status: "processing", exportId: "export-1" });
    expect(notify).not.toHaveBeenCalledWith("Render stopped.", false);
    const reloaded = setup();
    reloaded.tracker.restore();
    expect(reloaded.state()).toMatchObject({ status: "processing", exportId: "export-1" });
    deleting.resolve(json({ export: { status: "canceled" } }));
    await stop;
    expect(state()?.status).toBe("canceled");
    expect(storage.getItem(PREFIX + "project-1")).toBeNull();
    expect(notify).toHaveBeenLastCalledWith("Render stopped.", false);
  });

  it("keeps the same recoverable job after a refused DELETE and clears it only after a successful retry", async () => {
    const deleting = deferred<Response>();
    const { tracker, request, state } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockReturnValueOnce(deleting.promise);
    await tracker.start(project());
    const stop = tracker.stop("project-1");
    deleting.resolve(json({ error: "Try again" }, 503));
    await stop;
    expect(state()).toMatchObject({ status: "processing", exportId: "export-1", error: expect.stringContaining("Retry Stop") });
    const reloaded = setup();
    reloaded.tracker.restore();
    expect(reloaded.state()?.exportId).toBe("export-1");
    reloaded.request.mockResolvedValue(json({ export: { status: "canceled" } }));
    await reloaded.tracker.stop("project-1");
    expect(reloaded.request.mock.calls[0][0]).toBe("/api/clips/job-1/export/export-1");
    expect(storage.getItem(PREFIX + "project-1")).toBeNull();
  });

  it("persists the id returned after Stop during POST while its cancellation is still pending", async () => {
    const posting = deferred<Response>();
    const postEntered = deferred<void>();
    const deleting = deferred<Response>();
    const deleteEntered = deferred<void>();
    const { tracker, request, state } = setup();
    request.mockImplementationOnce(() => { postEntered.resolve(undefined); return posting.promise; })
      .mockImplementationOnce(() => { deleteEntered.resolve(undefined); return deleting.promise; });
    const start = tracker.start(project());
    await postEntered.promise;
    await tracker.stop("project-1");
    posting.resolve(json({ export: { id: "export-1" } }));
    await deleteEntered.promise;
    expect(state()).toMatchObject({ status: "processing", exportId: "export-1" });
    expect(loadPersistedExports()["project-1"]).toMatchObject({ status: "processing", exportId: "export-1" });
    deleting.resolve(json({ export: { status: "canceled" } }));
    await start;
    expect(storage.getItem(PREFIX + "project-1")).toBeNull();
  });

  it("cancels the exact server render returned after Stop was requested during POST", async () => {
    const posting = deferred<Response>();
    const postEntered = deferred<void>();
    const { tracker, request, state, notify } = setup();
    request.mockImplementationOnce(() => { postEntered.resolve(undefined); return posting.promise; }).mockResolvedValueOnce(json({ export: { status: "canceled" } }));
    const start = tracker.start(project());
    await postEntered.promise;
    expect(request).toHaveBeenCalledTimes(1);
    await tracker.stop("project-1");
    posting.resolve(json({ export: { id: "export-1" } }));
    await start;
    expect(request.mock.calls[1]).toEqual(["/api/clips/job-1/export/export-1", expect.objectContaining({ method: "DELETE" })]);
    expect(state()?.status).toBe("canceled");
    expect(notify).toHaveBeenLastCalledWith("Render stopped.", false);
  });

  it("retains a job for retry if cancellation of an in-flight start fails", async () => {
    const posting = deferred<Response>();
    const postEntered = deferred<void>();
    const { tracker, request, state, notify } = setup();
    request.mockImplementationOnce(() => { postEntered.resolve(undefined); return posting.promise; }).mockResolvedValueOnce(json({ error: "Unavailable" }, 503));
    const start = tracker.start(project());
    await postEntered.promise;
    await tracker.stop("project-1");
    posting.resolve(json({ export: { id: "export-1" } }));
    await start;
    expect(state()).toMatchObject({ status: "processing", exportId: "export-1", error: expect.stringContaining("Retry Stop") });
    expect(notify).not.toHaveBeenCalledWith("Render stopped.", false);
  });

  it.each(["rejected", "503", "malformed", "missing-id"])(
    "lets Export retry when Stop arrives during a POST that later fails: %s", async (failure) => {
      const posting = deferred<Response>();
      const entered = deferred<void>();
      const { tracker, request, state, notify } = setup();
      request.mockImplementationOnce(() => { entered.resolve(undefined); return posting.promise; })
        .mockResolvedValueOnce(json({ export: { id: "export-retry" } }));
      const first = tracker.start(project());
      await entered.promise;
      await tracker.stop("project-1");
      if (failure === "rejected") posting.reject(new Error("Synthetic request timed out"));
      if (failure === "503") posting.resolve(json({ error: "Unavailable" }, 503));
      if (failure === "malformed") posting.resolve(new Response("broken response"));
      if (failure === "missing-id") posting.resolve(json({ export: {} }));
      await first;
      expect(state()).toMatchObject({ status: "error", error: expect.stringContaining("confirm") });
      expect(notify).not.toHaveBeenCalledWith("Render stopped.", false);
      await tracker.start(project());
      expect(request).toHaveBeenCalledTimes(2);
      expect(state()).toMatchObject({ status: "processing", exportId: "export-retry" });
    }
  );

  it("does not let an older completed poll overwrite cancellation or a replacement export", async () => {
    const oldPoll = deferred<Response>();
    const { tracker, request, state, notify } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } }))
      .mockReturnValueOnce(oldPoll.promise)
      .mockResolvedValueOnce(json({ export: { status: "canceled" } }))
      .mockResolvedValueOnce(json({ export: { id: "export-2" } }));
    await tracker.start(project());
    const poll = tracker.poll();
    await tracker.stop("project-1");
    await tracker.start(project());
    oldPoll.resolve(json({ export: { status: "done", file: "old.mp4" } }));
    await poll;
    expect(state()).toMatchObject({ status: "processing", exportId: "export-2" });
    expect(state()?.file).toBeUndefined();
    expect(notify).not.toHaveBeenCalledWith("Export complete.", false);
  });

  it("also discards a stale completion when cancellation happens during body decoding", async () => {
    const body = deferred<unknown>();
    const { tracker, request, state } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } }))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => body.promise } as Response)
      .mockResolvedValueOnce(json({ export: { status: "canceled" } }));
    await tracker.start(project());
    const poll = tracker.poll();
    await Promise.resolve();
    await tracker.stop("project-1");
    body.resolve({ export: { status: "done", file: "old.mp4" } });
    await poll;
    expect(state()?.status).toBe("canceled");
    expect(state()?.file).toBeUndefined();
  });

  it("keeps polling truthful after a failed Stop and lets the creator retry", async () => {
    const { tracker, request, state, notify } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } }))
      .mockResolvedValueOnce(json({ error: "Unavailable" }, 503))
      .mockResolvedValueOnce(json({ export: { status: "canceled" } }));
    await tracker.start(project());
    await tracker.stop("project-1");
    expect(state()).toMatchObject({ status: "processing", error: expect.stringContaining("Retry Stop") });
    expect(notify).not.toHaveBeenCalledWith("Render stopped.", false);
    await tracker.stop("project-1");
    expect(state()?.status).toBe("canceled");
    expect(notify).toHaveBeenLastCalledWith("Render stopped.", false);
  });

  it("retains a completed download when the server finishes just before cancellation", async () => {
    const { tracker, request, state, notify } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockResolvedValueOnce(json({ export: { status: "done", file: "finished.mp4" } }));
    await tracker.start(project());
    await tracker.stop("project-1");
    expect(state()).toMatchObject({ status: "done", file: "finished.mp4" });
    expect(notify).not.toHaveBeenCalledWith("Render stopped.", false);
  });

  it("does not claim successful cancellation when the render expired after a server restart", async () => {
    const { tracker, request, state, notify } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    await tracker.start(project());
    await tracker.stop("project-1");
    expect(state()).toMatchObject({ status: "error", error: expect.stringContaining("server restart") });
    expect(notify).not.toHaveBeenCalledWith("Render stopped.", false);
  });

  it("prevents overlapping polls on slow connections", async () => {
    const pending = deferred<Response>();
    const { tracker, request } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockReturnValueOnce(pending.promise);
    await tracker.start(project());
    const poll = tracker.poll();
    await tracker.poll();
    expect(request).toHaveBeenCalledTimes(2);
    pending.resolve(json({ export: { status: "processing", progress: 10 } }));
    await poll;
  });

  it("restores and expires a render after a server restart even with an unreadable 404 body", async () => {
    storage.setItem(PREFIX + "project-1", JSON.stringify({ jobId: "job-1", exportId: "export-1", progress: 70 }));
    const { tracker, request, state } = setup();
    tracker.restore();
    expect(state()).toMatchObject({ status: "processing", progress: 70 });
    request.mockResolvedValue(new Response("Not found", { status: 404 }));
    await tracker.poll();
    expect(state()).toMatchObject({ status: "error", error: expect.stringContaining("server restart") });
  });

  it("does not mistake transient HTTP errors carrying a result for a completed export", async () => {
    const { tracker, request, state } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockResolvedValueOnce(json({ export: { status: "done", file: "wrong.mp4" } }, 503));
    await tracker.start(project());
    await tracker.poll();
    expect(state()?.status).toBe("processing");
  });

  it("does not announce a usable export when completion has no downloadable file", async () => {
    const { tracker, request, state, notify } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockResolvedValueOnce(json({ export: { status: "done" } }));
    await tracker.start(project());
    await tracker.poll();
    expect(state()?.status).toBe("error");
    expect(notify).not.toHaveBeenCalledWith("Export complete.", false);
  });

  it("does not notify or update an unmounted editor from a delayed response", async () => {
    const pending = deferred<Response>();
    const { tracker, request, changed, notify } = setup();
    request.mockResolvedValueOnce(json({ export: { id: "export-1" } })).mockReturnValueOnce(pending.promise);
    await tracker.start(project());
    const poll = tracker.poll();
    tracker.setActive(false);
    changed.mockClear();
    pending.resolve(json({ export: { status: "done", file: "finished.mp4" } }));
    await poll;
    expect(changed).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores malformed restore records without hiding valid recovery entries", () => {
    storage.setItem(PREFIX + "bad", "{");
    storage.setItem(PREFIX + "invalid", JSON.stringify({ jobId: 12, exportId: "bad" }));
    storage.setItem(PREFIX + "project-1", JSON.stringify({ jobId: "job-1", exportId: "export-1", progress: "bad" }));
    expect(loadPersistedExports()).toEqual({ "project-1": { jobId: "job-1", exportId: "export-1", status: "processing", progress: 1 } });
  });
});
