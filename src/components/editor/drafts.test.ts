import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipProjectSchema } from "@/lib/storage/schemas";
import { clearDraftProject, readDraftProject, writeDraftProject } from "./drafts";

const PREFIX = "capital-command:clip-editor-draft:";

function storage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
    clear: () => { items.clear(); }
  };
}

function project(updatedAt = "2026-10-02T14:30:00.000Z") {
  return clipProjectSchema.parse({
    id: "project-1", jobId: "job-1", sourceFile: "clip.mp4", name: "Recovery draft",
    createdAt: "2026-10-02T14:00:00.000Z", updatedAt,
    captions: [{ id: "caption-1", start: 1, end: 2, text: "Keep these edited words", words: [], enabled: true }]
  });
}

describe("clip draft recovery", () => {
  let session: Storage;
  let local: Storage;
  beforeEach(() => {
    session = storage();
    local = storage();
    vi.stubGlobal("window", { sessionStorage: session, localStorage: local });
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("restores the newest complete recovery copy rather than an older tab snapshot", () => {
    session.setItem(PREFIX + "project-1", JSON.stringify(project("2026-10-02T14:10:00.000Z")));
    const latest = { ...project(), title: "Latest revision" };
    local.setItem(PREFIX + "project-1", JSON.stringify(latest));
    expect(readDraftProject("project-1")).toMatchObject(latest);
  });

  it("can read, save and clear drafts when session storage access is blocked", () => {
    const denied = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    Object.defineProperty(window, "sessionStorage", { get: denied });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: denied });
    expect(() => writeDraftProject(project())).not.toThrow();
    expect(readDraftProject("project-1")?.captions[0].text).toBe("Keep these edited words");
    expect(() => clearDraftProject("project-1")).not.toThrow();
    expect(local.getItem(PREFIX + "project-1")).toBeNull();
  });

  it("still recovers from local storage when reading the other store throws", () => {
    vi.spyOn(session, "getItem").mockImplementation(() => { throw new Error("Unavailable"); });
    local.setItem(PREFIX + "project-1", JSON.stringify(project()));
    expect(readDraftProject("project-1")?.id).toBe("project-1");
  });

  it.each([null, "bad snapshot", [], { ...project(), id: "other-project" }, { ...project(), captionsOmitted: true }, { ...project(), updatedAt: "invalid" }])(
    "ignores invalid or incomplete snapshots and recovers the valid copy: %j", (invalid) => {
      session.setItem(PREFIX + "project-1", JSON.stringify(invalid));
      local.setItem(PREFIX + "project-1", JSON.stringify(project()));
      expect(readDraftProject("project-1")?.id).toBe("project-1");
      expect(readDraftProject("project-1")?.updatedAt).toBe(project().updatedAt);
      expect(readDraftProject("project-1")?.captionsOmitted).not.toBe(true);
      expect(readDraftProject("project-1")?.captions[0].text).toBe("Keep these edited words");
    }
  );

  it("does not replace a complete recovery copy with a caption-less list payload", () => {
    writeDraftProject(project());
    writeDraftProject({ ...project(), captionsOmitted: true, captions: [] });
    expect(readDraftProject("project-1")?.captions).toHaveLength(1);
  });

  it("keeps legacy drafts working with the default composition", () => {
    const legacy = { ...project(), compositionMode: undefined };
    local.setItem(PREFIX + "project-1", JSON.stringify(legacy));
    expect(readDraftProject("project-1")?.compositionMode).toBe("center-blur");
  });

  it("treats quota and removal failures as best effort for each store", () => {
    vi.spyOn(session, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    vi.spyOn(session, "removeItem").mockImplementation(() => { throw new Error("Unavailable"); });
    writeDraftProject(project());
    expect(local.getItem(PREFIX + "project-1")).not.toBeNull();
    expect(() => clearDraftProject("project-1")).not.toThrow();
    expect(local.getItem(PREFIX + "project-1")).toBeNull();
  });
});
