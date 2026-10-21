import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "./safety";

const owner: Principal = { ownerId: "synthetic-owner", scopes: ["read", "write", "review"] };
let root: string;
let dispose: (() => void) | undefined;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marketing-composition-"));
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Synthetic composition forbids external network"); }));
});
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture(realRender = false) {
  const { clipProjectSchema, appDataSchema } = await import("@/lib/storage/schemas");
  const { emptyData } = await import("@/lib/mockData/seed");
  const project = clipProjectSchema.parse({ id: "project-a", name: "Synthetic corrected clip", jobId: "job-a", sourceFile: "master.mp4",
    sourceUrl: "https://example.invalid/private?token=fixture", baseDurationSec: 10, clipStart: 20, clipEnd: 30,
    trimStart: 0, trimEnd: 10, captions: [{ id: "caption-a", start: 1, end: 3, text: "Corrected caption", words: [], enabled: true }],
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" });
  if (realRender) {
    project.baseDurationSec = 1.6; project.clipEnd = 21.6; project.trimStart = 0.2; project.trimEnd = 1.2;
    project.baseWidth = 160; project.baseHeight = 90; project.compositionMode = "fit";
    project.captions = [{ id: "caption-a", start: 0.2, end: 1.2, text: "SYNTHETIC EDITOR", words: [], enabled: true }];
    project.exportSettings = { ...project.exportSettings, width: 160, height: 160, fps: 10, filename: "synthetic-proof" };
  }
  const document = path.join(root, "capital-command.json");
  const jobs = path.join(root, "clips", "jobs.json");
  const output = path.join(root, "clips", "outputs", "job-a");
  await mkdir(output, { recursive: true });
  await writeFile(document, JSON.stringify(appDataSchema.parse({ ...emptyData, clipProjects: [project] })));
  await writeFile(jobs, JSON.stringify([{ id: "job-a", fileName: "Synthetic source", status: "queued", stage: "downloading", progress: 12,
    notices: [], createdAt: project.createdAt, clips: [{ id: "clip-a", title: "Synthetic clip", start: project.clipStart, end: project.clipEnd, file: "master.mp4",
      score: 50, breakdown: { hook: 50, pacing: 50, standalone: 50, intensity: 50 }, rationale: "Synthetic" }],
    sourceCaptions: [{ id: "cached", start: 21, end: 23, text: "Cached source", words: [], enabled: true }] }]));
  await writeFile(path.join(output, "master.mp4"), "0123456789");
  const { MarketingEditor, readOriginalEditorJob } = await import("./editor");
  let worker: ReturnType<typeof import("./editor-renderer").createEditorPreparationWorker> | undefined;
  if (realRender) {
    const { runFfmpeg } = await import("@/lib/clipping/ffmpeg");
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=10:d=1.6", "-f", "lavfi", "-i",
      "sine=frequency=440:sample_rate=48000:duration=1.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(output, "master.mp4")]);
    const { createEditorPreparationWorker } = await import("./editor-renderer");
    const { readExistingAppData } = await import("@/lib/storage/store");
    worker = createEditorPreparationWorker({ binding: { ownerId: owner.ownerId, records: [{ projectId: project.id,
      jobId: project.jobId, clipId: "clip-a", sourceFile: project.sourceFile,
      sourceSha256: createHash("sha256").update(await readFile(path.join(output, "master.mp4"))).digest("hex") }] },
      store: { read: readExistingAppData, readJob: readOriginalEditorJob } });
  }
  const { createExistingRecordReader } = await import("./records");
  const { composeMarketingParity } = await import("./composition");
  const { installMarketingRuntime, marketingRuntime } = await import("./runtime");
  const { isSameOriginLoopbackMutation } = await import("./auth");
  const base = { workspace: vi.fn(async () => ({ connection: { state: "connected", message: "Synthetic original ledger" }, jobs: [], sources: [] })), execute: vi.fn() };
  const records = createExistingRecordReader({ resolveScope: (id) => id === owner.ownerId ? {
    ownerId: id, sourceIds: [], runIds: [], clipJobIds: ["job-a"], queueIds: [], accountIds: {},
  } : null });
  const editor = new MarketingEditor({ worker, binding: { ownerId: owner.ownerId,
    records: [{ projectId: project.id, jobId: project.jobId, clipId: "clip-a", sourceFile: project.sourceFile }] } });
  const composed = composeMarketingParity({ ownerId: owner.ownerId, base, records, editor, preparedEditorMedia: worker });
  dispose = installMarketingRuntime({ ...composed, originAllowed: isSameOriginLoopbackMutation,
    authenticate: (req) => req.headers.get("x-fixture-user") === "owner" ? owner
      : req.headers.get("x-fixture-user") === "other" ? { ...owner, ownerId: "other-owner" } : null });
  return { project, document, jobs, base, records, editor, worker, handlers: marketingRuntime()! };
}
const request = (pathName = "workspace", user = "owner") => new Request(`http://127.0.0.1:3100/api/integrations/marketing/${pathName}`, { headers: { "x-fixture-user": user } });
const command = (body: unknown, user = "owner") => new Request("http://127.0.0.1:3100/api/integrations/marketing/operations", {
  method: "POST", headers: { "x-fixture-user": user, "Content-Type": "application/json", Origin: "http://127.0.0.1:3100" }, body: JSON.stringify(body),
});

describe("composed original records/editor/media HTTP boundary", () => {
  it.each(["svg", "local_audio"] as const)("refuses an incomplete %s asset preview without mutating the original project", async (kind) => {
    const f = await fixture();
    const data = JSON.parse(await readFile(f.document, "utf8"));
    if (kind === "svg") data.clipProjects[0].overlays = [{ id: "overlay-a", kind: "image", src: "data:image/svg+xml;base64,PHN2Zy8+", x: 0.5, y: 0.5, width: 0.25, scale: 1, start: 0, end: 10, rotation: 0, opacity: 1 }];
    else data.clipProjects[0].audio.musicSrc = "C:\\synthetic-private\\music.wav";
    await writeFile(f.document, JSON.stringify(data));
    const before = await readFile(f.document, "utf8");
    const jobsBefore = await readFile(f.jobs, "utf8");
    const internal = await f.editor.load(owner, f.project.id);
    expect(internal.requiresAssetConnection).toBe(true);
    expect(JSON.stringify(internal)).not.toContain("synthetic-private");
    const loaded = await f.handlers.editor(request("editor/project-a"), "project-a");
    expect(loaded.status).toBe(503);
    for (const operation of ["save_editor_project", "request_editor_export"]) {
      const response = await f.handlers.operations(command({ operation, commandId: randomUUID(), target: internal.target,
        ...(operation === "save_editor_project" ? { project: internal.project } : {}) }));
      expect(response.status).toBe(503);
      expect((await response.json()).error.outcome).toBe("failed");
    }
    expect(await readFile(f.document, "utf8")).toBe(before);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore);
    const workspace = await (await f.handlers.workspace(request())).json();
    const deleted = await f.handlers.operations(command({ operation: "delete_editor_project", commandId: randomUUID(), target: workspace.editorProjects[0].deleteTarget }));
    expect(deleted.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renders a captioned original project through the trusted worker and streams verified prepared bytes without job attachment", async () => {
    vi.stubEnv("PUBLISH_ENABLED", "true"); vi.stubEnv("PUBLISH_AUTO_ENQUEUE", "true");
    const f = await fixture(true);
    const jobsBefore = await readFile(f.jobs, "utf8");
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const exported = await (await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: snapshot.target }))).json();
    const workerPrincipal: Principal = { ownerId: owner.ownerId, scopes: ["worker"] };
    const requestId = exported.receipt.requestId;
    const claimed = await f.editor.claimExport(workerPrincipal, { operation: "claim_editor_export", commandId: randomUUID(), target: snapshot.target, requestId });
    const proof = await f.worker!.prepare(f.project.id, requestId, claimed.attemptId);
    await f.editor.recordExportOutcome(workerPrincipal, { operation: "record_editor_export_outcome", commandId: randomUUID(),
      target: snapshot.target, requestId, attemptId: claimed.attemptId, outcome: "prepared" });
    const prepared = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    expect(prepared.export.state).toBe("prepared");
    expect(prepared.media.edited).toMatchObject({ current: true, renderSignature: snapshot.target.renderSignature });
    expect(prepared.media.edited.mediaId).toBe(`prepared:project-a:${requestId}`);
    const media = await f.handlers.media(request("media/opaque"), prepared.media.edited.mediaId);
    expect(media.status).toBe(200);
    expect(createHash("sha256").update(new Uint8Array(await media.arrayBuffer())).digest("hex")).toBe(proof.artifactSha256);
    expect((await f.handlers.media(request("media/opaque", "other"), prepared.media.edited.mediaId)).status).toBe(403);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore);
    expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(fetch).not.toHaveBeenCalled();
    const deletion = { operation: "delete_editor_project", commandId: randomUUID(), target: prepared.target };
    const deleted = await f.handlers.operations(command(deletion));
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ snapshot: null, reconciliation: { state: "deleted" } });
    expect((await f.handlers.media(request("media/opaque"), prepared.media.edited.mediaId)).status).toBe(404);
    expect((await f.handlers.editor(request("editor/project-a"), "project-a")).status).toBe(404);
    const replay = await (await f.handlers.operations(command(deletion))).json();
    expect(replay).toMatchObject({ replayed: true, snapshot: null, reconciliation: { state: "deleted" } });
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore);
  }, 60_000);

  it("deletes an explicitly scoped orphan through HTTP without media preflight or touching its original jobs", async () => {
    const f = await fixture();
    await writeFile(f.jobs, "[]");
    const workspace = await (await f.handlers.workspace(request())).json();
    const target = workspace.editorProjects[0].deleteTarget;
    expect(target.projectId).toBe("project-a");
    const deletion = { operation: "delete_editor_project", commandId: randomUUID(), target };
    expect((await f.handlers.operations(command(deletion, "other"))).status).toBe(403);
    const firstResponse = await f.handlers.operations(command(deletion));
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first).toMatchObject({ snapshot: null, reconciliation: { state: "deleted" }, receipt: { revision: target.revision + 1 } });
    const replay = await (await f.handlers.operations(command(deletion))).json();
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay.replayed).toBe(true);
    expect((await (await f.handlers.workspace(request())).json()).editorProjects).toEqual([]);
    expect(await readFile(f.jobs, "utf8")).toBe("[]");
    expect(await readdir(root)).not.toContain("publish-queue.json");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passively projects original saved clips, captions and range media without worker initialization or mutation", async () => {
    const f = await fixture();
    const before = await readFile(f.document, "utf8");
    const jobsBefore = await readFile(f.jobs, "utf8");
    const workspace = await (await f.handlers.workspace(request())).json();
    expect(workspace.records.clipJobs[0]).toMatchObject({ status: "queued", progress: 12 });
    expect(workspace.editorProjects).toHaveLength(1);
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    expect(snapshot.project.captions[0].text).toBe("Corrected caption");
    expect(snapshot.cachedCaptions.captions[0].text).toBe("Cached source");
    expect(snapshot.media.source).toEqual({ mediaId: "clip:job-a:clip-a:clip_master", url: "/api/marketing/media/clip%3Ajob-a%3Aclip-a%3Aclip_master" });
    expect(JSON.stringify(snapshot)).not.toContain("token=fixture");
    const ranged = request("media/opaque"); ranged.headers.set("Range", "bytes=2-5");
    const response = await f.handlers.media(ranged, snapshot.media.source.mediaId);
    expect(response.status).toBe(206); expect(await response.text()).toBe("2345");
    const head = await f.handlers.media(new Request(ranged, { method: "HEAD" }), snapshot.media.source.mediaId);
    expect(head.status).toBe(206); expect(await head.text()).toBe("");
    expect(await readFile(f.document, "utf8")).toBe(before);
    expect(await readFile(f.jobs, "utf8")).toBe(jobsBefore);
    expect(await readdir(root)).toEqual(["capital-command.json", "clips"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads, edits full captions, saves once, replays and requests export in the same original project", async () => {
    const f = await fixture();
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const save = { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, captions: [{ ...snapshot.project.captions[0], text: "Precisely edited", start: 1.25 }] } };
    const firstResponse = await f.handlers.operations(command(save));
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json();
    expect(first.snapshot.target.revision).toBe(1);
    const replay = await (await f.handlers.operations(command(save))).json();
    expect(replay.replayed).toBe(true); expect(replay.receipt).toEqual(first.receipt);
    expect((await f.handlers.operations(command({ ...save, commandId: randomUUID() }))).status).toBe(409);
    const exportResult = await (await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: first.snapshot.target }))).json();
    expect(exportResult.snapshot.export.state).toBe("pending_dispatch");
    expect(exportResult.snapshot.publicationAuthorized).toBe(false);
    const disk = JSON.parse(await readFile(f.document, "utf8"));
    expect(disk.clipProjects).toHaveLength(1);
    expect(disk.clipProjects[0].captions[0].text).toBe("Precisely edited");
    expect(disk.clipProjects[0].marketingEditor.receipts).toHaveLength(2);
    expect(JSON.parse(await readFile(f.jobs, "utf8"))[0].status).toBe("queued");
    expect(f.base.execute).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects foreign access, injected worker operations and client owner authority before modifying records", async () => {
    const f = await fixture(); const before = await readFile(f.document, "utf8");
    expect((await f.handlers.workspace(request("workspace", "other"))).status).toBe(403);
    expect((await f.handlers.editor(request("editor/project-a", "other"), "project-a")).status).toBe(403);
    expect((await f.handlers.media(request("media/opaque", "other"), "clip:job-a:clip-a:clip_master")).status).toBe(403);
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    for (const operation of ["claim_editor_export", "record_editor_export_outcome", "startExport", "publish"]) {
      expect((await f.handlers.operations(command({ operation, commandId: randomUUID(), target: snapshot.target }))).status).toBe(400);
    }
    expect((await f.handlers.operations(command({ operation: "request_editor_export", commandId: randomUUID(), target: { ...snapshot.target, ownerId: owner.ownerId } }))).status).toBe(400);
    expect(await readFile(f.document, "utf8")).toBe(before);
  });

  it("preserves uncertain command identity when preview scope changes after a committed save", async () => {
    const f = await fixture();
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const save = { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, title: "Recorded before preview failure" } };
    const media = vi.spyOn(f.records, "mediaId");
    media.mockResolvedValueOnce("clip:job-a:clip-a:clip_master").mockResolvedValueOnce(null);
    const response = await f.handlers.operations(command(save));
    expect(response.status).toBe(503);
    expect((await response.json()).error.outcome).toBe("uncertain");
    expect(JSON.parse(await readFile(f.document, "utf8")).clipProjects[0].marketingEditor.receipts).toHaveLength(1);
    media.mockRestore();
    const replay = await (await f.handlers.operations(command(save))).json();
    expect(replay.replayed).toBe(true); expect(replay.receipt.commandId).toBe(save.commandId);
  });

  it("reconciles a recorded save even after its original job/media is removed", async () => {
    const f = await fixture();
    const snapshot = await (await f.handlers.editor(request("editor/project-a"), "project-a")).json();
    const save = { operation: "save_editor_project", commandId: randomUUID(), target: snapshot.target,
      project: { ...snapshot.project, title: "Durable command receipt" } };
    const first = await (await f.handlers.operations(command(save))).json();
    await writeFile(f.jobs, "[]");
    const before = await readFile(f.document, "utf8");
    const replay = await f.handlers.operations(command(save));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ receipt: first.receipt, replayed: true, snapshot: null,
      reconciliation: { state: "record_unavailable" } });
    expect(await readFile(f.document, "utf8")).toBe(before);
    expect((await f.handlers.operations(command({ ...save, commandId: randomUUID() }))).status).not.toBe(200);
  });

  it("fails closed on a malformed original store and unconfigured preparation", async () => {
    const f = await fixture();
    expect((await f.handlers.operations(command({ operation: "prepare_source", commandId: randomUUID(), runId: `site-${randomUUID()}`, expectedRevision: 1, sourceId: "source-a" }))).status).toBe(503);
    await writeFile(f.jobs, "malformed original data");
    const workspace = await (await f.handlers.workspace(request())).json();
    expect(workspace.records.stores).toContainEqual({ store: "clip_jobs", state: "unavailable", reason: "malformed" });
    expect((await f.handlers.editor(request("editor/project-a"), "project-a")).status).toBe(503);
    expect(await readFile(f.jobs, "utf8")).toBe("malformed original data");
  });
});
