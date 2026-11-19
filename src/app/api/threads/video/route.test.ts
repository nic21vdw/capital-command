import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentialCheck: vi.fn(), readExport: vi.fn(), readPost: vi.fn(), containerStatus: vi.fn(),
  privateDelivery: vi.fn()
}));

vi.mock("@/lib/threads/reconnect", async (actual) => ({
  ...await actual<typeof import("@/lib/threads/reconnect")>(), verifyThreadsPublishingConnection: mocks.credentialCheck
}));
vi.mock("@/lib/threads/video", async (actual) => ({
  ...await actual<typeof import("@/lib/threads/video")>(), readThreadsExport: mocks.readExport, videoDeliveryProfile: mocks.privateDelivery
}));
vi.mock("@/lib/threads/api", () => ({
  readThreadsVideoPost: mocks.readPost, threadsVideoContainerStatus: mocks.containerStatus
}));

import { POST } from "./route";
import { readQueue, mutateQueue, writeQueue } from "@/lib/threads/queue";

const commandId = "fa659908-8d15-4dd6-91f9-25bcc9ec6da5";
const secondId = "4cddcf41-dd6e-4ba3-a101-03ac393d6341";
const localUrl = "http://127.0.0.1:3000/api/threads/video";
const fixture = {
  jobId: "fixture", fileName: "export-fixture.mp4", accountId: "primary", text: "Approved fixture",
  publishAt: new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 3600_000).toISOString()
};

const call = (body: object, origin = "http://127.0.0.1:3000") => POST(new Request(localUrl, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body)
}));

async function preview() {
  const response = await call({ action: "preview", input: fixture });
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("THREADS_DELIVERY_MODE", "video-only");
  vi.stubEnv("THREADS_USER_ID", "100");
  vi.stubEnv("THREADS_ACCESS_TOKEN", "fixture-access-token");
  mocks.credentialCheck.mockResolvedValue({ userId: "100", username: "fixture", quotaUsage: 0 });
  mocks.readExport.mockResolvedValue({ sha256: "a".repeat(64) });
  mocks.privateDelivery.mockReturnValue({ bucket: "fixture-private" });
  await writeQueue([]);
});

describe("local Threads video HTTP contract", () => {
  it("previews without a booking, rejects cross-origin and stale proofs, and deduplicates simultaneous confirms", async () => {
    const cross = await call({ action: "preview", input: fixture }, "https://foreign.example");
    expect(cross.status).toBe(403);
    expect(mocks.credentialCheck).not.toHaveBeenCalled();
    const card = await preview();
    expect(await readQueue()).toEqual([]);
    const approve = { action: "schedule", target: card.target, approvalDigest: card.digest, commandId, confirmed: true };
    expect((await call({ ...approve, confirmed: false })).status).toBe(400);
    expect((await call({ ...approve, target: { ...card.target, accountId: "secondary" } })).status).toBe(409);
    mocks.readExport.mockResolvedValueOnce({ sha256: "b".repeat(64) });
    expect((await call(approve)).status).toBe(409);
    const responses = await Promise.all([call(approve), call(approve)]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const evidence = await Promise.all(responses.map((response) => response.json()));
    expect(evidence.map((item) => item.replayed).sort()).toEqual([false, true]);
    expect(evidence[0].receipt.id).toBe(evidence[1].receipt.id);
    expect((await readQueue()).length).toBe(1);
    expect((await call({ ...approve, commandId: secondId })).status).toBe(409);
  });

  it("holds an uncertain container with no receipt and verifies a matching accepted ID independently", async () => {
    const card = await preview();
    const booked = await call({ action: "schedule", target: card.target, approvalDigest: card.digest, commandId, confirmed: true });
    const { receipt } = await booked.json();
    await mutateQueue((items) => {
      items[0].containerId = "200";
      items[0].publishAttemptedAt = fixture.publishAt;
      return { items, result: null };
    });
    mocks.containerStatus.mockResolvedValue("PUBLISHED");
    const held = await call({ action: "reconcile", id: receipt.id });
    expect(await held.json()).toMatchObject({ containerStatus: "PUBLISHED", receipt: { providerState: "uncertain" } });
    await mutateQueue((items) => {
      items[0].postId = "300";
      return { items, result: null };
    });
    const permalink = "https://www.threads.com/@fixture/post/fixture";
    mocks.readPost.mockResolvedValue({ permalink, providerTimestamp: fixture.publishAt });
    const verified = await call({ action: "reconcile", id: receipt.id });
    expect(await verified.json()).toMatchObject({ receipt: { providerState: "verified", status: "published", postId: "300", permalink } });
    expect(mocks.readPost).toHaveBeenCalledOnce();
  });
});
