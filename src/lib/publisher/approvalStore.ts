import { statSync, readFileSync } from "node:fs";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";
import {
  DEFAULT_REVIEW_POLICY,
  HOLD_EVERYTHING,
  normalizeReviewPolicy,
  parseReviewPolicy,
  type ReviewPolicy
} from "@/lib/publisher/approval";

export type ReviewPolicyState = { policy: ReviewPolicy; error: string | null };

export function reviewPolicyPath(): string {
  return dataPath("review-policy.json");
}

let cached: { key: string; policy: ReviewPolicy } | null = null;
let lastGood: ReviewPolicy | null = null;
let warned: string | null = null;

export function resetReviewPolicyCache(): void {
  cached = null;
  lastGood = null;
  warned = null;
}

function fingerprint(file: string): string | null {
  try {
    const info = statSync(file, { bigint: true });
    return `${file}:${info.mtimeNs}:${info.size}`;
  } catch {
    return null;
  }
}

function unreadable(reason: string): ReviewPolicyState {
  const message = lastGood
    ? `data/review-policy.json could not be read (${reason}), so the last good settings are in use until it is fixed.`
    : `data/review-policy.json could not be read (${reason}), so every channel is held for approval until it is fixed.`;
  if (warned !== message) {
    warned = message;
    console.warn(`[review] ${message}`);
  }
  return { policy: lastGood ? { ...lastGood } : { ...HOLD_EVERYTHING }, error: message };
}

export function readReviewPolicyState(): ReviewPolicyState {
  const file = reviewPolicyPath();
  const key = fingerprint(file);
  if (key === null) {
    cached = null;
    lastGood = { ...DEFAULT_REVIEW_POLICY };
    warned = null;
    return { policy: { ...DEFAULT_REVIEW_POLICY }, error: null };
  }
  if (cached?.key === key) return { policy: { ...cached.policy }, error: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (reason) {
    return unreadable(reason instanceof Error ? reason.message : String(reason));
  }
  const policy = parseReviewPolicy(raw);
  if (!policy) return unreadable("it is not a review policy");
  cached = { key, policy };
  lastGood = policy;
  warned = null;
  return { policy: { ...policy }, error: null };
}

export function readReviewPolicy(): ReviewPolicy {
  return readReviewPolicyState().policy;
}

export async function writeReviewPolicy(change: Partial<ReviewPolicy>): Promise<ReviewPolicy> {
  const file = reviewPolicyPath();
  return withFileLock(file, async () => {
    const next = normalizeReviewPolicy({ ...readReviewPolicy(), ...change });
    await atomicWriteJson(file, next, { space: 2 });
    cached = null;
    lastGood = next;
    return next;
  });
}
