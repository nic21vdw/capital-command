import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ClipProject } from "@/types/domain";
import type { ClipJob } from "@/lib/clipping/types";
import type { EditorSnapshot } from "./editor-types";
import type { Principal } from "./safety";

let root: string;
let previousRoot: string | undefined;
let api: typeof import("./editor");
let store: typeof import("@/lib/storage/store");
const owner: Principal = { ownerId: "fixture-owner", scopes: ["read", "write", "review"] };
const worker: Principal = { ownerId: "fixture-owner", scopes: ["worker"] };
const workerEpoch = "11111111-1111-4111-8111-111111111111";
const binding = { ownerId: "fixture-owner", records: [{ projectId: "project-1", jobId: "job-1", clipId: "clip-1", sourceFile: "master.mp4" }] };
const documentFile = () => path.join(root, "capital-command.json");
const jobsFile = () => path.join(root, "clips", "jobs.json");
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marketing-original-editor-"));
  previousRoot = process.env.CAPITAL_COMMAND_DATA_DIR;
  process.env.CAPITAL_COMMAND_DATA_DIR = root;
  vi.resetModules();
  api = await import("./editor");
  store = await import("@/lib/storage/store");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network in original editor fixtures."); }));
});
afterEach(() => {
  process.env.CAPITAL_COMMAND_DATA_DIR = previousRoot;
  vi.unstubAllGlobals();
});
async function fixture() {
  const { appDataSchema, clipProjectSchema } = await import("@/lib/storage/schemas");
  const { emptyData } = await import("@/lib/mockData/seed");
  const project = clipProjectSchema.parse({
    id: "project-1", name: "Original manually edited clip", jobId: "job-1", sourceFile: "master.mp4",
    sourceUrl: "https://video.example/watch?v=fixture&signature=private-source-token", baseDurationSec: 10,
    clipStart: 20, clipEnd: 30, trimStart: 0, trimEnd: 10,
    captions: [{ id: "hand-split", start: 1, end: 3, text: "Hand corrected", enabled: true,
      words: [{ text: "Hand", start: 1, end: 1.5 }, { text: "corrected", start: 1.6, end: 2.8 }] }],
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z"
  });
  const data = appDataSchema.parse({ ...emptyData, clipProjects: [project] });
  const job: ClipJob = {
    id: "job-1", fileName: "Original fixture source", sourceUrl: project.sourceUrl,
    status: "processing", stage: "rendering", progress: 50, notices: [], createdAt: project.createdAt,
    clips: [{ id: "clip-1", start: 20, end: 30, file: "master.mp4", score: 50,
      breakdown: { hook: 50, pacing: 50, standalone: 50, intensity: 50 }, rationale: "Fixture" }],
    sourceCaptions: [{ id: "cached-source", start: 21, end: 23, text: "Uncorrected cached source", words: [], enabled: true }],
    captionsFetchedAt: "2026-10-01T01:00:00.000Z", captionsError: "Private path C:\\do-not-return\\source.mp4"
  };
  await mkdir(path.dirname(jobsFile()), { recursive: true });
  await writeFile(documentFile(), JSON.stringify(data));
  await writeFile(jobsFile(), JSON.stringify([job]));
  return { data, project, job, editor: new api.MarketingEditor({ binding }) };
}
function save(snapshot: EditorSnapshot, overrides: Partial<ClipProject> = {}, commandId = randomUUID()) {
  return { operation: "save_editor_project" as const, commandId, target: snapshot.target,
    project: { ...snapshot!.project, ...overrides } };
}
function request(snapshot: EditorSnapshot, commandId = randomUUID()) {
  return { operation: "request_editor_export" as const, commandId, target: snapshot.target };
}
const disk = async () => JSON.parse(await readFile(documentFile(), "utf8"));

describe("scoped editor project deletion", () => {
  it("issues passive delete targets only for the explicit project scope and existing write permission", async () => {
    const { data } = await fixture();
    await writeFile(documentFile(), JSON.stringify({ ...data, clipProjects: [data.clipProjects[0], { ...data.clipProjects[0], id: "not-enrolled" }] }));
    const readJob = vi.fn(async () => { throw new Error("A library delete target must not load a source job."); });
    const editor = new api.MarketingEditor({ binding, store: { read: store.readExistingAppData, mutate: store.mutateExistingClipProject, readJob } });
    const before = await readFile(documentFile(), "utf8");
    const writable = await editor.list(owner);
    expect(writable).toHaveLength(1);
    expect(writable[0]).toMatchObject({ id: "project-1", canDelete: true, deleteTarget: { projectId: "project-1", jobId: "job-1", clipId: "clip-1", revision: 0 } });
    expect(writable[0].deleteTarget.digest).toMatch(/^[a-f0-9]{64}$/);
    const readOnly = { ...owner, scopes: ["read"] as const };
    expect((await editor.list(readOnly))[0].canDelete).toBe(false);
    await expect(editor.deleteProject(readOnly, { operation: "delete_editor_project", commandId: randomUUID(), target: writable[0].deleteTarget }))
      .rejects.toMatchObject({ code: "forbidden" });
    expect(await readFile(documentFile(), "utf8")).toBe(before);
    expect(readJob).not.toHaveBeenCalled();
  });

  it.each(["missing", "malformed", "empty", "directory"])("deletes an original project with %s jobs.json without reading or repairing it", async (kind) => {
    await fixture();
    if (kind === "missing" || kind === "directory") await unlink(jobsFile());
    if (kind === "directory") await mkdir(jobsFile());
    if (kind === "malformed") await writeFile(jobsFile(), "{malformed synthetic job record");
    if (kind === "empty") await writeFile(jobsFile(), "[]");
    const readJob = vi.fn(async () => { throw new Error("Deletion must not read a source job."); });
    const editor = new api.MarketingEditor({ binding, store: { read: store.readExistingAppData, mutate: store.mutateExistingClipProject, readJob } });
    const summary = (await editor.list(owner))[0];
    const command = { operation: "delete_editor_project" as const, commandId: randomUUID(), target: summary.deleteTarget };
    const first = await editor.deleteProject(owner, command);
    expect(first).toEqual({ receipt: { commandId: command.commandId, operation: command.operation, revision: 1,
      digest: summary.deleteTarget.digest, renderSignature: summary.deleteTarget.renderSignature,
      reviewInvalidated: true, publicationAuthorized: false }, replayed: false, snapshot: null, reconciliation: { state: "deleted" } });
    const original = (await disk()).clipProjects[0];
    expect(original.marketingEditor.deletedAt).toEqual(expect.any(String));
    expect(original.marketingEditor.receipts[0].result).toEqual(first.receipt);
    expect(original.captions[0].text).toBe("Hand corrected");
    expect(await editor.list(owner)).toEqual([]);
    expect((await editor.deleteProject(owner, command)).receipt).toEqual(first.receipt);
    expect((await editor.replay(owner, command))?.reconciliation).toEqual({ state: "deleted" });
    expect(readJob).not.toHaveBeenCalled();
    if (kind === "malformed") expect(await readFile(jobsFile(), "utf8")).toBe("{malformed synthetic job record");
    expect(await readdir(root)).not.toContain("publish-queue.json");
  });

  it("replays the exact deletion after restart and refuses UUID changes, payload changes, and resurrection", async () => {
    const { editor } = await fixture();
    const command = { operation: "delete_editor_project" as const, commandId: randomUUID(), target: (await editor.list(owner))[0].deleteTarget };
    const first = await editor.deleteProject(owner, command);
    await unlink(jobsFile());
    vi.resetModules();
    const { MarketingEditor } = await import("./editor");
    const restarted = new MarketingEditor({ binding });
    expect(await restarted.deleteProject(owner, command)).toEqual({ ...first, replayed: true });
    await expect(restarted.deleteProject(owner, { ...command, target: { ...command.target, revision: 1 } })).rejects.toMatchObject({ code: "conflict" });
    await expect(restarted.deleteProject(owner, { ...command, commandId: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
    expect((await disk()).clipProjects[0].marketingEditor.receipts).toHaveLength(1);
  });

  it("rejects stale delete targets after a save and permits a newly issued exact target", async () => {
    const { editor } = await fixture();
    const initial = await editor.load(owner, "project-1");
    await editor.save(owner, save(initial, { title: "New original edit" }));
    await expect(editor.deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target: initial.target }))
      .rejects.toMatchObject({ code: "conflict" });
    const target = (await editor.list(owner))[0].deleteTarget;
    const result = await editor.deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target });
    expect(result.receipt.revision).toBe(2);
    expect(result.receipt.digest).toBe(target.digest);
    expect((await disk()).clipProjects[0].title).toBe("New original edit");
  });

  it("serializes competing save/delete commands from separate module queues without losing the winner", async () => {
    const { editor } = await fixture();
    const initial = await editor.load(owner, "project-1");
    vi.resetModules();
    const { MarketingEditor } = await import("./editor");
    const other = new MarketingEditor({ binding });
    const outcomes = await Promise.allSettled([
      editor.deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target: initial.target }),
      other.save(owner, save(initial, { title: "Competing original edit" }))
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    const original = (await disk()).clipProjects[0];
    expect(original.marketingEditor.revision).toBe(1);
    expect(original.marketingEditor.receipts).toHaveLength(1);
    const deleted = original.marketingEditor.receipts[0].result.operation === "delete_editor_project";
    expect(Boolean(original.marketingEditor.deletedAt)).toBe(deleted);
    if (!deleted) expect(original.title).toBe("Competing original edit");
  });

  it("keeps original jobs/files unchanged, stales a claimed intent, and refuses late worker proof", async () => {
    await fixture();
    const assertCurrent = vi.fn();
    const ports = { getWorkerEpoch: () => workerEpoch, assertPreparationOnly: vi.fn(), readPreparation: vi.fn(async () => null as import("./editor").EditorPreparationEvidence | null) };
    const editor = new api.MarketingEditor({ binding, worker: ports });
    const snapshot = await editor.load(owner, "project-1");
    const pending = await editor.requestExport(owner, request(snapshot));
    const claimed = await editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(),
      target: snapshot.target, requestId: pending.receipt.requestId! });
    const jobsBefore = await readFile(jobsFile(), "utf8");
    ports.readPreparation.mockResolvedValue({ requestId: pending.receipt.requestId!, attemptId: claimed.attemptId,
      digest: snapshot.target.digest, renderSignature: snapshot.target.renderSignature, exportId: "late-export",
      artifactSha256: "a".repeat(64), assertCurrent });
    await editor.deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target: snapshot.target });
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("stale");
    await expect(editor.recordExportOutcome(worker, { operation: "record_editor_export_outcome", commandId: randomUUID(),
      target: snapshot.target, requestId: pending.receipt.requestId!, attemptId: claimed.attemptId, outcome: "prepared" })).rejects.toMatchObject({ code: "not_found" });
    await expect(editor.load(owner, "project-1")).rejects.toMatchObject({ code: "not_found" });
    expect(assertCurrent).not.toHaveBeenCalled();
    expect(await readFile(jobsFile(), "utf8")).toBe(jobsBefore);
    expect(await readdir(path.join(root, "clips"))).toEqual(["jobs.json"]);
    expect(await readdir(root)).not.toContain("publish-queue.json");
  });

  it("does not delete a changed owner/source binding or an unlisted project", async () => {
    const { editor } = await fixture();
    const saved = await editor.save(owner, save(await editor.load(owner, "project-1")));
    const target = saved.snapshot!.target;
    const command = { operation: "delete_editor_project" as const, commandId: randomUUID(), target };
    const other = new api.MarketingEditor({ binding: { ...binding, ownerId: "another-owner" } });
    await expect(other.deleteProject({ ...owner, ownerId: "another-owner" }, command)).rejects.toMatchObject({ code: "forbidden" });
    await expect(editor.deleteProject(owner, { ...command, target: { ...target, projectId: "not-enrolled" } })).rejects.toMatchObject({ code: "forbidden" });
    await store.mutateAppData((data) => ({ ...data, clipProjects: data.clipProjects.map((project) => ({ ...project, sourceFile: "changed.mp4" })) }));
    const before = await readFile(documentFile(), "utf8");
    await expect(editor.deleteProject(owner, command)).rejects.toMatchObject({ code: "conflict" });
    await expect(editor.list(owner)).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(documentFile(), "utf8")).toBe(before);
  });
});

describe("original editor project integration", () => {
  it("passively loads the original corrected captions and cached source without initializing workers or writing", async () => {
    const { editor } = await fixture();
    const before = await readFile(documentFile(), "utf8");
    const jobs = await readFile(jobsFile(), "utf8");
    const snapshot = await editor.load(owner, "project-1");
    expect(snapshot.project.captions[0].text).toBe("Hand corrected");
    expect(snapshot.cachedCaptions.captions[0].text).toBe("Uncorrected cached source");
    expect(snapshot.project.sourceUrl).toBe("");
    expect(JSON.stringify(snapshot)).not.toMatch(/private-source-token|do-not-return|marketingEditor/);
    expect(snapshot.target.revision).toBe(0);
    expect(snapshot.export.state).toBe("not_requested");
    expect(snapshot.capabilities.dispatchExport).toBe(false);
    expect(await readFile(documentFile(), "utf8")).toBe(before);
    expect(await readFile(jobsFile(), "utf8")).toBe(jobs);
    expect(await readdir(root)).toEqual(["capital-command.json", "clips"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not initialize missing app data on a read", async () => {
    const editor = new api.MarketingEditor({ binding });
    await expect(editor.load(owner, "project-1")).rejects.toMatchObject({ code: "not_found" });
    expect(await readdir(root)).toEqual([]);
  });

  it("denies an unlisted record, foreign owner, and worker-as-user before reading any store", async () => {
    const read = vi.fn(() => Promise.resolve(null));
    const editor = new api.MarketingEditor({ binding: { ...binding, records: [] },
      store: { read, readJob: vi.fn(), mutate: vi.fn() } });
    await expect(editor.load(owner, "project-1")).rejects.toMatchObject({ code: "forbidden" });
    await expect(editor.load({ ...owner, ownerId: "another-owner" }, "project-1")).rejects.toMatchObject({ code: "forbidden" });
    await expect(editor.load(worker, "project-1")).rejects.toMatchObject({ code: "forbidden" });
    expect(await editor.list(owner)).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it("saves manual word timing, trim, and style into the same original document with canonical render parity", async () => {
    const { editor, project } = await fixture();
    const snapshot = await editor.load(owner, project.id);
    const result = await editor.save(owner, save(snapshot, { trimStart: 0.5,
      captions: [{ ...snapshot!.project.captions[0], text: "Precise edit", words: [{ text: "Precise", start: 1.125, end: 2.375 }] }],
      captionStyle: { ...snapshot!.project.captionStyle, textColor: "#ff0000" } }));
    const saved = (await disk()).clipProjects[0];
    const { projectSignature } = await import("@/lib/clipping/project-payload");
    expect(saved.captions[0].words[0]).toEqual({ text: "Precise", start: 1.125, end: 2.375 });
    expect(saved.sourceUrl).toBe(project.sourceUrl);
    expect(saved.marketingEditor.revision).toBe(1);
    expect(saved.marketingEditor.receipts).toHaveLength(1);
    expect(saved.renderSignature).toBe(projectSignature(saved));
    expect(result.snapshot!.target.digest).not.toBe(snapshot.target.digest);
    expect(result.receipt.reviewInvalidated).toBe(true);
    expect(result.snapshot!.reviewRequired).toBe(true);
    expect(result.snapshot!.publicationAuthorized).toBe(false);
  });

  it("replays the durable command receipt after a restart and rejects UUID reuse with changed payload", async () => {
    const { editor } = await fixture();
    const command = save(await editor.load(owner, "project-1"), { title: "Exact saved copy" });
    const first = await editor.save(owner, command);
    vi.resetModules();
    const { MarketingEditor } = await import("./editor");
    const restarted = new MarketingEditor({ binding });
    const replay = await restarted.save(owner, command);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    expect((await disk()).clipProjects[0].marketingEditor.receipts).toHaveLength(1);
    await expect(restarted.save(owner, { ...command, project: { ...command.project, title: "Changed command" } }))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("accepts exactly one concurrent CAS save and rejects the other stale editor", async () => {
    const { editor } = await fixture();
    const initial = await editor.load(owner, "project-1");
    // A second module graph owns a separate in-process queue. The original
    // file lock still has to serialize both writers against the same record.
    vi.resetModules();
    const { MarketingEditor } = await import("./editor");
    const outcomes = await Promise.allSettled([
      editor.save(owner, save(initial, { title: "Editor A" })),
      new MarketingEditor({ binding }).save(owner, save(initial, { title: "Editor B" }))
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")[0]).toMatchObject({ reason: { code: "conflict" } });
    expect((await disk()).clipProjects[0].marketingEditor.receipts).toHaveLength(1);
  });

  it("advances the exact review revision on a no-op save while export requests keep that revision", async () => {
    const { editor } = await fixture();
    const initial = await editor.load(owner, "project-1");
    const saved = await editor.save(owner, save(initial));
    expect(saved.receipt.revision).toBe(initial.target.revision + 1);
    expect(saved.receipt.digest).toBe(initial.target.digest);
    const pending = await editor.requestExport(owner, request(saved.snapshot!));
    expect(pending.receipt.revision).toBe(saved.receipt.revision);
  });

  it("exposes the original edited-output signature as stale after actual caption changes", async () => {
    const { editor, job } = await fixture();
    const initial = await editor.load(owner, "project-1");
    await writeFile(jobsFile(), JSON.stringify([{ ...job, clips: [{ ...job.clips[0],
      editedFile: "original-export.mp4", editedSignature: initial.target.renderSignature }] }]));
    expect((await editor.load(owner, "project-1")).media.edited?.current).toBe(true);
    const result = await editor.save(owner, save(initial, { captions: [{ ...initial.project.captions[0], text: "New exact words" }] }));
    expect(result.snapshot!.media.edited?.current).toBe(false);
    expect(result.snapshot!.target.renderSignature).not.toBe(initial.target.renderSignature);
    expect(result.snapshot!.reviewRequired).toBe(true);
  });

  it("rejects private metadata, incomplete captions, foreign media and path injection without writing", async () => {
    const { editor } = await fixture();
    const initial = await editor.load(owner, "project-1");
    const before = await readFile(documentFile(), "utf8");
    const command = save(initial);
    const incomplete = { ...command.project } as Partial<ClipProject>;
    delete incomplete.captions;
    for (const project of [
      { ...command.project, marketingEditor: { ownerId: "forged" } },
      { ...command.project, captionsOmitted: true, captions: [] }, incomplete,
      { ...command.project, sourceFile: "../other.mp4" },
      { ...command.project, jobId: "foreign-job" },
      { ...command.project, audio: { ...command.project.audio, musicSrc: "C:\\secret.mp3" } },
      { ...command.project, exportSettings: { ...command.project.exportSettings, filename: "../export" } }
    ]) {
      await expect(editor.save(owner, { ...command, commandId: randomUUID(), project } as typeof command)).rejects.toBeInstanceOf(api.MarketingEditorError);
    }
    expect(await readFile(documentFile(), "utf8")).toBe(before);
  });

  it("requires current job/clip/media identity even when the project still exists", async () => {
    const { editor, job } = await fixture();
    const initial = await editor.load(owner, "project-1");
    await writeFile(jobsFile(), JSON.stringify([{ ...job, clips: [{ ...job.clips[0], file: "replacement.mp4" }] }]));
    await expect(editor.load(owner, "project-1")).rejects.toMatchObject({ code: "conflict" });
    await expect(editor.save(owner, save(initial, { title: "A change" }))).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses a save if duplicate original project IDs appear after the editor loaded", async () => {
    const { editor, data } = await fixture();
    const initial = await editor.load(owner, "project-1");
    const duplicated = JSON.stringify({ ...data, clipProjects: [data.clipProjects[0], data.clipProjects[0]] });
    await writeFile(documentFile(), duplicated);
    await expect(editor.save(owner, save(initial, { title: "Must not replace both rows" })))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(documentFile(), "utf8")).toBe(duplicated);
  });

  it("allows an explicit empty caption array and never silently restores cached source captions", async () => {
    const { editor } = await fixture();
    const result = await editor.save(owner, save(await editor.load(owner, "project-1"), { captions: [] }));
    expect(result.snapshot!.project.captions).toEqual([]);
    expect((await disk()).clipProjects[0].captions).toEqual([]);
    expect(result.snapshot!.cachedCaptions.captions).toHaveLength(1);
  });

  it("redacts legacy internal asset references and preserves them while saving audio-level edits", async () => {
    const { editor, data } = await fixture();
    data.clipProjects[0].audio.musicSrc = "C:\\fixture-private\\original.wav";
    data.clipProjects[0].audio.musicName = "C:\\fixture-private\\original.wav";
    await writeFile(documentFile(), JSON.stringify(data));
    const initial = await editor.load(owner, "project-1");
    expect(JSON.stringify(initial)).not.toContain("fixture-private");
    await editor.save(owner, save(initial, { audio: { ...initial.project.audio, clipVolume: 1.2 } }));
    const saved = (await disk()).clipProjects[0];
    expect(saved.audio.clipVolume).toBe(1.2);
    expect(saved.audio.musicSrc).toBe(data.clipProjects[0].audio.musicSrc);
    expect(saved.audio.musicName).toBe(data.clipProjects[0].audio.musicName);
  });

  it("retains receipts across original document writes and invalidates revision/export after a legacy edit", async () => {
    const { editor, data } = await fixture();
    const requested = await editor.requestExport(owner, request(await editor.load(owner, "project-1")));
    const latest = await store.readAppData();
    const before = latest.clipProjects[0].marketingEditor!;
    await store.writeAppData({ ...latest, clipProjects: latest.clipProjects.map((project) => ({ ...project, title: "Changed in original editor" })) });
    const current = await editor.load(owner, "project-1");
    expect(current.target.revision).toBe(before.revision + 1);
    expect(current.export.state).toBe("stale");
    expect((await disk()).clipProjects[0].marketingEditor.receipts[0].result).toEqual(requested.receipt);
    // An original app document loaded before enrollment cannot erase a newer
    // editor save, its enrollment, or its durable command history.
    await expect(store.writeAppData(data)).rejects.toMatchObject({ name: "ManagedEditorWriteConflictError" });
    expect((await disk()).clipProjects[0].title).toBe("Changed in original editor");
  });

  it("keeps managed deletion tombstones and receipts in the original record", async () => {
    const { editor } = await fixture();
    await editor.requestExport(owner, request(await editor.load(owner, "project-1")));
    await store.mutateAppData((data) => ({ ...data, clipProjects: [] }));
    const project = (await disk()).clipProjects[0];
    expect(project.marketingEditor.deletedAt).toEqual(expect.any(String));
    expect(project.marketingEditor.receipts).toHaveLength(1);
    expect(await editor.list(owner)).toEqual([]);
    await expect(editor.load(owner, "project-1")).rejects.toMatchObject({ code: "not_found" });
  });

  it("supports original locked in-place mutators while disk retains receipt authority", async () => {
    const { editor } = await fixture();
    const saved = await editor.save(owner, save(await editor.load(owner, "project-1"), { title: "Saved title" }));
    await store.mutateAppData((data) => {
      data.clipProjects[0].title = "Original in-place change";
      data.clipProjects[0].marketingEditor!.receipts = [];
      return data;
    });
    const current = await editor.load(owner, "project-1");
    expect(current.project.title).toBe("Original in-place change");
    expect(current.target.revision).toBe(saved.receipt.revision + 1);
    expect((await disk()).clipProjects[0].marketingEditor.receipts[0].result).toEqual(saved.receipt);
  });
});

describe("explicit export preparation contract", () => {
  it("replays a durable worker claim after deletion without rebinding a renderer or reading the source", async () => {
    const { editor: original } = await fixture();
    const ports = { getWorkerEpoch: () => workerEpoch, assertPreparationOnly: vi.fn(), readPreparation: vi.fn(async () => null) };
    const editor = new api.MarketingEditor({ binding, worker: ports });
    const pending = await editor.requestExport(owner, request(await original.load(owner, "project-1")));
    const command = { operation: "claim_editor_export" as const, commandId: randomUUID(),
      target: pending.snapshot!.target, requestId: pending.receipt.requestId! };
    const claimed = await editor.claimExport(worker, command);
    await store.mutateAppData((data) => ({ ...data, clipProjects: [] }));
    const restarted = new api.MarketingEditor({ binding });
    const replay = await restarted.claimExport(worker, command);
    expect(replay.receipt).toEqual(claimed.receipt);
    expect(replay.attemptId).toBe(claimed.attemptId);
    expect(replay.snapshot).toBeNull();
    expect(replay.reconciliation).toEqual({ state: "deleted" });
    expect(ports.assertPreparationOnly).toHaveBeenCalledTimes(1);
  });
  it("records and replays only a pending intent with no renderer, enqueue or media write", async () => {
    const { editor } = await fixture();
    const command = request(await editor.load(owner, "project-1"));
    const first = await editor.requestExport(owner, command);
    expect(first.snapshot!.export).toEqual({ state: "pending_dispatch", requestId: command.commandId });
    expect((await editor.requestExport(owner, command)).receipt).toEqual(first.receipt);
    expect((await disk()).clipProjects[0].marketingEditor.exports).toHaveLength(1);
    await expect(editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(),
      target: first.snapshot!.target, requestId: command.commandId })).rejects.toMatchObject({ code: "unavailable" });
    expect((await disk()).clipProjects[0].marketingEditor.exports[0].state).toBe("pending_dispatch");
    expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(await readdir(path.join(root, "clips"))).toEqual(["jobs.json"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires separately bound worker authority and independent exact-attempt preparation proof", async () => {
    await fixture();
    const assertCurrent = vi.fn();
    const ports = { getWorkerEpoch: () => workerEpoch, assertPreparationOnly: vi.fn(), readPreparation: vi.fn(async () => null as import("./editor").EditorPreparationEvidence | null) };
    const editor = new api.MarketingEditor({ binding, worker: ports });
    const pending = await editor.requestExport(owner, request(await editor.load(owner, "project-1")));
    const claim = { operation: "claim_editor_export" as const, commandId: randomUUID(), target: pending.snapshot!.target, requestId: pending.receipt.requestId! };
    await expect(editor.claimExport(owner, claim)).rejects.toMatchObject({ code: "forbidden" });
    const claimed = await editor.claimExport(worker, claim);
    expect(claimed.snapshot!.export.state).toBe("claimed");
    expect((await editor.claimExport(worker, claim)).attemptId).toBe(claimed.attemptId);
    const outcome = { operation: "record_editor_export_outcome" as const, commandId: randomUUID(), target: claimed.snapshot!.target,
      requestId: claim.requestId, attemptId: claimed.attemptId, outcome: "prepared" as const };
    await expect(editor.recordExportOutcome(worker, outcome)).rejects.toMatchObject({ code: "conflict" });
    ports.readPreparation.mockResolvedValue({ requestId: claim.requestId, attemptId: claimed.attemptId,
      digest: claimed.snapshot!.target.digest, renderSignature: claimed.snapshot!.target.renderSignature,
      exportId: "fixture-export", artifactSha256: "a".repeat(64), assertCurrent });
    const prepared = await editor.recordExportOutcome(worker, outcome);
    expect(prepared.snapshot!.export.state).toBe("prepared");
    expect(prepared.snapshot!.publicationAuthorized).toBe(false);
    expect(assertCurrent).toHaveBeenCalledTimes(1);
    ports.readPreparation.mockResolvedValue(null);
    expect((await editor.recordExportOutcome(worker, outcome)).receipt).toEqual(prepared.receipt);
  });

  it("refuses stale worker outcomes after a caption edit and never treats a client report as proof", async () => {
    await fixture();
    const ports = { getWorkerEpoch: () => workerEpoch, assertPreparationOnly: vi.fn(), readPreparation: vi.fn(async () => null) };
    const editor = new api.MarketingEditor({ binding, worker: ports });
    const pending = await editor.requestExport(owner, request(await editor.load(owner, "project-1")));
    const claimed = await editor.claimExport(worker, { operation: "claim_editor_export", commandId: randomUUID(),
      target: pending.snapshot!.target, requestId: pending.receipt.requestId! });
    await editor.save(owner, save(await editor.load(owner, "project-1"), { captionsVisible: false }));
    await expect(editor.recordExportOutcome(worker, { operation: "record_editor_export_outcome", commandId: randomUUID(),
      target: claimed.snapshot!.target, requestId: pending.receipt.requestId!, attemptId: claimed.attemptId, outcome: "prepared" }))
      .rejects.toMatchObject({ code: "conflict" });
    expect((await editor.load(owner, "project-1")).export.state).toBe("stale");
  });
});
