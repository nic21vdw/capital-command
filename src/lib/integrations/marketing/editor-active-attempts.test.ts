import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { abortEditorAttempt, getEditorWorkerEpoch, inspectEditorAttempt, readEditorCancellationSettlement,
  runEditorAttempt, type EditorAttemptIdentity, type EditorAttemptTarget } from "./editor-active-attempts";

const target: EditorAttemptTarget = { revision: 1, digest: "a".repeat(64), renderSignature: "original1", overlayAssetsSha256: "b".repeat(64) };
const identity = (): EditorAttemptIdentity => ({ ownerId: "synthetic-owner", projectId: "project", jobId: "job", clipId: "clip",
  sourceFile: "source.mp4", sourceSha256: "c".repeat(64), requestId: randomUUID(), attemptId: randomUUID(), workerEpoch: getEditorWorkerEpoch() });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

it("shares the epoch and active controller across module reconstruction", async () => {
  const id = identity(), gate = deferred(); const cancelId = randomUUID();
  let signal!: AbortSignal;
  const running = runEditorAttempt(id, async (lease) => { lease.bindTarget(target); signal = lease.signal; await gate.promise; return "late proof"; });
  await Promise.resolve();
  vi.resetModules(); const reconstructed = await import("./editor-active-attempts");
  expect(reconstructed.getEditorWorkerEpoch()).toBe(id.workerEpoch);
  const before = reconstructed.inspectEditorAttempt(id, target);
  expect(before.status).toBe("active");
  await reconstructed.abortEditorAttempt(id, target, cancelId, 0);
  expect(signal.aborted).toBe(true);
  expect(reconstructed.readEditorCancellationSettlement(id, target, cancelId)).toBeNull();
  gate.resolve(); await expect(running).rejects.toMatchObject({ name: "RenderCanceledError" });
  expect(() => before.assertCurrent()).toThrow("activity changed");
  const proof = reconstructed.readEditorCancellationSettlement(id, target, cancelId)!;
  expect(proof.settled).toBe(true); proof.assertCurrent();
  await reconstructed.abortEditorAttempt(id, target, cancelId, 0);
  expect(reconstructed.readEditorCancellationSettlement(id, target, cancelId)).not.toBeNull();
});

it("does not treat a missing/prior epoch or an external signal as cancellation settlement", async () => {
  const missing = identity(), cancelId = randomUUID();
  expect(inspectEditorAttempt(missing, target).status).toBe("missing");
  expect(readEditorCancellationSettlement(missing, target, cancelId)).toBeNull();
  const prior = { ...missing, workerEpoch: randomUUID() };
  expect(inspectEditorAttempt(prior, target).status).toBe("prior_epoch");
  await abortEditorAttempt(prior, target, cancelId, 0);
  expect(readEditorCancellationSettlement(prior, target, cancelId)).toBeNull();
  const external = new AbortController(), id = identity();
  const running = runEditorAttempt(id, async (lease) => { lease.bindTarget(target); external.abort(); return "ignored"; }, { signal: external.signal });
  await expect(running).rejects.toMatchObject({ name: "RenderCanceledError" });
  expect(readEditorCancellationSettlement(id, target, cancelId)).toBeNull();
  await abortEditorAttempt(id, target, cancelId, 0); // Exact trusted fence observation is still required.
  expect(readEditorCancellationSettlement(id, target, cancelId)).not.toBeNull();
});

it("rejects a conflicting source or job in the same logical attempt slot without losing its controller", async () => {
  const id = identity(), gate = deferred(); let signal!: AbortSignal;
  const running = runEditorAttempt(id, async (lease) => { lease.bindTarget(target); signal = lease.signal; await gate.promise; });
  await Promise.resolve();
  for (const changed of [{ ...id, sourceSha256: "d".repeat(64) }, { ...id, jobId: "other-job" }, { ...id, clipId: "other-clip" }]) {
    expect(() => runEditorAttempt(changed, async () => undefined)).toThrow("source binding changed");
    expect(() => inspectEditorAttempt(changed, target)).toThrow("source binding changed");
    await expect(abortEditorAttempt(changed, target, randomUUID(), 0)).rejects.toThrow("source binding changed");
    expect(() => readEditorCancellationSettlement(changed, target, randomUUID())).toThrow("source binding changed");
  }
  expect(signal.aborted).toBe(false);
  const cancelId = randomUUID(); await abortEditorAttempt(id, target, cancelId, 0);
  gate.resolve(); await expect(running).rejects.toMatchObject({ name: "RenderCanceledError" });
  expect(readEditorCancellationSettlement(id, target, cancelId)).not.toBeNull();
});

it("reserves before the first asynchronous read and binds an exact fence without inventing an unsealed proof", async () => {
  const id = identity(), gate = deferred(), cancelId = randomUUID();
  const running = runEditorAttempt(id, async (lease) => { await gate.promise; lease.bindTarget(target); lease.assertActive(); });
  expect(inspectEditorAttempt(id, target).status).toBe("active");
  expect(readEditorCancellationSettlement(id, target, cancelId)).toBeNull();
  await abortEditorAttempt(id, target, cancelId, 0);
  expect(readEditorCancellationSettlement(id, target, cancelId)).toBeNull();
  gate.resolve(); await expect(running).rejects.toMatchObject({ name: "RenderCanceledError" });
  expect(readEditorCancellationSettlement(id, target, cancelId)).not.toBeNull();
});

it("keeps the full target immutable and never accepts a different cancellation ID", async () => {
  const id = identity(), gate = deferred(), cancelId = randomUUID();
  const mutable = { ...target };
  const running = runEditorAttempt(id, async (lease) => { lease.bindTarget(mutable); await gate.promise; });
  await Promise.resolve(); mutable.digest = "e".repeat(64);
  expect(() => inspectEditorAttempt(id, mutable)).toThrow("target changed");
  await abortEditorAttempt(id, target, cancelId, 0);
  await expect(abortEditorAttempt(id, target, randomUUID(), 0)).rejects.toThrow("cancellation identity changed");
  gate.resolve(); await expect(running).rejects.toMatchObject({ name: "RenderCanceledError" });
  expect(readEditorCancellationSettlement(id, target, randomUUID())).toBeNull();
});

it("accepts existing safe Unicode/punctuation basenames and refuses traversal, ADS and controls", async () => {
  const safe = { ...identity(), sourceFile: "café (take 1) + final.mp4" };
  await runEditorAttempt(safe, async (lease) => { lease.bindTarget(target); });
  expect(inspectEditorAttempt(safe, target).status).toBe("settled");
  for (const sourceFile of ["../source.mp4", "..\\source.mp4", ".hidden.mp4", "C:source.mp4", "source.mp4:stream", "bad\u0000.mp4", "bad\n.mp4"]) {
    expect(() => runEditorAttempt({ ...identity(), sourceFile }, async () => undefined)).toThrow("trusted editor attempt identity");
  }
});

it("evicts terminal entries only as missing ownership, never as cancellation settlement", async () => {
  const first = identity(), cancelId = randomUUID();
  const initial = runEditorAttempt(first, async (lease) => { lease.bindTarget(target); });
  await initial; await abortEditorAttempt(first, target, cancelId, 0);
  const proof = readEditorCancellationSettlement(first, target, cancelId)!; expect(proof).not.toBeNull();
  const active = identity(), gate = deferred();
  const pending = runEditorAttempt(active, async (lease) => { lease.bindTarget(target); await gate.promise; });
  for (let index = 0; index < 257; index++) await runEditorAttempt(identity(), async (lease) => { lease.bindTarget(target); });
  expect(inspectEditorAttempt(first, target).status).toBe("missing");
  expect(readEditorCancellationSettlement(first, target, cancelId)).toBeNull();
  expect(() => proof.assertCurrent()).toThrow("settlement evidence changed");
  expect(inspectEditorAttempt(active, target).status).toBe("active");
  gate.resolve(); await pending;
});
