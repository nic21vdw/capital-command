import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dataRoot } from "@/lib/paths";
import { PublishQueue } from "@/lib/publisher/queue";
import { FileQueueStore } from "@/lib/publisher/store";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";
import { GET } from "@/app/api/integrations/marketing/workspace/route";
import { POST } from "@/app/api/integrations/marketing/operations/route";
import { youtubeAdapter } from "@/lib/publisher/adapters/youtube";
import { isSameOriginLoopbackMutation } from "./auth";
import { createYouTubeArtifactReader } from "./artifacts";
import { fingerprintQueueItem, MarketingLedger } from "./ledger";
import { createMarketingService } from "./service";
import { installMarketingRuntime } from "./runtime";
import type { Principal } from "./safety";

const owner: Principal = { ownerId: "synthetic-owner", scopes: ["read", "write", "review"] };
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const request = (body: unknown, identity = "owner") => new Request("http://127.0.0.1:3100/api/integrations/marketing/operations", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:3100", "x-synthetic-session": identity }, body: JSON.stringify(body)
});

async function fixture() {
  const root = await mkdtemp(path.join(dataRoot(), "synthetic-adapter-"));
  const file = path.join(root, "synthetic.mp4");
  await writeFile(file, "synthetic artifact bytes only; render runtime is tested separately");
  const queueFile = path.join(root, "publish-queue.json");
  const queue = new PublishQueue(new FileQueueStore(queueFile), testConfig());
  const item = testItem({ id: "synthetic-output", clipPath: file, accountId: "synthetic-account", platformIds: ["youtube"], caption: "A synthetic caption", publishAt: "2099-10-24T12:00:00.000Z" });
  await queue.add(item);
  const readArtifact = createYouTubeArtifactReader({ projectRoot: root, mediaRoot: root });
  const ledger = new MarketingLedger(queue, { ownerId: owner.ownerId, allowedAccounts: { youtube: ["synthetic-account"] } }, { readArtifact });
  await ledger.adopt(owner, { commandId: "synthetic_enrollment_01", jobId: item.id, expectedFingerprint: fingerprintQueueItem(item) });
  const sources = await import("@/lib/pipeline/runs");
  const service = createMarketingService({ ownerId: owner.ownerId, ledger, sources, configuredDailyCap: null });
  dispose = installMarketingRuntime({ service, originAllowed: isSameOriginLoopbackMutation,
    authenticate: (req) => req.headers.get("x-synthetic-session") === "owner" ? owner
      : req.headers.get("x-synthetic-session") === "other" ? { ownerId: "another-owner", scopes: ["read", "write"] } : null });
  const fetch = vi.fn(() => { throw new Error("Synthetic adapter test forbids all external network"); });
  vi.stubGlobal("fetch", fetch);
  return { root, file, queueFile, queue, item, ledger, service, sources, readArtifact, fetch };
}

describe("actual route composition over the existing local records", () => {
  it("creates and replays a source, reads actual hashed output, reviews and requests edits durably", async () => {
    const f = await fixture();
    const create = { operation: "create_source", commandId: "synthetic_create_source_01", title: "Synthetic VOD", sourceUrl: "https://youtu.be/synthetic01" };
    const first = await (await POST(request(create))).json();
    const replay = await (await POST(request(create))).json();
    expect(first).toMatchObject({ ok: true, result: { persisted: true, status: "draft" } });
    expect(replay.result.id).toBe(first.result.id);
    expect(replay.result.replayed).toBe(true);
    const workspaceRequest = new Request("http://127.0.0.1:3100/api/integrations/marketing/workspace", { headers: { "x-synthetic-session": "owner" } });
    const response = await GET(workspaceRequest);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const workspace = await response.json();
    expect(workspace.sources.some((source: { id: string }) => source.id === first.result.id)).toBe(true);
    const job = workspace.jobs[0];
    expect(job.target.artifactSha256).toBe(createHash("sha256").update(await readFile(f.file)).digest("hex"));
    const plan = youtubeAdapter.buildPlan({ item: f.item, localPath: f.file });
    expect(job.caption).toBe((plan.payload.snippet as { description: string }).description);
    expect(job.revisionVerified).toBe(true);
    expect(JSON.stringify(workspace)).not.toContain(f.root.replaceAll("\\", "\\\\"));
    const review = { operation: "approve_job", commandId: "synthetic_review_command_01", target: job.target };
    const reviewed = await (await POST(request(review))).json();
    expect(reviewed).toMatchObject({ ok: true, result: { persisted: true, reviewed: true, revision: 2 } });
    expect(await (await POST(request(review))).json()).toEqual(reviewed);
    expect((await POST(request({ operation: "request_edits", commandId: "synthetic_stale_edit_01", target: job.target, instructions: "Shorter ending" }))).status).toBe(409);
    const fresh = await f.ledger.read(owner, f.item.id, "youtube");
    expect((await (await POST(request({ operation: "request_edits", commandId: "synthetic_fresh_edit_01", target: fresh.target, instructions: "Shorter ending" }))).json()).ok).toBe(true);
    const rows = JSON.parse(await readFile(f.queueFile, "utf8"));
    expect(rows).toHaveLength(1);
    expect(rows[0].marketing.review).toBeUndefined();
    expect(rows[0].marketing.edit.instructions).toBe("Shorter ending");
    expect(rows[0].platforms.youtube.approvedAt).toBeUndefined();
    expect(f.queue.duePlatforms(rows[0], new Date("2100-01-01"))).toEqual([]);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("refuses unauthenticated and different-owner calls before any record read/write", async () => {
    const f = await fixture();
    const before = await readFile(f.queueFile, "utf8");
    expect((await GET(new Request("http://127.0.0.1:3100/api/integrations/marketing/workspace"))).status).toBe(401);
    expect((await GET(new Request("http://127.0.0.1:3100/api/integrations/marketing/workspace", { headers: { "x-synthetic-session": "other" } }))).status).toBe(403);
    expect((await POST(request({ operation: "retry_job", commandId: "synthetic_retry_command_01", target: (await f.ledger.read(owner, f.item.id, "youtube")).target }, "other"))).status).toBe(403);
    expect(await readFile(f.queueFile, "utf8")).toBe(before);
  });

  it("binds bytes and final payload, refuses path escapes and does not certify incomplete provider plans", async () => {
    const f = await fixture();
    const first = await f.readArtifact(f.item, "youtube");
    const second = await f.readArtifact({ ...f.item, title: "Changed title" }, "youtube");
    expect(second.payloadSha256).not.toBe(first.payloadSha256);
    await expect(f.readArtifact(f.item, "instagram")).rejects.toMatchObject({ code: "unavailable" });
    await expect(f.readArtifact({ ...f.item, clipPath: path.join(f.root, "..", "private.mp4") }, "youtube")).rejects.toBeDefined();
    await writeFile(f.file, "replacement synthetic bytes");
    expect(() => (first as typeof first & { assertCurrent(): void }).assertCurrent()).toThrow();
    const changed = await f.readArtifact(f.item, "youtube");
    expect(changed.sha256).not.toBe(first.sha256);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("rejects a changed time-dependent payload before applying approval", async () => {
    const f = await fixture();
    const clock = vi.spyOn(Date, "now").mockReturnValue(new Date("2099-10-24T11:59:00.000Z").getTime());
    const evidence = await f.readArtifact({ ...f.item, format: "short", visibility: "public" }, "youtube");
    clock.mockReturnValue(new Date("2099-10-24T12:01:00.000Z").getTime());
    expect(() => evidence.assertCurrent?.()).toThrow();
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
