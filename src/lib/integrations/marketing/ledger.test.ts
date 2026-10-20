import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PublishQueue } from "@/lib/publisher/queue";
import { FileQueueStore, R2QueueStore } from "@/lib/publisher/store";
import { testConfig, testItem } from "@/lib/publisher/test-helpers";
import type { PlatformId, QueueItem } from "@/lib/publisher/types";
import { fingerprintQueueItem, MarketingLedger, type ArtifactEvidence, type LedgerPorts } from "./ledger";
import type { PlatformReadback, Principal, Target } from "./safety";

const user: Principal = { ownerId: "owner-a", scopes: ["read", "write", "review"] };
const worker: Principal = { ownerId: "owner-a", scopes: ["read", "worker"] };
const binding = { ownerId: "owner-a", allowedAccounts: { youtube: ["account-a"] } };
const now = new Date("2026-10-23T12:00:00.000Z");
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
let sequence = 0;
const commandId = (): string => `command_${String(++sequence).padStart(12, "0")}`;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "marketing-ledger-synthetic-"));
  const file = path.join(root, "queue.json");
  const artifact = path.join(root, "synthetic-output.bin");
  await writeFile(artifact, "synthetic media bytes only");
  const store = new FileQueueStore(file);
  const queue = new PublishQueue(store, testConfig());
  const item = testItem({ id: "job-a", clipPath: artifact, accountId: "account-a", platformIds: ["youtube"], publishAt: "2026-10-24T12:00:00.000Z", caption: "Exact final caption" });
  await queue.add(item);
  const readArtifact = vi.fn(async (row: Readonly<QueueItem>, platform: PlatformId): Promise<ArtifactEvidence> => ({
    sha256: hash(await readFile(artifact)), finalCaption: row.caption,
    payloadSha256: hash(JSON.stringify({ title: row.title, caption: row.caption, hashtags: row.hashtags, visibility: row.visibility, platform, publishAt: row.publishAt, accountId: row.accountId }))
  }));
  const ports: LedgerPorts = { readArtifact, now: () => now };
  const ledger = new MarketingLedger(queue, binding, ports);
  const enroll = () => ledger.adopt(user, { commandId: commandId(), jobId: item.id, expectedFingerprint: fingerprintQueueItem(item) });
  const target = async (): Promise<Target> => (await ledger.read(user, item.id, "youtube")).target;
  const restart = () => new MarketingLedger(new PublishQueue(new FileQueueStore(file), testConfig()), binding, ports);
  return { root, file, artifact, store, queue, item, ports, readArtifact, ledger, enroll, target, restart };
}

describe("durable existing-queue marketing commands", () => {
  it("enrolls only an unchanged unsent scoped existing row and persists review without legacy release", async () => {
    const f = await fixture();
    expect(await f.enroll()).toMatchObject({ persisted: true, revision: 1, operation: "adopt" });
    const args = { commandId: commandId(), target: await f.target() };
    expect(await f.ledger.review(user, args)).toMatchObject({ persisted: true, revision: 2, reviewed: true });
    const rows = JSON.parse(await readFile(f.file, "utf8")) as QueueItem[];
    expect(rows).toHaveLength(1);
    expect(rows[0].marketing).toMatchObject({ ownerId: user.ownerId, publication: "blocked", revision: 2 });
    expect(rows[0].platforms.youtube?.approvedAt).toBeUndefined();
    expect(await f.restart().read(user, f.item.id, "youtube")).toMatchObject({ revision: 2, reviewed: true });
  });

  it("replays the original durable result after restart without re-reading media, and rejects command-id reuse", async () => {
    const f = await fixture(); await f.enroll();
    const args = { commandId: commandId(), target: await f.target() };
    const original = await f.ledger.review(user, args);
    f.readArtifact.mockRejectedValueOnce(new Error("must not read media on replay"));
    expect(await f.restart().review(user, args)).toEqual(original);
    await expect(f.restart().review(user, { ...args, target: { ...args.target, caption: "changed" } })).rejects.toMatchObject({ code: "conflict" });
  });

  it("permits one of two simultaneous revisions from independent queue instances", async () => {
    const f = await fixture(); await f.enroll();
    const target = await f.target();
    const results = await Promise.allSettled([
      f.ledger.review(user, { commandId: commandId(), target }),
      f.restart().requestEdits(user, { commandId: commandId(), target, instructions: "Replace the ending" })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await f.restart().read(user, f.item.id, "youtube")).revision).toBe(2);
  });

  it("does not expose in-memory review or receipt when atomic save fails, and a retry can succeed", async () => {
    const f = await fixture(); await f.enroll();
    const args = { commandId: commandId(), target: await f.target() };
    const before = await readFile(f.file, "utf8");
    const save = vi.spyOn(f.store, "save").mockRejectedValueOnce(new Error("synthetic disk full"));
    await expect(f.ledger.review(user, args)).rejects.toThrow("synthetic disk full");
    expect(await readFile(f.file, "utf8")).toBe(before);
    expect(f.item.marketing?.review).toBeUndefined();
    expect(f.item.marketing?.revision).toBe(1);
    expect(await f.ledger.review(user, args)).toMatchObject({ revision: 2, persisted: true });
    save.mockRestore();
  });

  it("invalidates review and bumps revision on a legacy edit while retaining receipts", async () => {
    const f = await fixture(); await f.enroll();
    await f.ledger.review(user, { commandId: commandId(), target: await f.target() });
    const old = await f.target();
    const legacy = new PublishQueue(new FileQueueStore(f.file), testConfig());
    const row = (await legacy.get(f.item.id))!;
    row.caption = "Foreign edit";
    await legacy.save();
    const fresh = await f.restart().read(user, f.item.id, "youtube");
    expect(fresh).toMatchObject({ revision: 3, reviewed: false, caption: "Foreign edit" });
    await expect(f.ledger.review(user, { commandId: commandId(), target: old })).rejects.toMatchObject({ code: "conflict" });
    expect(Object.keys((await legacy.get(f.item.id))!.marketing!.commands)).toHaveLength(2);
  });
  it("rejects a command when a foreign edit lands while media verification is awaiting", async () => {
    const f = await fixture(); await f.enroll();
    const target = await f.target();
    const original = f.ports.readArtifact;
    let ready!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { ready = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    f.ports.readArtifact = async (row, platform) => { ready(); await gate; return original(row, platform); };
    const review = f.ledger.review(user, { commandId: commandId(), target });
    await entered;
    const legacy = new PublishQueue(new FileQueueStore(f.file), testConfig());
    (await legacy.get(f.item.id))!.title = "Changed during verification";
    await legacy.save();
    release();
    await expect(review).rejects.toMatchObject({ code: "conflict" });
    expect(f.item.marketing?.review).toBeUndefined();
  });
  it("recovers an uncertain save acknowledgement through its durable command receipt", async () => {
    const f = await fixture(); await f.enroll();
    const args = { commandId: commandId(), target: await f.target() };
    const original = f.store.save.bind(f.store);
    vi.spyOn(f.store, "save").mockImplementationOnce(async (text) => { await original(text); throw new Error("synthetic acknowledgement lost"); });
    await expect(f.ledger.review(user, args)).rejects.toThrow("acknowledgement lost");
    expect(await f.restart().review(user, args)).toMatchObject({ operation: "review", revision: 2, reviewed: true, persisted: true });
    expect(Object.keys(JSON.parse(await readFile(f.file, "utf8"))[0].marketing.commands)).toHaveLength(2);
  });

  it("survives a stale legacy writer removing metadata and deleting the row as a same-ledger tombstone", async () => {
    const f = await fixture();
    const stale = new PublishQueue(new FileQueueStore(f.file), testConfig());
    const row = (await stale.get(f.item.id))!;
    await f.enroll();
    const reviewArgs = { commandId: commandId(), target: await f.target() };
    const result = await f.ledger.review(user, reviewArgs);
    row.title = "A stale title edit";
    row.marketing = undefined;
    await stale.save();
    expect((await stale.get(f.item.id))!.marketing?.revision).toBe(3);
    expect(await stale.remove(f.item.id)).toBe(true);
    const rows = JSON.parse(await readFile(f.file, "utf8")) as QueueItem[];
    expect(rows).toHaveLength(1);
    expect(rows[0].marketing?.deletedAt).toBeTruthy();
    expect(rows[0].marketing?.commands[reviewArgs.commandId].result).toEqual(result);
    expect(await f.restart().review(user, reviewArgs)).toEqual(result);
    expect(await f.restart().list(user)).toEqual([]);
  });

  it("binds every command to actual current synthetic bytes and final payload", async () => {
    const f = await fixture(); await f.enroll();
    const old = await f.target();
    await writeFile(f.artifact, "new synthetic render bytes");
    await expect(f.ledger.review(user, { commandId: commandId(), target: old })).rejects.toMatchObject({ code: "conflict" });
    const current = await f.target();
    expect(current.artifactSha256).not.toBe(old.artifactSha256);
    expect(await f.ledger.review(user, { commandId: commandId(), target: current })).toMatchObject({ persisted: true, reviewed: true });
  });

  it("isolates owner, account and distinct worker scope, including receipt replay", async () => {
    const f = await fixture(); await f.enroll();
    const args = { commandId: commandId(), target: await f.target() };
    await f.ledger.review(user, args);
    await expect(f.ledger.read({ ...user, ownerId: "other" }, f.item.id, "youtube")).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.ledger.claim(user, { commandId: commandId(), target: await f.target() })).rejects.toMatchObject({ code: "forbidden" });
    const otherAccount = new MarketingLedger(f.queue, { ...binding, allowedAccounts: { youtube: ["other"] } }, f.ports);
    expect(await otherAccount.list(user)).toEqual([]);
    await expect(otherAccount.review(user, args)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.ledger.review(worker, { commandId: commandId(), target: await f.target() })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses stores without locking instead of using unconditional R2 writes", async () => {
    const f = await fixture();
    const put = vi.fn();
    const r2 = new PublishQueue(new R2QueueStore({ getObjectText: async () => "[]", putObjectText: put, describe: () => "synthetic" }), testConfig());
    const ledger = new MarketingLedger(r2, binding, f.ports);
    await expect(ledger.adopt(user, { commandId: commandId(), jobId: f.item.id, expectedFingerprint: fingerprintQueueItem(f.item) })).rejects.toThrow(/locking/);
    expect(put).not.toHaveBeenCalled();
  });
});

describe("fenced processing outcomes without publication permission", () => {
  it("claims processing, verifies newly prepared bytes, persists outcome, then allows exact review", async () => {
    const f = await fixture(); await f.enroll();
    await f.ledger.requestEdits(user, { commandId: commandId(), target: await f.target(), instructions: "Make a synthetic alternate ending" });
    expect((await f.ledger.read(user, f.item.id, "youtube")).status).toBe("edits_requested");
    const claim = await f.ledger.claim(worker, { commandId: commandId(), target: await f.target() });
    expect(claim).toMatchObject({ persisted: true, workerState: "claimed" });
    const target = await f.target();
    await writeFile(f.artifact, "verified prepared synthetic bytes");
    const result = await f.ledger.recordOutcome(worker, { commandId: commandId(), target, attemptId: claim.attemptId!, outcome: "prepared" });
    expect(result).toMatchObject({ persisted: true, workerState: "prepared" });
    const view = await f.restart().read(user, f.item.id, "youtube");
    expect(view.status).toBe("prepared");
    expect(view.artifactSha256).toBe(hash("verified prepared synthetic bytes"));
    await f.ledger.review(user, { commandId: commandId(), target: view.target });
    expect(f.item.platforms.youtube?.approvedAt).toBeUndefined();
  });

  it("only a trusted pre-send failure enables retry; a worker assertion becomes uncertain", async () => {
    const f = await fixture(); await f.enroll();
    const claim = await f.ledger.claim(worker, { commandId: commandId(), target: await f.target() });
    await f.ledger.recordOutcome(worker, { commandId: commandId(), target: await f.target(), attemptId: claim.attemptId!, outcome: "failed_before_send" });
    expect((await f.target()).revision).toBe(3);
    await expect(f.ledger.retry(user, { commandId: commandId(), target: await f.target() })).rejects.toMatchObject({ code: "conflict" });
    const g = await fixture(); await g.enroll(); g.ports.verifyPreSendFailure = async () => true;
    const second = await g.ledger.claim(worker, { commandId: commandId(), target: await g.target() });
    await g.ledger.recordOutcome(worker, { commandId: commandId(), target: await g.target(), attemptId: second.attemptId!, outcome: "failed_before_send" });
    expect(await g.ledger.retry(user, { commandId: commandId(), target: await g.target() })).toMatchObject({ persisted: true, operation: "retry" });
    const next = await g.ledger.claim(worker, { commandId: commandId(), target: await g.target() });
    expect(next.attemptId).not.toBe(second.attemptId);
    await expect(g.ledger.recordOutcome(worker, { commandId: commandId(), target: await g.target(), attemptId: second.attemptId!, outcome: "prepared" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("never reclaims an uncertain attempt and can reconcile through a trusted readback after restart", async () => {
    const f = await fixture(); await f.enroll();
    const claim = await f.ledger.claim(worker, { commandId: commandId(), target: await f.target() });
    await f.ledger.recordOutcome(worker, { commandId: commandId(), target: await f.target(), attemptId: claim.attemptId!, outcome: "published", postId: "video-id" });
    expect(await f.restart().read(user, f.item.id, "youtube")).toMatchObject({ status: "uncertain", publishedUrlVerified: false });
    await expect(f.ledger.claim(worker, { commandId: commandId(), target: await f.target() })).rejects.toMatchObject({ code: "conflict" });
    f.ports.readback = async (target, attemptId): Promise<PlatformReadback> => ({ target, attemptId, postId: "video-id", state: "published", visibility: target.visibility, audience: target.audience, observedAt: now.toISOString(), publishedUrl: "https://youtube.com/watch?v=video-id", publishedUrlPostId: "video-id" });
    await f.restart().recordOutcome(worker, { commandId: commandId(), target: await f.target(), attemptId: claim.attemptId!, outcome: "uncertain", postId: "video-id" });
    expect(await f.restart().read(user, f.item.id, "youtube")).toMatchObject({ status: "published", publishedUrlVerified: true, publishedUrl: "https://youtube.com/watch?v=video-id" });
  });
});

describe("managed rows cannot enter legacy publishing", () => {
  it("blocks due, forced and Buffer claims, legacy release and reconnect rearm", async () => {
    const f = await fixture(); await f.enroll();
    await f.ledger.review(user, { commandId: commandId(), target: await f.target() });
    expect(f.queue.duePlatforms(f.item, new Date("2027-01-01"))).toEqual([]);
    expect(await f.queue.claim(f.item, "youtube", now, { force: true })).toBe(false);
    expect(await f.queue.claimBuffer(f.item, now)).toBe(false);
    expect(await f.queue.releaseLegs([{ id: f.item.id, platform: "youtube" }], now)).toMatchObject({ approved: 0, skipped: [{ id: f.item.id, platform: "youtube" }] });
    f.item.platforms.youtube!.status = "failed"; await f.queue.save();
    expect(await f.queue.rearm(f.item)).toEqual([]);
    expect(f.item.platforms.youtube?.approvedAt).toBeUndefined();
  });
  it("checks stored managed ownership even when a legacy runner holds a pre-enrollment row", async () => {
    const f = await fixture();
    const stale = new PublishQueue(new FileQueueStore(f.file), testConfig());
    const row = (await stale.get(f.item.id))!;
    await f.enroll();
    expect(await stale.claim(row, "youtube", now, { force: true })).toBe(false);
    expect(await stale.claimBuffer(row, now)).toBe(false);
  });
  it("cannot lose the managed barrier through a legacy release on a modified caller reference", async () => {
    const f = await fixture(); await f.enroll();
    f.item.marketing = undefined;
    expect(await f.queue.releaseLegs([{ id: f.item.id, platform: "youtube" }], now)).toMatchObject({ approved: 0 });
    expect((await f.queue.get(f.item.id))!.platforms.youtube?.approvedAt).toBeUndefined();
    expect((await f.queue.get(f.item.id))!.marketing?.publication).toBe("blocked");
  });
});
