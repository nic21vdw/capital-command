import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "@/lib/paths";
import { createExistingRecordReader, existingDisplayText, type TrustedExistingRecordScope } from "./records";
import { createProtectedMediaReader } from "./media";

const owner = "synthetic-owner";
const at = "2026-10-20T12:00:00Z";
const scope = (): TrustedExistingRecordScope => ({ ownerId: owner, sourceIds: ["source-a"], runIds: ["run-a"], clipJobIds: ["job-a"], queueIds: ["queue-a"], exportIds: ["export-a"], accountIds: { youtube: ["youtube-primary"], instagram: ["instagram-primary"] } });
const source = { id: "source-a", fileName: "Synthetic stream.mp4", storedName: "source.mp4", mime: "video/mp4", durationSec: 125, width: 1920, height: 1080, sizeBytes: 10, hasAudio: true, createdAt: at };
const run = { id: "run-a", name: "Synthetic stream", status: "running", sourceId: source.id, clipJobId: "job-a", progress: 41, notices: [], createdAt: at, updatedAt: at, sourceUrl: "https://example.invalid/stream?token=hidden-link-secret", error: "raw hidden-run-secret C:\\private\\tokens.json" };
const clip = { id: "clip-a", start: 2, end: 20, score: 80, breakdown: { hook: 80, pacing: 80, standalone: 80, intensity: 80 }, rationale: "No need to expose this", title: "Useful synthetic clip", file: "master.mp4", previewFile: "preview.mp4", downloadFile: "ready.mp4", editedFile: "edited.mp4", posterFile: "poster.jpg", editedAt: at };
const job = { id: "job-a", fileName: "Synthetic stream", sourceId: source.id, sourceUrl: "upload://source-a", status: "queued", stage: "downloading", progress: 12, notices: [], createdAt: at, clips: [clip], sourceCaptions: [{ text: "hidden-transcript-secret" }], driveFolder: "C:\\private\\drive" };
const queueRow = () => ({ id: "queue-a", jobId: job.id, runId: run.id, title: "Useful caption", caption: "Caption stays useful. access_token=hidden-token-secret https://example.invalid/signed?sig=hidden-signed-secret C:\\private\\secret.json", clipPath: path.relative(process.cwd(), dataPath("clips", "outputs", job.id, "edited.mp4")), hashtags: [], publishAt: at, visibility: "public", createdAt: at, platforms: { youtube: { status: "published", attempts: 1, postId: "hidden-post-secret", publishedAt: at }, instagram: { status: "failed", attempts: 1, containerId: "hidden-container-secret", error: "hidden-error-secret" } } });
let root: string;
let temporary: string[];
async function json(segments: string[], value: unknown) {
  const file = dataPath(...segments);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
async function fixture() {
  await json(["clips", "sources", source.id, "meta.json"], source);
  await json(["pipeline", "runs.json"], [run, { ...run, id: "other-run", name: "hidden-owner-run" }]);
  await json(["clips", "jobs.json"], [job, { ...job, id: "other-job", fileName: "hidden-owner-job" }]);
  await json(["publish-queue.json"], [queueRow(), { ...queueRow(), id: "other-queue", title: "hidden-owner-queue" }]);
  const dir = dataPath("clips", "outputs", job.id);
  await mkdir(dir, { recursive: true });
  for (const name of ["master.mp4", "preview.mp4", "ready.mp4", "edited.mp4", "poster.jpg", "export.mp4"]) await writeFile(path.join(dir, name), "0123456789");
  await writeFile(dataPath("clips", "sources", source.id, "source.mp4"), "abcdefghij");
}
const exportRow = { id: "export-a", jobId: job.id, status: "done", file: "export.mp4", progress: 100, width: 1080, height: 1920, format: "mp4", createdAt: at };
const reader = (grant = scope()) => createExistingRecordReader({ resolveScope: (authenticatedOwner) => authenticatedOwner === owner ? grant : null, readClipExports: () => [exportRow] });
async function fingerprint(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await fingerprint(file));
    else { const info = await stat(file); result.push(`${path.relative(root, file)}:${info.size}:${info.mtimeMs}:${createHash("sha256").update(await readFile(file)).digest("hex")}`); }
  }
  return result.sort();
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "marketing-records-"));
  temporary = [root];
  vi.stubEnv("CAPITAL_COMMAND_DATA_DIR", root);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const directory of temporary) {
    // Every recursive removal stays inside the test's explicitly created temp roots.
    if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("marketing-records-")) throw new Error("Unexpected cleanup target");
    await rm(directory, { recursive: true, force: true });
  }
});

describe("passive existing records", () => {
  it("projects original per-clip outputs, exports and reported schedules without touching any original byte or timestamp", async () => {
    await fixture();
    const before = await fingerprint(root);
    const api = reader();
    const result = await api.read(owner);
    expect(result.connection.state).toBe("read_only");
    expect(result.sources[0]).toMatchObject({ id: source.id, title: source.fileName, media: { sourceType: "source", contentType: "video/mp4" } });
    expect(result.runs.map((row) => row.id)).toEqual([run.id]);
    // Loading the legacy jobs module would recover queued -> error. This read never does.
    expect(result.clipJobs[0]).toMatchObject({ id: job.id, status: "queued", progress: 12 });
    expect(result.clips[0]).toMatchObject({ id: clip.id, jobId: job.id, title: clip.title, start: 2, end: 20, status: "reported_ready" });
    expect(result.outputs.map((row) => row.kind)).toEqual(["clip_master", "clip_preview", "clip_ready", "clip_edited", "clip_poster"]);
    expect(result.exports.map((row) => row.id)).toEqual(["edited:job-a:clip-a", "export-a"]);
    expect(result.schedules.map((row) => row.status)).toEqual(["reported_published", "reconciliation_required"]);
    expect(result.schedules.every((row) => row.publishedUrlVerified === false)).toBe(true);
    expect(result.schedules[0].caption).toContain("Caption stays useful.");
    expect(result.clips[0].caption).toContain("Caption stays useful.");
    expect(JSON.stringify(result)).not.toMatch(/hidden-|C:\\|tokens\.json|master\.mp4|edited\.mp4|access_token|signed\?sig/);
    expect(await fingerprint(root)).toEqual(before);
    expect(await api.mediaId(owner, { jobId: job.id, fileName: "edited.mp4" })).toBe("clip:job-a:clip-a:clip_edited");
    expect(await api.mediaId(owner, { jobId: job.id, fileName: "export.mp4" })).toBe("export:export-a");
    await writeFile(dataPath("clips", "outputs", job.id, "unlisted.mp4"), "exists but not enrolled");
    expect(await api.mediaId(owner, { jobId: job.id, fileName: "unlisted.mp4" })).toBeNull();
    const response = await createProtectedMediaReader({ resolveMedia: api.resolveMedia })(owner, result.outputs[3].media.id, new Request("https://site.invalid/media", { headers: { range: "bytes=2-5" } }));
    expect(response.status).toBe(206);
    expect(await response.text()).toBe("2345");
  });

  it("does not enroll legacy rows by owner/account names or references, and conceals all records without permission", async () => {
    await fixture();
    const api = reader();
    expect((await api.read("other-owner")).connection.state).toBe("unavailable");
    expect(await api.resolveMedia("other-owner", "clip:job-a:clip-a:clip_edited")).toBeNull();
    expect(await api.mediaId("other-owner", { jobId: job.id, fileName: "edited.mp4" })).toBeNull();
    const onlyRun = scope(); onlyRun.sourceIds = []; onlyRun.clipJobIds = []; onlyRun.queueIds = []; onlyRun.exportIds = [];
    const result = await reader(onlyRun).read(owner);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].sourceId).toBeUndefined(); expect(result.runs[0].clipJobId).toBeUndefined();
    expect(result.sources).toEqual([]); expect(result.clips).toEqual([]); expect(result.schedules).toEqual([]);
    const noAccount = scope(); noAccount.accountIds = {};
    const noAccountResult = await reader(noAccount).read(owner);
    expect(noAccountResult.schedules).toEqual([]);
    expect(noAccountResult.stores.find((row) => row.store === "queue")?.state).toBe("not_requested");
    expect(await reader(noAccount).resolveMedia(owner, "queue:queue-a:youtube")).toBeNull();
  });

  it("requires matching server scope owner and safe IDs before any reads, including malformed/client-like grants", async () => {
    await fixture();
    for (const grant of [{ ...scope(), ownerId: "other" }, { ...scope(), sourceIds: ["../source-a"] }, { ...scope(), queueIds: ["queue-a", "queue-a"] }, { ...scope(), accountIds: { tiktok: ["../account"] } }]) {
      const result = await reader(grant).read(owner);
      expect(result.connection.state).toBe("unavailable"); expect(result.stores).toEqual([]);
    }
    const nullScope = createExistingRecordReader({ resolveScope: () => null });
    expect((await nullScope.read(owner)).sources).toEqual([]);
  });

  it("reports missing and unconfigured stores without creating directories or claiming an empty successful read", async () => {
    const result = await createExistingRecordReader({ resolveScope: () => scope() }).read(owner);
    expect(result.stores.filter((row) => row.state === "missing").map((row) => row.store)).toEqual(["runs", "clip_jobs", "queue", "sources"]);
    expect(result.stores.find((row) => row.store === "clip_exports")?.state).toBe("not_configured");
    expect(await readdir(root)).toEqual([]);
    vi.stubEnv("PUBLISH_QUEUE_BACKEND", "r2");
    expect((await reader().read(owner)).stores.find((row) => row.store === "queue")?.state).toBe("not_configured");
  });

  it.each(["{", JSON.stringify({ rows: [] }), JSON.stringify([null]), JSON.stringify([{ ...job, clips: [{ ...clip, end: -1 }] }]), JSON.stringify([job, job])])("fails closed on corrupt jobs: %s", async (contents) => {
    await fixture(); await writeFile(dataPath("clips", "jobs.json"), contents);
    const result = await reader().read(owner);
    expect(result.stores.find((row) => row.store === "clip_jobs")).toMatchObject({ state: "unavailable", reason: "malformed" });
    expect(result.clips).toEqual([]); expect(result.exports).toEqual([]);
    expect(await reader().resolveMedia(owner, "clip:job-a:clip-a:clip_edited")).toBeNull();
    expect(await readFile(dataPath("clips", "jobs.json"), "utf8")).toBe(contents);
  });

  it("does not turn unreadable stores or throwing snapshot seams into an empty loaded store", async () => {
    await mkdir(dataPath("clips", "jobs.json"), { recursive: true });
    const api = createExistingRecordReader({ resolveScope: () => scope(), readQueueSnapshot: () => { throw new Error("hidden-token-secret"); }, readClipExports: () => { throw new Error("hidden-export-secret"); } });
    const result = await api.read(owner);
    for (const store of ["clip_jobs", "queue", "clip_exports"]) expect(result.stores.find((row) => row.store === store)).toMatchObject({ state: "unavailable", reason: "unreadable" });
    expect(JSON.stringify(result)).not.toContain("hidden-");
  });

  it("fails closed independently for malformed run, source, queue and in-process export snapshots", async () => {
    await fixture();
    await json(["pipeline", "runs.json"], [{ ...run, status: "invented" }]);
    await json(["clips", "sources", source.id, "meta.json"], { ...source, id: "other-source" });
    await json(["publish-queue.json"], [{ ...queueRow(), platforms: { youtube: { status: "published", attempts: "1" } } }]);
    const api = createExistingRecordReader({ resolveScope: () => scope(), readClipExports: () => [{ ...exportRow, jobId: "../other" }] });
    const result = await api.read(owner);
    expect(result.runs).toEqual([]); expect(result.sources).toEqual([]); expect(result.schedules).toEqual([]);
    expect(result.exports.map((row) => row.id)).toEqual(["edited:job-a:clip-a"]);
    for (const store of ["runs", "sources", "queue", "clip_exports"]) expect(result.stores.find((row) => row.store === store)).toMatchObject({ state: "unavailable", reason: "malformed" });
    expect(result.clips).toHaveLength(1);
  });

  it("refuses oversized store files before reading or parsing them", async () => {
    await mkdir(dataPath("clips"), { recursive: true });
    await writeFile(dataPath("clips", "jobs.json"), "");
    await truncate(dataPath("clips", "jobs.json"), 128 * 1024 * 1024 + 1);
    const result = await reader().read(owner);
    expect(result.stores.find((row) => row.store === "clip_jobs")).toMatchObject({ state: "unavailable", reason: "too_large" });
    expect(result.clips).toEqual([]);
  });

  it("bounds projected clips/media and explicitly reports truncation", async () => {
    const grant = scope();
    grant.clipJobIds = Array.from({ length: 11 }, (_, index) => `job-${index}`);
    const jobs = grant.clipJobIds.map((jobId) => ({ ...job, id: jobId, clips: Array.from({ length: 500 }, (_, index) => ({ ...clip, id: `clip-${index}` })) }));
    await json(["clips", "jobs.json"], jobs);
    const result = await reader(grant).read(owner);
    expect(result.truncated).toBe(true);
    expect(result.clips).toHaveLength(5_000);
    expect(result.outputs).toHaveLength(5_000);
  });

  it("copies trusted in-process snapshots, enforces accounts and persisted managed owners, and never mutates input", async () => {
    await fixture();
    const rows = [queueRow()];
    rows[0].platforms.youtube.status = "pending";
    const before = JSON.stringify(rows);
    const api = createExistingRecordReader({ resolveScope: () => scope(), readQueueSnapshot: () => rows });
    const result = await api.read(owner);
    expect(result.schedules[0].status).toBe("reconciliation_required");
    expect(JSON.stringify(rows)).toBe(before);
    const foreign = createExistingRecordReader({ resolveScope: () => scope(), readQueueSnapshot: () => [{ ...queueRow(), marketing: { ownerId: "other-owner" } }] });
    expect((await foreign.read(owner)).schedules).toEqual([]);
    await json(["pipeline", "runs.json"], [{ ...run, marketingSource: { ownerId: "other-owner" } }]);
    expect((await api.read(owner)).runs).toEqual([]);
  });

  it.each(["../secret.mp4", "C:\\private\\secret.mp4", "/private/secret.mp4", "nested/secret.mp4", "file.mp4:stream", "https://example.invalid/private.mp4", "evil.svg", "file.mp4\u0000"]) ("never maps malicious candidate filename %s", async (file) => {
    await fixture();
    await json(["clips", "jobs.json"], [{ ...job, clips: [{ ...clip, file, downloadFile: undefined, editedFile: undefined, posterFile: undefined, previewFile: undefined }] }]);
    const api = reader();
    expect((await api.read(owner)).outputs).toEqual([]);
    expect(await api.mediaId(owner, { jobId: job.id, fileName: file })).toBeNull();
  });

  it("rejects source metadata reached through an outside directory junction", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "marketing-records-outside-")); temporary.push(outside);
    await writeFile(path.join(outside, "meta.json"), JSON.stringify(source));
    await mkdir(dataPath("clips", "sources"), { recursive: true });
    await symlink(outside, dataPath("clips", "sources", source.id), "junction");
    const result = await reader().read(owner);
    expect(result.sources).toEqual([]);
    expect(result.stores.find((row) => row.store === "sources")).toMatchObject({ state: "unavailable", reason: "outside_root" });
  });

  it("scrubs credential carriers, local paths and signed URLs from otherwise useful display copy", () => {
    const value = existingDisplayText('Good copy "access_token":"hidden-json-secret" /arbitrary/private.txt C:\\private\\clip.mp4 Bearer hidden-bearer-secret https://example.invalid/view?sig=hidden-query-secret');
    expect(value).toContain("Good copy");
    expect(value).not.toMatch(/hidden-|arbitrary|C:\\|sig=/);
  });

  it("has no runtime imports of lifecycle or write-capable original stores", async () => {
    const code = await readFile(path.join(process.cwd(), "src/lib/integrations/marketing/records.ts"), "utf8");
    const runtimeImports = code.split("\n").filter((line) => /^import\s+(?!type\b)/.test(line)).join("\n");
    expect(runtimeImports).not.toMatch(/clipping\/(jobs|sources|export)|pipeline\/runs|publisher\/(queue|store)|bootstrap|repair/);
  });
});
