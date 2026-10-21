import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ClipProject } from "@/types/domain";
import type { ClipJob } from "@/lib/clipping/types";
import type { EditorCreationPolicy, CreateEditorProjectFromSourceCommand, EditorSnapshot } from "./editor-types";
import type { Principal } from "./safety";
vi.mock("node:fs", async (original) => { const actual = await original<typeof import("node:fs")>(); return { ...actual, readSync: vi.fn(actual.readSync) }; });
vi.mock("node:fs/promises", async (original) => { const actual = await original<typeof import("node:fs/promises")>(); return { ...actual, rename: vi.fn(actual.rename) }; });

const owner: Principal = { ownerId: "owner-one", scopes: ["read", "write", "worker"] };
const binding = { ownerId: owner.ownerId, records: [{ projectId: "root-project", jobId: "job-one", clipId: "candidate-one", sourceFile: "master.mp4" }] };
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
let folder: string, oldData: string | undefined;
let api: typeof import("./editor"), store: typeof import("@/lib/storage/store"), stateApi: typeof import("./editor-state");
let policy: EditorCreationPolicy | null;
const document = () => path.join(folder, "capital-command.json");
const jobs = () => path.join(folder, "clips", "jobs.json");
const source = () => path.join(folder, "clips", "outputs", "job-one", "master.mp4");
const disk = async () => JSON.parse(await readFile(document(), "utf8"));
beforeEach(async () => {
  vi.mocked(fs.readSync).mockReset();
  vi.mocked((await import("node:fs/promises")).rename).mockReset();
  oldData = process.env.CAPITAL_COMMAND_DATA_DIR;
  folder = await mkdtemp(path.join(tmpdir(), "dormant-editor-creation-"));
  process.env.CAPITAL_COMMAND_DATA_DIR = folder;
  vi.resetModules();
  api = await import("./editor"); store = await import("@/lib/storage/store"); stateApi = await import("./editor-state");
  policy = { id: "explicit-fixture-policy", version: "v1", ownerId: owner.ownerId,
    roots: [{ ...binding.records[0], sourceSha256: sha("synthetic locally stored master"), maxCreatedProjects: 3 }] };
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("No network permitted by creation fixtures."); }));
});
afterEach(() => {
  if (oldData === undefined) delete process.env.CAPITAL_COMMAND_DATA_DIR; else process.env.CAPITAL_COMMAND_DATA_DIR = oldData;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function editor(extra: Partial<ConstructorParameters<typeof api.MarketingEditor>[0]> = {}) {
  return new api.MarketingEditor({ binding, creationPolicy: () => policy, ...extra });
}
async function fixture() {
  const { appDataSchema, clipProjectSchema } = await import("@/lib/storage/schemas");
  const { emptyData } = await import("@/lib/mockData/seed");
  const root = clipProjectSchema.parse({ id: "root-project", jobId: "job-one", sourceFile: "master.mp4", name: "Root manual name",
    sourceUrl: "upload://fixture", baseDurationSec: 10, clipStart: 20, clipEnd: 30,
    title: "Root manually edited title", captions: [{ id: "manual", text: "Root manual correction", start: 1, end: 4, words: [], enabled: true }],
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
  const unrelated = { ...root, id: "foreign-project", jobId: "foreign-job", name: "Unrelated record" };
  const data = appDataSchema.parse({ ...emptyData, clipProjects: [root, unrelated] });
  const job: ClipJob = { id: "job-one", fileName: "Stored fixture", sourceUrl: "upload://fixture", status: "done", stage: "finished", progress: 100,
    notices: [], createdAt: root.createdAt, clips: [{ id: "candidate-one", start: 20, end: 30, file: "master.mp4", title: "Original candidate title",
      sourceFrame: { width: 1920, height: 1080, fps: 30 }, score: 60, breakdown: { hook: 60, pacing: 60, standalone: 60, intensity: 60 }, rationale: "fixture" }],
    sourceCaptions: [{ id: "cached", text: "Original cached caption", start: 21, end: 24, words: [
      { text: "Original", start: 21, end: 22 }, { text: "cached", start: 22.1, end: 23 }, { text: "caption", start: 23.1, end: 24 }], enabled: true }] };
  await mkdir(path.dirname(source()), { recursive: true });
  await writeFile(source(), "synthetic locally stored master");
  await writeFile(document(), JSON.stringify(data)); await writeFile(jobs(), JSON.stringify([job]));
  return { root, unrelated, data, job };
}
async function command(instance = editor()): Promise<CreateEditorProjectFromSourceCommand> {
  const context = await instance.getCreationContext(owner, "root-project");
  expect(context).not.toBeNull();
  return { ...context!, operation: "create_editor_project_from_source", commandId: randomUUID() };
}
const save = (snapshot: EditorSnapshot, text: string) => ({ operation: "save_editor_project" as const, commandId: randomUUID(), target: snapshot.target,
  project: { ...snapshot.project, captions: snapshot.project.captions.map((row) => ({ ...row, text, words: [] })) } });

describe("dormant original-store create from source", () => {
  it("has no policy by default and refuses before job/media reads; foreign and sibling scope stay closed", async () => {
    await fixture(); const readJob = vi.fn(async () => { throw Error("Source must not be read."); });
    const noPolicy = editor({ creationPolicy: undefined, store: { read: store.readExistingAppData, mutate: store.mutateExistingClipProject, readJob, createFromRoot: store.createClipProjectFromRoot } });
    const valid = await command();
    expect(await noPolicy.getCreationContext(owner, "root-project")).toBeNull();
    await expect(noPolicy.createProjectFromSource(owner, valid)).rejects.toMatchObject({ code: "forbidden" });
    await expect(noPolicy.getCreationContext({ ...owner, ownerId: "foreign" }, "root-project")).rejects.toMatchObject({ code: "forbidden" });
    await expect(noPolicy.getCreationContext(owner, "foreign-project")).rejects.toMatchObject({ code: "forbidden" });
    expect(readJob).not.toHaveBeenCalled();
  });
  it("issues a passive frozen bounded context and creates exact original picker defaults in one ledger write", async () => {
    const { root, unrelated, job } = await fixture(); const instance = editor();
    const before = await readFile(document(), "utf8"), jobBefore = await readFile(jobs(), "utf8"), bytes = await readFile(source());
    const context = await instance.getCreationContext(owner, root.id);
    expect(Object.isFrozen(context)).toBe(true); expect(Object.isFrozen(context!.target)).toBe(true);
    expect(JSON.stringify(context)).not.toMatch(/upload:|master\.mp4|Stored fixture|Original cached/);
    expect(await readFile(document(), "utf8")).toBe(before);
    const cmd = { ...context!, operation: "create_editor_project_from_source" as const, commandId: randomUUID() };
    const result = await instance.createProjectFromSource(owner, cmd);
    expect(result).toMatchObject({ replayed: false, receipt: { reviewInvalidated: false, rootReviewPreserved: true, publicationAuthorized: false, creationRevision: 1 } });
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(result.createdProjectId).toMatch(/^clip-[a-f0-9-]{36}$/);
    const stored = await disk(); const child = stored.clipProjects.find((row: ClipProject) => row.id === result.createdProjectId);
    const { makeClipProject, generateClipTitle, makeTitleOverlay } = await import("@/lib/clipping/editor");
    const { windowSegments, chunkWords } = await import("@/lib/clipping/captions");
    const expected = makeClipProject({ jobId: job.id, name: `${job.fileName} - clip 1`, sourceFile: "master.mp4", sourceUrl: job.sourceUrl,
      clipStart: 20, clipEnd: 30, sourceFrame: job.clips[0].sourceFrame, output: job.output });
    const windowed = windowSegments(job.sourceCaptions!, 20, 30); const words = windowed.flatMap((row) => row.words);
    expected.captions = words.length ? chunkWords(words, expected.captionStyle.maxWordsPerCaption) : windowed;
    expected.title = job.clips[0].title || generateClipTitle(expected.captions, "Clip 1"); expected.name = expected.title;
    expected.overlays.push(makeTitleOverlay(expected));
    const normalize = (row: ClipProject) => { const { id: _id, createdAt: _at, updatedAt: _updated, marketingEditor: _private,
      renderSignature: _sig, captionCount: _count, ...value } = row; void [_id, _at, _updated, _private, _sig, _count]; return { ...value, overlays: value.overlays.map(({ id: _overlayId, ...overlay }) => { void _overlayId; return overlay; }) }; };
    expect(normalize(child)).toEqual(normalize(expected));
    expect(stored.clipProjects.find((row: ClipProject) => row.id === unrelated.id)).toEqual(unrelated);
    const { marketingEditor: _metadata, ...rootAfter } = stored.clipProjects.find((row: ClipProject) => row.id === root.id); void _metadata;
    expect(rootAfter).toEqual(root); expect(await readFile(jobs(), "utf8")).toBe(jobBefore); expect(await readFile(source())).toEqual(bytes);
    expect(fetch).not.toHaveBeenCalled();
    expect((await instance.load(owner, result.createdProjectId)).capabilities.requestExport).toBe(false);
    await expect(instance.requestExport(owner, { operation: "request_editor_export", commandId: randomUUID(), target: result.childTarget! })).rejects.toMatchObject({ code: "forbidden" });
    await expect(instance.claimExport(owner, { operation: "claim_editor_export", commandId: randomUUID(), target: result.childTarget!, requestId: randomUUID() })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("retains exact prepared root readiness and uncertainty/cancellation metadata, including after a subsequent normal save", async () => {
    await fixture(); const root = (await disk()).clipProjects[0];
    const digest = stateApi.editorProjectDigest(root), signature = stateApi.editorRenderSignature(root);
    root.marketingEditor = { ownerId: owner.ownerId, jobId: "job-one", clipId: "candidate-one", revision: 4, digest, renderSignature: signature, receipts: [], exports: [
      { requestId: randomUUID(), revision: 4, digest, renderSignature: signature, state: "prepared", exportId: "ready", artifactSha256: "a".repeat(64) },
      { requestId: randomUUID(), revision: 4, digest, renderSignature: signature, state: "uncertain", attemptId: randomUUID(), workerEpoch: randomUUID(),
        cancellation: { commandId: randomUUID(), requestedAt: "2026-10-01T01:00:00.000Z" } } ] };
    await store.writeAppData({ ...await disk(), clipProjects: [root, (await disk()).clipProjects[1]] }); // generic writer cannot enroll
    const original = await disk(); original.clipProjects[0] = root; await writeFile(document(), JSON.stringify(original));
    const created = await editor().createProjectFromSource(owner, await command());
    const after = (await disk()).clipProjects.find((row: ClipProject) => row.id === root.id);
    expect(after.marketingEditor.exports).toEqual(root.marketingEditor.exports); expect(after.marketingEditor.revision).toBe(4);
    const rootSnapshot = await editor().load(owner, root.id); await editor().save(owner, save(rootSnapshot, "New root correction"));
    const saved = (await disk()).clipProjects.find((row: ClipProject) => row.id === root.id);
    expect(saved.marketingEditor.creationRevision).toBe(1); expect(saved.marketingEditor.receipts[0].result).toEqual(created.receipt);
  });
  it("accepts the logical current target after a legacy content edit with a stale stored digest", async () => {
    await fixture(); const data = await disk(); const root = data.clipProjects[0];
    root.marketingEditor = { ownerId: owner.ownerId, jobId: "job-one", clipId: "candidate-one", revision: 2,
      digest: stateApi.editorProjectDigest(root), renderSignature: stateApi.editorRenderSignature(root), receipts: [], exports: [] };
    root.title = "Legacy edit after metadata"; await writeFile(document(), JSON.stringify(data));
    const cmd = await command(); expect(cmd.target.revision).toBe(3);
    await editor().createProjectFromSource(owner, cmd);
    const stored = (await disk()).clipProjects.find((row: ClipProject) => row.id === root.id);
    expect(stored.title).toBe(root.title); expect(stored.marketingEditor.revision).toBe(3); expect(stored.marketingEditor.digest).toBe(cmd.target.digest);
  });
  it("leaves unrelated managed metadata exactly unchanged even when its legacy digest is stale", async () => {
    await fixture(); const data = await disk(), unrelated = data.clipProjects[1];
    unrelated.marketingEditor = { ownerId: "different-owner", jobId: unrelated.jobId, clipId: "other-candidate", revision: 7,
      digest: "a".repeat(64), renderSignature: "old-stale-signature", receipts: [], exports: [] };
    unrelated.captionCount = 777; await writeFile(document(), JSON.stringify(data));
    await editor().createProjectFromSource(owner, await command());
    expect((await disk()).clipProjects.find((row: ClipProject) => row.id === unrelated.id)).toEqual(unrelated);
  });
  it("provides a final source/policy/target fence after asynchronous private projection", async () => {
    await fixture(); const instance = editor(); const created = await instance.createProjectFromSource(owner, await command());
    await expect(instance.assertSnapshotCurrent(owner, created.childTarget!)).resolves.toBeUndefined();
    policy = null;
    await expect(instance.assertSnapshotCurrent(owner, created.childTarget!)).rejects.toMatchObject({ code: "forbidden" });
    const root = await instance.load(owner, "root-project");
    await expect(instance.assertSnapshotCurrent(owner, root.target)).resolves.toBeUndefined();
    await instance.save(owner, save(root, "New projection target"));
    await expect(instance.assertSnapshotCurrent(owner, root.target)).rejects.toMatchObject({ code: "conflict" });
  });
  it("recovers an exact committed receipt after a lost response, restart, policy/source revocation and root deletion", async () => {
    await fixture(); const cmd = await command(); const first = await editor().createProjectFromSource(owner, cmd);
    const before = await readFile(document(), "utf8");
    policy = null; await unlink(source()); await unlink(jobs());
    const replay = await editor().createProjectFromSource(owner, cmd);
    expect(replay).toEqual({ receipt: first.receipt, replayed: true, createdProjectId: first.createdProjectId, childTarget: null, snapshot: null, reconciliation: { state: "policy_unavailable" } });
    expect(await readFile(document(), "utf8")).toBe(before);
    await expect(editor().load(owner, first.createdProjectId)).rejects.toMatchObject({ code: "forbidden" });
    const rootTarget = (await editor().list(owner))[0].deleteTarget;
    await editor().deleteProject(owner, { operation: "delete_editor_project", commandId: randomUUID(), target: rootTarget });
    expect((await editor().createProjectFromSource(owner, cmd)).receipt).toEqual(first.receipt);
    await expect(editor().createProjectFromSource(owner, { ...cmd, commandId: randomUUID() })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("serializes duplicate UUID replay and conflicts competing stale creation counters", async () => {
    await fixture(); const cmd = await command(); const instance = editor();
    const duplicate = await Promise.all([instance.createProjectFromSource(owner, cmd), instance.createProjectFromSource(owner, cmd)]);
    expect(new Set(duplicate.map((row) => row.createdProjectId)).size).toBe(1); expect(duplicate.map((row) => row.replayed).sort()).toEqual([false, true]);
    const next = await command(); const competing = await Promise.allSettled([instance.createProjectFromSource(owner, next), instance.createProjectFromSource(owner, { ...next, commandId: randomUUID() })]);
    expect(competing.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(competing.find((row) => row.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
    expect((await disk()).clipProjects).toHaveLength(4);
  });
  it("does not commit either row on actual atomic rename failure, and permits safe same-command retry", async () => {
    await fixture(); const cmd = await command(); const before = await readFile(document(), "utf8");
    const promises = await import("node:fs/promises"); const originalRename = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).rename;
    const rename = vi.mocked(promises.rename).mockImplementation(async (from, to) => { if (String(to) === document()) throw Object.assign(Error("synthetic replace failure"), { code: "EIO" }); return originalRename(from, to); });
    await expect(editor().createProjectFromSource(owner, cmd)).rejects.toThrow("synthetic replace failure");
    expect(await readFile(document(), "utf8")).toBe(before); rename.mockReset();
    expect((await editor().createProjectFromSource(owner, cmd)).replayed).toBe(false);
  });
  it("recovers after the store committed both rows but the caller lost its response", async () => {
    await fixture(); const cmd = await command();
    const instance = editor({ store: { read: store.readExistingAppData, mutate: store.mutateExistingClipProject, readJob: api.readOriginalEditorJob,
      createFromRoot: async (...args) => { await store.createClipProjectFromRoot(...args); throw Error("Synthetic lost commit response"); } } });
    await expect(instance.createProjectFromSource(owner, cmd)).rejects.toThrow("Synthetic lost commit response");
    const committed = await readFile(document(), "utf8"); policy = null;
    const replay = await editor().createProjectFromSource(owner, cmd);
    expect(replay.replayed).toBe(true); expect(replay.snapshot).toBeNull();
    expect((await disk()).clipProjects).toHaveLength(3); expect(await readFile(document(), "utf8")).toBe(committed);
  });
  it.each(["caption", "source", "policy", "root", "boundary"])("rejects changed %s after context without partial insert", async (kind) => {
    const { job } = await fixture(); const cmd = await command();
    if (kind === "caption") { job.sourceCaptions![0].text = "Refreshed cache"; await writeFile(jobs(), JSON.stringify([job])); }
    if (kind === "source") await writeFile(source(), "replacement source");
    if (kind === "policy") policy!.roots[0].maxCreatedProjects = 4;
    if (kind === "boundary") { job.clips[0].start = 19; await writeFile(jobs(), JSON.stringify([job])); }
    if (kind === "root") { const data = await disk(); data.clipProjects[0].title = "changed"; await writeFile(document(), JSON.stringify(data)); }
    const before = await readFile(document(), "utf8");
    await expect(editor().createProjectFromSource(owner, cmd)).rejects.toMatchObject({ code: "conflict" });
    expect(await readFile(document(), "utf8")).toBe(before);
  });
  it("rechecks current policy after async caption reads under the original lock", async () => {
    await fixture(); const cmd = await command(); let reads = 0;
    const instance = editor({ store: { read: store.readExistingAppData, mutate: store.mutateExistingClipProject, createFromRoot: store.createClipProjectFromRoot,
      readJob: async (id) => { const job = await api.readOriginalEditorJob(id); reads++; policy = null; return job; } } });
    const before = await readFile(document(), "utf8");
    await expect(instance.createProjectFromSource(owner, cmd)).rejects.toMatchObject({ code: "conflict" });
    expect(reads).toBe(1); expect(await readFile(document(), "utf8")).toBe(before);
  });
  it("refuses lock-time source/cache changes and revocation during the final hash", async () => {
    const { job } = await fixture(); const cmd = await command();
    for (const kind of ["source", "caption"] as const) {
      const instance = editor({ store: { read: store.readExistingAppData, mutate: store.mutateExistingClipProject, readJob: api.readOriginalEditorJob,
        createFromRoot: async (...args) => {
          if (kind === "source") await writeFile(source(), "changed just before lock");
          else { job.sourceCaptions![0].text = "Changed just before lock"; await writeFile(jobs(), JSON.stringify([job])); }
          return store.createClipProjectFromRoot(...args);
        } } });
      const before = await readFile(document(), "utf8");
      await expect(instance.createProjectFromSource(owner, cmd)).rejects.toMatchObject({ code: "conflict" });
      expect(await readFile(document(), "utf8")).toBe(before);
      await writeFile(source(), "synthetic locally stored master");
    }
    job.sourceCaptions![0].text = "Original cached caption"; await writeFile(jobs(), JSON.stringify([job]));
    const originalRead = (await vi.importActual<typeof import("node:fs")>("node:fs")).readSync;
    let scans = 0;
    vi.mocked(fs.readSync).mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const count = (originalRead as (...params: unknown[]) => number)(...args);
      if (count && ++scans === 3) policy = null; // final original-store precommit scan
      return count;
    }) as typeof fs.readSync);
    const before = await readFile(document(), "utf8");
    await expect(editor().createProjectFromSource(owner, cmd)).rejects.toMatchObject({ code: "conflict" });
    expect(scans).toBe(3); expect(await readFile(document(), "utf8")).toBe(before);
  });
  it("keeps corrected child captions on reopen after cached transcript refresh and during normal child saves", async () => {
    const { job } = await fixture(); const instance = editor(); const created = await instance.createProjectFromSource(owner, await command());
    await instance.save(owner, save(created.snapshot!, "Child manual correction"));
    job.sourceCaptions![0].text = "Entirely new cached transcript"; job.sourceCaptions![0].words = [];
    await writeFile(jobs(), JSON.stringify([job]));
    const reopened = await instance.load(owner, created.createdProjectId);
    expect(reopened.project.captions[0].text).toBe("Child manual correction");
    expect(reopened.cachedCaptions.captions[0].text).toBe("Entirely new cached transcript");
    await instance.save(owner, save(reopened, "Second manual correction"));
    expect((await instance.load(owner, created.createdProjectId)).project.captions[0].text).toBe("Second manual correction");
    const child = (await disk()).clipProjects.find((row: ClipProject) => row.id === created.createdProjectId);
    expect(child.marketingEditor.creation.captionDigest).toBe(created.receipt.captionDigest);
    expect((await instance.list(owner)).map((row) => row.id)).toContain(created.createdProjectId);
  });
  it.each(["policy", "root", "receipt", "source"])("closes derived child read/save when current %s authority changes", async (kind) => {
    await fixture(); const created = await editor().createProjectFromSource(owner, await command());
    const data = await disk(); const root = data.clipProjects.find((row: ClipProject) => row.id === "root-project");
    if (kind === "policy") policy!.roots[0].maxCreatedProjects = 4;
    if (kind === "root") root.marketingEditor.deletedAt = "2026-10-01T01:00:00Z";
    if (kind === "receipt") root.marketingEditor.receipts[0].result.captionDigest = "b".repeat(64);
    if (kind === "source") await writeFile(source(), "changed");
    await writeFile(document(), JSON.stringify(data)); const before = await readFile(document(), "utf8");
    await expect(editor().load(owner, created.createdProjectId)).rejects.toThrow();
    await expect(editor().save(owner, save(created.snapshot!, "Forbidden correction"))).rejects.toThrow();
    expect(await readFile(document(), "utf8")).toBe(before);
  });
  it("revalidates derived reads after async job reads revoke policy or delete the actual root", async () => {
    await fixture(); const created = await editor().createProjectFromSource(owner, await command());
    const currentPolicy = structuredClone(policy);
    for (const kind of ["policy", "root"] as const) {
      policy = structuredClone(currentPolicy);
      const instance = editor({ store: { read: store.readExistingAppData, mutate: store.mutateExistingClipProject,
        readJob: async (id) => { const job = await api.readOriginalEditorJob(id); if (kind === "policy") policy = null;
          else { const data = await disk(); data.clipProjects.find((row: ClipProject) => row.id === "root-project").marketingEditor.deletedAt = "2026-10-01T01:00:00Z"; await writeFile(document(), JSON.stringify(data)); } return job; } } });
      await expect(instance.load(owner, created.createdProjectId)).rejects.toThrow();
    }
  });
  it("retains lifetime quota across child tombstones and prevents transitive roots", async () => {
    await fixture(); policy!.roots[0].maxCreatedProjects = 1;
    const instance = editor(); const cmd = await command(); const created = await instance.createProjectFromSource(owner, cmd);
    const deletion = { operation: "delete_editor_project" as const, commandId: randomUUID(), target: created.childTarget! };
    const deleted = await instance.deleteProject(owner, deletion);
    const before = await readFile(document(), "utf8");
    expect(await instance.deleteProject(owner, deletion)).toEqual({ ...deleted, replayed: true });
    await expect(instance.deleteProject(owner, { ...deletion, commandId: randomUUID() })).rejects.toThrow();
    expect(await readFile(document(), "utf8")).toBe(before);
    await expect(instance.getCreationContext(owner, "root-project")).rejects.toMatchObject({ code: "unavailable" });
    await expect(instance.getCreationContext(owner, created.createdProjectId)).rejects.toMatchObject({ code: "forbidden" });
    expect((await instance.createProjectFromSource(owner, cmd)).receipt).toEqual(created.receipt);
  });
  it("allows genuine absent captions but rejects malformed, failed, oversized, nonfinite cache and source metadata", async () => {
    const { job } = await fixture(); delete job.sourceCaptions;
    await writeFile(jobs(), JSON.stringify([job])); const cmd = await command(); expect(cmd.captionState).toBe("absent");
    const created = await editor().createProjectFromSource(owner, cmd); expect(created.snapshot!.project.captions).toEqual([]);
    for (const bad of [null, [{ id: "broken" }], [{ id: "bad", text: "bad", start: 4, end: 1, words: [], enabled: true }]]) {
      await writeFile(jobs(), JSON.stringify([{ ...job, sourceCaptions: bad }]));
      await expect(editor().getCreationContext(owner, "root-project")).rejects.toMatchObject({ code: "unavailable" });
    }
    await writeFile(jobs(), JSON.stringify([{ ...job, captionsError: "known cache failure" }]));
    await expect(editor().getCreationContext(owner, "root-project")).rejects.toMatchObject({ code: "unavailable" });
    await writeFile(jobs(), "{truncated"); await expect(editor().getCreationContext(owner, "root-project")).rejects.toMatchObject({ code: "unavailable" });
  });
  it.each(["rows", "words", "bytes", "frame", "output", "null-frame", "null-output", "timing"])("rejects bounded or malformed %s creation inputs", async (kind) => {
    const { job } = await fixture();
    if (kind === "rows") job.sourceCaptions = Array.from({ length: 20_001 }, () => job.sourceCaptions![0]);
    if (kind === "words") job.sourceCaptions![0].words = Array.from({ length: 100_001 }, () => ({ text: "x", start: 21, end: 22 }));
    if (kind === "bytes") job.sourceCaptions = Array.from({ length: 50 }, (_, index) => ({ id: `${index}`, text: "\u4e00".repeat(90_000), start: 21, end: 22, words: [], enabled: true }));
    if (kind === "frame") job.clips[0].sourceFrame!.fps = Infinity;
    if (kind === "null-frame") (job.clips[0] as unknown as { sourceFrame: null }).sourceFrame = null;
    if (kind === "null-output") (job as unknown as { output: null }).output = null;
    if (kind === "output") (job as unknown as { output: { resolution: string; frameRate: string } }).output = { resolution: "bogus", frameRate: "source" };
    if (kind === "timing") job.clips[0].end = Infinity;
    await writeFile(jobs(), JSON.stringify([job])); const before = await readFile(document(), "utf8");
    vi.mocked(fs.readSync).mockClear();
    await expect(editor().getCreationContext(owner, "root-project")).rejects.toThrow();
    expect(await readFile(document(), "utf8")).toBe(before);
    expect(fs.readSync).not.toHaveBeenCalled();
  });
  it("rejects cross-operation UUID reuse and prevents ordinary original writes from forging or erasing provenance", async () => {
    await fixture(); const instance = editor(); const cmd = await command(); const created = await instance.createProjectFromSource(owner, cmd);
    const root = await instance.load(owner, "root-project");
    await expect(instance.save(owner, { ...save(root, "reuse"), commandId: cmd.commandId })).rejects.toMatchObject({ code: "conflict" });
    const normal = await instance.save(owner, save(root, "normal root edit"));
    const next = await command(); await expect(instance.createProjectFromSource(owner, { ...next, commandId: normal.receipt.commandId })).rejects.toMatchObject({ code: "conflict" });
    const data = await store.readExistingAppData(); const child = data!.clipProjects.find((row) => row.id === created.createdProjectId)!;
    const provenance = structuredClone(child.marketingEditor!.creation);
    child.marketingEditor = undefined;
    data!.clipProjects.push({ ...structuredClone(child), id: "forged-new-child", marketingEditor: { ...(await disk()).clipProjects.find((row: ClipProject) => row.id === created.createdProjectId).marketingEditor } });
    await store.writeAppData(data!);
    const stored = await disk();
    expect(stored.clipProjects.find((row: ClipProject) => row.id === created.createdProjectId).marketingEditor.creation).toEqual(provenance);
    expect(stored.clipProjects.find((row: ClipProject) => row.id === "forged-new-child").marketingEditor).toBeUndefined();
    await expect(instance.load(owner, "forged-new-child")).rejects.toMatchObject({ code: "forbidden" });
    const stale = await store.readExistingAppData(); const staleRoot = stale!.clipProjects.find((row) => row.id === "root-project")!;
    staleRoot.marketingEditor!.creationRevision = 0;
    staleRoot.marketingEditor!.receipts = staleRoot.marketingEditor!.receipts.filter((entry) => entry.result.operation !== "create_editor_project_from_source");
    await store.writeAppData(stale!);
    await store.mutateAppData((current) => {
      const actualRoot = current.clipProjects.find((row) => row.id === "root-project")!;
      actualRoot.marketingEditor!.creationRevision = 0;
      actualRoot.marketingEditor!.receipts = [];
      current.clipProjects.find((row) => row.id === created.createdProjectId)!.marketingEditor!.creation = undefined;
      return current;
    });
    const preserved = await disk();
    expect(preserved.clipProjects.find((row: ClipProject) => row.id === "root-project").marketingEditor.creationRevision).toBe(1);
    expect(preserved.clipProjects.find((row: ClipProject) => row.id === "root-project").marketingEditor.receipts[0].result).toEqual(created.receipt);
    expect(preserved.clipProjects.find((row: ClipProject) => row.id === created.createdProjectId).marketingEditor.creation).toEqual(provenance);
  });
  it.each(["same", "changed"])("rejects a %s-byte source pathname replacement during hashing", async (kind) => {
    await fixture(); const originalRead = (await vi.importActual<typeof import("node:fs")>("node:fs")).readSync; let replaced = false;
    vi.mocked(fs.readSync).mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const count = (originalRead as (...params: unknown[]) => number)(...args);
      if (!replaced && count) { replaced = true; fs.renameSync(source(), `${source()}.old`); fs.writeFileSync(source(), kind === "same" ? "synthetic locally stored master" : "changed master"); }
      return count;
    }) as typeof fs.readSync);
    const before = await readFile(document(), "utf8");
    await expect(editor().getCreationContext(owner, "root-project")).rejects.toMatchObject({ code: "conflict" });
    expect(replaced).toBe(true); expect(await readFile(document(), "utf8")).toBe(before);
  });
});
