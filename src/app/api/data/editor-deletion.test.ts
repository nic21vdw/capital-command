import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ClipJob } from "@/lib/clipping/types";

let root: string;
let previousRoot: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "original-editor-deletion-"));
  previousRoot = process.env.CAPITAL_COMMAND_DATA_DIR;
  process.env.CAPITAL_COMMAND_DATA_DIR = root;
  vi.resetModules();
});
afterEach(() => {
  process.env.CAPITAL_COMMAND_DATA_DIR = previousRoot;
  vi.unstubAllGlobals();
});
const owner = { ownerId: "fixture-owner", scopes: ["read", "write"] as const };
const file = () => path.join(root, "capital-command.json");
const jobsFile = () => path.join(root, "clips", "jobs.json");
async function fixture() {
  const { makeClipProject } = await import("@/lib/clipping/editor");
  const { appDataSchema } = await import("@/lib/storage/schemas");
  const { emptyData } = await import("@/lib/mockData/seed");
  const { MarketingEditor } = await import("@/lib/integrations/marketing/editor");
  const store = await import("@/lib/storage/store");
  const api = await import("./route");
  const detail = await import("@/app/api/clip-projects/[id]/route");
  const project = { ...makeClipProject({ jobId: "job-1", name: "Synthetic original project", sourceFile: "fixture.mp4",
    sourceUrl: "https://video.example/fixture", clipStart: 20, clipEnd: 30 }), id: "project-1" };
  const unrelated = { ...project, id: "unmanaged-project", name: "Existing unmanaged project" };
  const job: ClipJob = { id: "job-1", fileName: "Synthetic source", sourceUrl: project.sourceUrl,
    status: "done", stage: "finished", progress: 100, notices: [], createdAt: project.createdAt,
    clips: [{ id: "clip-1", start: 20, end: 30, file: project.sourceFile, score: 50,
      breakdown: { hook: 50, pacing: 50, standalone: 50, intensity: 50 }, rationale: "Synthetic" }] };
  await mkdir(path.dirname(jobsFile()), { recursive: true });
  await writeFile(jobsFile(), JSON.stringify([job]));
  await writeFile(file(), JSON.stringify(appDataSchema.parse({ ...emptyData, clipProjects: [project, unrelated] })));
  const binding = { ownerId: owner.ownerId, records: [{ projectId: project.id, jobId: project.jobId, clipId: "clip-1", sourceFile: project.sourceFile }] };
  const editor = new MarketingEditor({ binding });
  const initial = await editor.load(owner, project.id);
  const command = { operation: "save_editor_project" as const, commandId: randomUUID(), target: initial.target, project: initial.project };
  const saved = await editor.save(owner, command);
  return { api, detail, store, editor, binding, command, saved, unrelated };
}
const post = (action: string, payload: unknown) => new NextRequest("http://localhost:3100/api/data", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, payload })
});

describe("original editor managed deletion", () => {
  it("keeps delete → reload → bootstrap → detail deleted while preserving same-record receipts", async () => {
    const { api, detail, store, saved } = await fixture();
    const deleted = await api.POST(post("deleteClipProject", "project-1"));
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).data.clipProjects.map((project: { id: string }) => project.id)).toEqual(["unmanaged-project"]);
    const reloaded = await api.GET(new NextRequest("http://localhost:3100/api/data"));
    expect((await reloaded.json()).data.clipProjects.map((project: { id: string }) => project.id)).toEqual(["unmanaged-project"]);
    const bootstrap = await import("@/app/api/bootstrap/route");
    expect((await (await bootstrap.GET()).json()).data.clipProjects.map((project: { id: string }) => project.id)).toEqual(["unmanaged-project"]);
    const response = await detail.GET(new NextRequest("http://localhost:3100/api/clip-projects/project-1"), { params: Promise.resolve({ id: "project-1" }) });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ deleted: true });
    const tombstone = (await store.readAppData()).clipProjects.find((project) => project.id === "project-1")!;
    expect(tombstone.marketingEditor?.deletedAt).toEqual(expect.any(String));
    expect(tombstone.marketingEditor?.receipts[0].result).toEqual(saved.receipt);
  }, 15_000);

  it("rejects original upserts and whole-document resurrection without touching the retained receipt", async () => {
    const { api, store, command } = await fixture();
    const beforeDeletion = await store.readAppData();
    await api.POST(post("deleteClipProject", "project-1"));
    const unchanged = await readFile(file(), "utf8");
    expect((await api.POST(post("upsertClipProject", command.project))).status).toBe(410);
    await expect(store.writeAppData(beforeDeletion)).rejects.toMatchObject({ name: "ManagedEditorDeletedError" });
    const current = await store.readAppData();
    await expect(store.writeAppData({ ...current, clipProjects: current.clipProjects.map((project) => project.id === "project-1"
      ? { ...project, marketingEditor: undefined } : project) })).rejects.toMatchObject({ name: "ManagedEditorDeletedError" });
    expect(await readFile(file(), "utf8")).toBe(unchanged);
    await store.mutateAppData((data) => ({ ...data, clipProjects: data.clipProjects.map((project) => project.id === "unmanaged-project"
      ? { ...project, title: "Unrelated original edit" } : project) }));
    expect((await store.readAppData()).clipProjects.find((project) => project.id === "unmanaged-project")?.title).toBe("Unrelated original edit");
  });

  it("refuses tombstone library selection, opening old recovery drafts, and local tombstone autosave", async () => {
    const { api, detail, store, command } = await fixture();
    await api.POST(post("deleteClipProject", "project-1"));
    const tombstone = (await store.readAppData()).clipProjects.find((project) => project.id === "project-1")!;
    const { selectClipProject, loadClipProjectForEditor } = await import("@/components/editor/clip-library");
    const { ClipProjectPersistence } = await import("@/components/editor/project-persistence");
    expect(selectClipProject(tombstone, command.project, false)).toEqual({ project: null, confirmed: false });
    vi.stubGlobal("fetch", vi.fn(async () => detail.GET(new NextRequest("http://localhost:3100/api/clip-projects/project-1"),
      { params: Promise.resolve({ id: "project-1" }) })));
    // This draft predates managed enrollment; only the server's 410 can know
    // it is a deleted managed identity rather than a new recovery project.
    await expect(loadClipProjectForEditor(command.project)).rejects.toThrow("deleted");
    const mutate = vi.fn();
    await expect(new ClipProjectPersistence(mutate).save(tombstone, () => true)).rejects.toThrow("deleted");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("returns the exact committed receipt after deletion and job loss, without recreating the project", async () => {
    const { api, editor, command, saved, binding } = await fixture();
    await api.POST(post("deleteClipProject", "project-1"));
    await unlink(jobsFile());
    const unchanged = await readFile(file(), "utf8");
    const result = await editor.save(owner, command);
    expect(result).toEqual({ receipt: saved.receipt, replayed: true, snapshot: null, reconciliation: { state: "deleted" } });
    const { MarketingEditor } = await import("@/lib/integrations/marketing/editor");
    const readJob = vi.fn(async () => { throw new Error("Deleted replay must not read media/job state."); });
    const store = await import("@/lib/storage/store");
    const restarted = new MarketingEditor({ binding, store: { read: store.readExistingAppData, mutate: store.mutateExistingClipProject, readJob } });
    expect(await restarted.replay(owner, command)).toEqual(result);
    expect(readJob).not.toHaveBeenCalled();
    await expect(editor.save(owner, { ...command, commandId: randomUUID() })).rejects.toThrow();
    await expect(editor.replay(owner, { ...command, project: { ...command.project, title: "Different payload" } }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(editor.replay({ ...owner, ownerId: "foreign-owner" }, command)).rejects.toMatchObject({ code: "forbidden" });
    expect(await readFile(file(), "utf8")).toBe(unchanged);
  });

  it("returns a known receipt with record_unavailable when the original source disappears", async () => {
    const { editor, command, saved } = await fixture();
    expect(saved.snapshot).not.toBeNull();
    // Match the public HTTP payload, which omits internal undefined fields.
    const current = JSON.parse(JSON.stringify(saved.snapshot)) as NonNullable<typeof saved.snapshot>;
    expect(current.target.revision).toBe(command.target.revision + 1);
    await unlink(jobsFile());
    const unchanged = await readFile(file(), "utf8");
    expect(await editor.replay(owner, command)).toEqual({ receipt: saved.receipt, replayed: true, snapshot: null,
      reconciliation: { state: "record_unavailable" } });
    expect((await editor.save(owner, command)).receipt).toEqual(saved.receipt);
    // A new UUID does not make the pre-save revision current. Preserve the
    // revision fence, then test source loss with the actual saved snapshot.
    await expect(editor.save(owner, { ...command, commandId: randomUUID() })).rejects.toMatchObject({ code: "conflict" });
    await expect(editor.save(owner, { ...command, commandId: randomUUID(), target: current.target, project: current.project }))
      .rejects.toMatchObject({ code: "not_found" });
    expect(await readFile(file(), "utf8")).toBe(unchanged);
  });
});
