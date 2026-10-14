import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ readFailures: 0, readCalls: 0, statCode: null as string | null }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const isPolicy = (target: unknown) => String(target).endsWith("review-policy.json");
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    if (isPolicy(args[0])) {
      control.readCalls += 1;
      if (control.readFailures > 0) {
        control.readFailures -= 1;
        throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
      }
    }
    return actual.readFileSync(...args);
  }) as typeof actual.readFileSync;
  const statSync = ((...args: Parameters<typeof actual.statSync>) => {
    if (isPolicy(args[0]) && control.statCode) throw Object.assign(new Error("stat refused"), { code: control.statCode });
    return actual.statSync(...args);
  }) as typeof actual.statSync;
  return { ...actual, default: { ...actual, readFileSync, statSync }, readFileSync, statSync };
});

import { DEFAULT_REVIEW_POLICY, HOLD_EVERYTHING } from "@/lib/publisher/approval";
import { readReviewPolicyState, resetReviewPolicyCache, reviewPolicyPath } from "@/lib/publisher/approvalStore";

const GOOD = { ...DEFAULT_REVIEW_POLICY, instagram: "hold" };

beforeEach(async () => {
  resetReviewPolicyCache();
  control.readFailures = 0;
  control.readCalls = 0;
  control.statCode = null;
  await mkdir(path.dirname(reviewPolicyPath()), { recursive: true });
  await rm(reviewPolicyPath(), { force: true });
});

describe("reading the policy while the filesystem hiccups", () => {
  it("retries a transient read failure and then reads the file", async () => {
    await writeFile(reviewPolicyPath(), JSON.stringify(GOOD), "utf8");
    control.readFailures = 2;
    const state = readReviewPolicyState();
    expect(state.error).toBeNull();
    expect(state.policy).toEqual(GOOD);
    expect(control.readCalls).toBe(3);
  });

  it("waits about 25 ms between tries", async () => {
    await writeFile(reviewPolicyPath(), JSON.stringify(GOOD), "utf8");
    control.readFailures = 2;
    const started = performance.now();
    readReviewPolicyState();
    expect(performance.now() - started).toBeGreaterThanOrEqual(40);
  });

  it("fails closed after three tries when there is no last good policy", async () => {
    await writeFile(reviewPolicyPath(), JSON.stringify(GOOD), "utf8");
    control.readFailures = 3;
    const state = readReviewPolicyState();
    expect(control.readCalls).toBe(3);
    expect(state.policy).toEqual(HOLD_EVERYTHING);
    expect(state.error).toMatch(/could not be read/i);
  });

  it("keeps the last good policy after three failed tries", async () => {
    await writeFile(reviewPolicyPath(), JSON.stringify(GOOD), "utf8");
    expect(readReviewPolicyState().error).toBeNull();
    await writeFile(reviewPolicyPath(), JSON.stringify({ ...GOOD, tiktok: "hold" }), "utf8");
    control.readFailures = 3;
    const state = readReviewPolicyState();
    expect(state.policy).toEqual(GOOD);
    expect(state.error).toMatch(/last good/i);
  });

  it("treats a stat error that is not 'no such file' as unreadable, never as all auto", async () => {
    await writeFile(reviewPolicyPath(), JSON.stringify(GOOD), "utf8");
    control.statCode = "EACCES";
    const state = readReviewPolicyState();
    expect(state.policy).toEqual(HOLD_EVERYTHING);
    expect(state.error).toMatch(/could not be read/i);
  });

  it("still treats a missing file as the defaults", () => {
    expect(readReviewPolicyState()).toEqual({ policy: DEFAULT_REVIEW_POLICY, error: null, heldSince: {} });
  });
});
