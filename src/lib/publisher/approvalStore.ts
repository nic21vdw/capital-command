import { statSync, readFileSync } from "node:fs";
import { dataPath } from "@/lib/paths";
import { atomicWriteJson } from "@/lib/storage/atomic-json";
import { withFileLock } from "@/lib/storage/file-lock";
import { DEFAULT_REVIEW_POLICY, normalizeReviewPolicy, type ReviewPolicy } from "@/lib/publisher/approval";

export function reviewPolicyPath(): string {
  return dataPath("review-policy.json");
}

let cached: { key: string; policy: ReviewPolicy } | null = null;

function fingerprint(file: string): string | null {
  try {
    const info = statSync(file, { bigint: true });
    return `${file}:${info.mtimeNs}:${info.size}`;
  } catch {
    return null;
  }
}

export function readReviewPolicy(): ReviewPolicy {
  const file = reviewPolicyPath();
  const key = fingerprint(file);
  if (key === null) {
    cached = null;
    return { ...DEFAULT_REVIEW_POLICY };
  }
  if (cached?.key === key) return { ...cached.policy };
  let policy: ReviewPolicy;
  try {
    policy = normalizeReviewPolicy(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    policy = { ...DEFAULT_REVIEW_POLICY };
  }
  cached = { key, policy };
  return { ...policy };
}

export async function writeReviewPolicy(change: Partial<ReviewPolicy>): Promise<ReviewPolicy> {
  const file = reviewPolicyPath();
  return withFileLock(file, async () => {
    const next = normalizeReviewPolicy({ ...readReviewPolicy(), ...change });
    await atomicWriteJson(file, next, { space: 2 });
    cached = null;
    return next;
  });
}
