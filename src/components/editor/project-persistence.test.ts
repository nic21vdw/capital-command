import { afterEach, describe, expect, it, vi } from "vitest";
import { clipProjectSchema } from "@/lib/storage/schemas";
import { readDraftProject } from "./drafts";
import { ClipProjectPersistence, afterConfirmedSave } from "./project-persistence";

const original = clipProjectSchema.parse({
  id: "project-1", jobId: "job-1", sourceFile: "clip.mp4", name: "My edit",
  createdAt: "2026-10-14T14:00:00.000Z", updatedAt: "2026-10-14T14:30:00.000Z", captions: []
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe("confirmed Clip Editor persistence", () => {
  it("asks mutation failures to reject and keeps the recovery copy on a failed save", async () => {
    const items = new Map<string, string>();
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value) };
    vi.stubGlobal("window", { sessionStorage: storage, localStorage: storage });
    const mutate = vi.fn().mockRejectedValue(new Error("HTTP 500"));
    const persistence = new ClipProjectPersistence(mutate);
    await expect(persistence.save(original, () => true)).rejects.toThrow("HTTP 500");
    expect(mutate).toHaveBeenCalledWith("upsertClipProject", expect.objectContaining({ name: "My edit" }),
      expect.objectContaining({ rethrow: true, signal: expect.any(AbortSignal) }));
    expect(readDraftProject(original.id)?.name).toBe("My edit");
  });

  it("does not confirm old edits and serializes a newer save behind the pending request", async () => {
    const first = deferred();
    const mutate = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
    const persistence = new ClipProjectPersistence(mutate);
    const newer = { ...original, name: "Newer unsaved words" };
    let current = original;
    const firstSave = persistence.save(original, () => current === original);
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    current = newer;
    const nextSave = persistence.save(newer, () => current === newer);
    expect(mutate).toHaveBeenCalledTimes(1);
    first.resolve();
    await expect(firstSave).resolves.toBe(false);
    await expect(nextSave).resolves.toBe(true);
    expect(mutate.mock.calls[1][1].name).toBe("Newer unsaved words");
  });

  it("skips obsolete queued edits and can retry after a rejected save", async () => {
    const mutate = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const persistence = new ClipProjectPersistence(mutate);
    await expect(persistence.save(original, () => true)).rejects.toThrow("offline");
    await expect(persistence.save(original, () => false)).resolves.toBe(false);
    await expect(persistence.save({ ...original, name: "Retry" }, () => true)).resolves.toBe(true);
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("never runs navigation or scheduling after a failed or superseded save", async () => {
    const next = vi.fn();
    await afterConfirmedSave(async () => false, next);
    expect(next).not.toHaveBeenCalled();
    await afterConfirmedSave(async () => true, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
