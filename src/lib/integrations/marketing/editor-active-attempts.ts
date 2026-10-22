import { randomUUID } from "node:crypto";
import { RenderCanceledError } from "@/lib/clipping/ffmpeg";

/** Process ownership only. This registry contains no queue, dispatch or file port. */
export type EditorAttemptIdentity = Readonly<{
  ownerId: string; projectId: string; jobId: string; clipId: string; sourceFile: string; sourceSha256: string;
  requestId: string; attemptId: string; workerEpoch: string;
}>;
export type EditorAttemptTarget = Readonly<{
  revision: number; digest: string; renderSignature: string; overlayAssetsSha256: string;
}>;
type Entry = {
  identity: EditorAttemptIdentity; target?: EditorAttemptTarget; controller: AbortController;
  settled: boolean; cancelCommandId?: string; settledPromise: Promise<void>; markSettled(): void;
};
type Registry = { epoch: string; entries: Map<string, Entry> };
type RegistryGlobal = typeof globalThis & { __marketingEditorActiveAttemptsV1?: Registry };
const host = globalThis as RegistryGlobal;
const registry = host.__marketingEditorActiveAttemptsV1 ??= { epoch: randomUUID(), entries: new Map() };
const CAPACITY = 256;
const uuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const id = (value: string) => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const key = (identity: EditorAttemptIdentity) => JSON.stringify([identity.ownerId, identity.projectId,
  identity.requestId, identity.attemptId, identity.workerEpoch]);
const fullKey = (identity: EditorAttemptIdentity) => JSON.stringify([key(identity), identity.jobId,
  identity.clipId, identity.sourceFile, identity.sourceSha256]);
const targetKey = (target: EditorAttemptTarget) => JSON.stringify([target.revision, target.digest, target.renderSignature, target.overlayAssetsSha256]);
function identityCopy(input: EditorAttemptIdentity): EditorAttemptIdentity {
  if (!input.ownerId?.trim() || input.ownerId.length > 128 || ![input.projectId, input.jobId, input.clipId].every(id)
    || typeof input.sourceFile !== "string" || !input.sourceFile.length || input.sourceFile.length > 255
    || input.sourceFile.startsWith(".") || /[\\/:\u0000-\u001f\u007f]/.test(input.sourceFile) || !hash(input.sourceSha256)
    || ![input.requestId, input.attemptId, input.workerEpoch].every(uuid)) throw new Error("An exact trusted editor attempt identity is required.");
  return Object.freeze({ ...input });
}
function targetCopy(input: EditorAttemptTarget): EditorAttemptTarget {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !hash(input.digest) || !hash(input.overlayAssetsSha256)
    || !/^[a-z0-9]{1,64}$/.test(input.renderSignature)) throw new Error("An exact immutable editor attempt target is required.");
  return Object.freeze({ ...input });
}
function bind(entry: Entry, target: EditorAttemptTarget): void {
  const copy = targetCopy(target);
  if (entry.target && targetKey(entry.target) !== targetKey(copy)) throw new Error("The registered editor attempt target changed.");
  entry.target ??= copy;
}
function matches(entry: Entry, target: EditorAttemptTarget): boolean {
  return Boolean(entry.target && targetKey(entry.target) === targetKey(target));
}
function entryFor(identity: EditorAttemptIdentity): Entry | undefined {
  const entry = registry.entries.get(key(identity));
  if (entry && fullKey(entry.identity) !== fullKey(identity)) throw new Error("The registered editor attempt source binding changed.");
  return entry;
}
export function getEditorWorkerEpoch(): string { return registry.epoch; }

/** Reserve synchronously before the caller's first ledger read, then bind before any subprocess. */
export function runEditorAttempt<T>(input: EditorAttemptIdentity,
  operation: (lease: { signal: AbortSignal; bindTarget(target: EditorAttemptTarget): void; assertActive(): void }) => Promise<T>,
  options: { signal?: AbortSignal } = {}): Promise<T> {
  const identity = identityCopy(input);
  if (identity.workerEpoch !== registry.epoch) throw new Error("This attempt belongs to a different owning process epoch.");
  const entryKey = key(identity);
  if (entryFor(identity)) throw new Error("This exact preparation attempt already ran or is active.");
  while (registry.entries.size >= CAPACITY) {
    const terminal = [...registry.entries].find(([, entry]) => entry.settled);
    if (!terminal) throw new Error("The owning process has too many active editor attempts.");
    registry.entries.delete(terminal[0]); // Eviction means missing, never successful cancellation.
  }
  let markSettled!: () => void;
  const settledPromise = new Promise<void>((resolve) => { markSettled = resolve; });
  const entry: Entry = { identity, controller: new AbortController(), settled: false, settledPromise, markSettled };
  registry.entries.set(entryKey, entry);
  const externalAbort = () => entry.controller.abort();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();
  const assertActive = () => {
    if (entry.controller.signal.aborted) throw new RenderCanceledError();
    if (registry.entries.get(entryKey) !== entry || entry.settled) throw new Error("The owning editor attempt registration changed.");
  };
  const result = Promise.resolve().then(async () => {
    try {
      const value = await operation({ signal: entry.controller.signal, bindTarget: (target) => bind(entry, target), assertActive });
      assertActive();
      if (!entry.target) throw new Error("The preparation attempt never bound its original ledger target.");
      return value;
    } finally {
      options.signal?.removeEventListener("abort", externalAbort);
      entry.settled = true;
      entry.markSettled();
    }
  });
  // The registry observes failure while preserving the rejected result for its caller.
  void result.catch(() => undefined);
  return result;
}

type Status = "active" | "settled" | "missing" | "prior_epoch";
function status(identity: EditorAttemptIdentity, target: EditorAttemptTarget): { status: Status; entry?: Entry } {
  if (identity.workerEpoch !== registry.epoch) return { status: "prior_epoch" };
  const entry = entryFor(identity);
  if (!entry) return { status: "missing" };
  if (entry.target && !matches(entry, target)) throw new Error("The registered editor attempt target changed.");
  if (!entry.settled) return { status: "active", entry };
  return { status: entry.target ? "settled" : "missing", entry };
}
export function inspectEditorAttempt(input: EditorAttemptIdentity, targetInput: EditorAttemptTarget) {
  const identity = identityCopy(input), target = targetCopy(targetInput);
  const snapshot = status(identity, target);
  return Object.freeze({ workerEpoch: registry.epoch, status: snapshot.status, assertCurrent() {
    const current = status(identity, target);
    if (current.status !== snapshot.status || current.entry !== snapshot.entry) throw new Error("The editor attempt ownership or activity changed.");
  } });
}

/** Caller must have independently confirmed this exact durable cancellation fence. */
export async function abortEditorAttempt(input: EditorAttemptIdentity, targetInput: EditorAttemptTarget, cancelCommandId: string,
  waitMs = 2_000): Promise<void> {
  const identity = identityCopy(input), target = targetCopy(targetInput);
  if (!uuid(cancelCommandId)) throw new Error("An exact persisted cancellation identity is required.");
  if (identity.workerEpoch !== registry.epoch) return;
  const entry = entryFor(identity);
  if (!entry) return;
  bind(entry, target);
  if (entry.cancelCommandId && entry.cancelCommandId !== cancelCommandId) throw new Error("The attempt's persisted cancellation identity changed.");
  entry.cancelCommandId = cancelCommandId;
  entry.controller.abort();
  if (entry.settled) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([entry.settledPromise, new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, Math.min(5_000, waitMs)));
  })]); } finally { if (timer) clearTimeout(timer); }
}

/** No entry, no fence observation, no close/operation settlement: no cancellation proof. */
export function readEditorCancellationSettlement(input: EditorAttemptIdentity, targetInput: EditorAttemptTarget, cancelCommandId: string) {
  const identity = identityCopy(input), target = targetCopy(targetInput);
  if (!uuid(cancelCommandId) || identity.workerEpoch !== registry.epoch) return null;
  const entryKey = key(identity), entry = entryFor(identity);
  const valid = () => Boolean(entry && registry.entries.get(entryKey) === entry && matches(entry, target)
    && entry.settled && entry.controller.signal.aborted && entry.cancelCommandId === cancelCommandId);
  if (!valid()) return null;
  return Object.freeze({ requestId: identity.requestId, attemptId: identity.attemptId, workerEpoch: identity.workerEpoch,
    cancelCommandId, settled: true as const, assertCurrent() {
      if (!valid()) throw new Error("The exact cancellation settlement evidence changed.");
    } });
}
