import { statSync, readFileSync } from "node:fs";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";
import {
  DEFAULT_REVIEW_POLICY,
  HOLD_EVERYTHING,
  REVIEW_CHANNELS,
  normalizeReviewPolicy,
  parseHeldSince,
  parseReviewPolicy,
  type HeldSince,
  type ReviewPolicy
} from "@/lib/publisher/approval";

export class ReviewPolicyUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewPolicyUnreadableError";
  }
}

export type ReviewPolicyState = { policy: ReviewPolicy; error: string | null; heldSince: HeldSince };

const READ_ATTEMPTS = 3;
const RETRY_MS = 25;

export function reviewPolicyPath(): string {
  return dataPath("review-policy.json");
}

let cached: { key: string; policy: ReviewPolicy; heldSince: HeldSince } | null = null;
let lastGood: { policy: ReviewPolicy; heldSince: HeldSince } | null = null;
let warned: string | null = null;

export function resetReviewPolicyCache(): void {
  cached = null;
  lastGood = null;
  warned = null;
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

type Attempt =
  | { kind: "missing" }
  | { kind: "read"; policy: ReviewPolicy; heldSince: HeldSince }
  | { kind: "failed"; reason: string };

function attempt(file: string): Attempt {
  let key: string;
  try {
    const info = statSync(file, { bigint: true });
    key = `${file}:${info.mtimeNs}:${info.size}`;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException | null)?.code === "ENOENT") return { kind: "missing" };
    return { kind: "failed", reason: reason instanceof Error ? reason.message : String(reason) };
  }
  if (cached?.key === key) return { kind: "read", policy: cached.policy, heldSince: cached.heldSince };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (reason) {
    return { kind: "failed", reason: reason instanceof Error ? reason.message : String(reason) };
  }
  const policy = parseReviewPolicy(raw);
  if (!policy) return { kind: "failed", reason: "it is not a review policy" };
  const heldSince = parseHeldSince(raw);
  cached = { key, policy, heldSince };
  return { kind: "read", policy, heldSince };
}

function unreadable(reason: string): ReviewPolicyState {
  const message = lastGood
    ? `data/review-policy.json could not be read (${reason}), so the last good settings are in use until it is fixed.`
    : `data/review-policy.json could not be read (${reason}), so every channel is held for approval until it is fixed.`;
  if (warned !== message) {
    warned = message;
    console.warn(`[review] ${message}`);
  }
  return {
    policy: lastGood ? { ...lastGood.policy } : { ...HOLD_EVERYTHING },
    error: message,
    heldSince: lastGood ? { ...lastGood.heldSince } : {}
  };
}

export function readReviewPolicyState(): ReviewPolicyState {
  const file = reviewPolicyPath();
  let outcome: Attempt = attempt(file);
  for (let tried = 1; outcome.kind === "failed" && tried < READ_ATTEMPTS; tried += 1) {
    pause(RETRY_MS);
    outcome = attempt(file);
  }
  if (outcome.kind === "missing") {
    cached = null;
    lastGood = { policy: { ...DEFAULT_REVIEW_POLICY }, heldSince: {} };
    warned = null;
    return { policy: { ...DEFAULT_REVIEW_POLICY }, error: null, heldSince: {} };
  }
  if (outcome.kind === "failed") return unreadable(outcome.reason);
  lastGood = { policy: outcome.policy, heldSince: outcome.heldSince };
  warned = null;
  return { policy: { ...outcome.policy }, error: null, heldSince: { ...outcome.heldSince } };
}

export function readReviewPolicy(): ReviewPolicy {
  return readReviewPolicyState().policy;
}

export async function writeReviewPolicy(change: Partial<ReviewPolicy>, now: Date = new Date()): Promise<ReviewPolicy> {
  const file = reviewPolicyPath();
  return withFileLock(file, async () => {
    const before = readReviewPolicyState();
    if (before.error) throw new ReviewPolicyUnreadableError(before.error);
    const next = normalizeReviewPolicy({ ...before.policy, ...change });
    const heldSince: HeldSince = {};
    for (const channel of REVIEW_CHANNELS) {
      if (next[channel] !== "hold") continue;
      const since = before.policy[channel] === "hold" ? before.heldSince[channel] : now.toISOString();
      if (since) heldSince[channel] = since;
    }
    await atomicWriteJson(file, { ...next, ...(Object.keys(heldSince).length > 0 ? { heldSince } : {}) }, { space: 2 });
    cached = null;
    lastGood = { policy: next, heldSince };
    return next;
  });
}
