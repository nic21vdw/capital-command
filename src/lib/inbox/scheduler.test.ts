import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INBOX_FIRST_SYNC_MS, INBOX_SYNC_INTERVAL_MS, startInboxScheduler } from "@/lib/inbox/scheduler";

const syncInbox = vi.hoisted(() => vi.fn(async () => ({ at: "now", added: 0, platforms: {} })));
vi.mock("@/lib/inbox/sync", () => ({ syncInbox }));

type Slot = typeof globalThis & { __inboxScheduler?: NodeJS.Timeout };

beforeEach(() => {
  vi.useFakeTimers();
  syncInbox.mockClear();
});

afterEach(() => {
  const slot = globalThis as Slot;
  if (slot.__inboxScheduler) clearInterval(slot.__inboxScheduler);
  slot.__inboxScheduler = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("startInboxScheduler", () => {
  it("syncs shortly after start and then every 30 minutes", async () => {
    startInboxScheduler();
    expect(syncInbox).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INBOX_FIRST_SYNC_MS);
    expect(syncInbox).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INBOX_SYNC_INTERVAL_MS);
    expect(syncInbox).toHaveBeenCalledTimes(2);
    expect(INBOX_SYNC_INTERVAL_MS).toBe(30 * 60_000);
  });

  it("does not start a second timer when started twice", async () => {
    startInboxScheduler();
    startInboxScheduler();

    await vi.advanceTimersByTimeAsync(INBOX_FIRST_SYNC_MS);

    expect(syncInbox).toHaveBeenCalledTimes(1);
  });

  it("stays off when INBOX_SYNC_ENABLED is false", async () => {
    vi.stubEnv("INBOX_SYNC_ENABLED", "false");

    startInboxScheduler();
    await vi.advanceTimersByTimeAsync(INBOX_SYNC_INTERVAL_MS * 2);

    expect(syncInbox).not.toHaveBeenCalled();
  });

  it("survives a failed sync and tries again on the next beat", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    syncInbox.mockRejectedValueOnce(new Error("disk full"));
    startInboxScheduler();

    await vi.advanceTimersByTimeAsync(INBOX_FIRST_SYNC_MS);
    await vi.advanceTimersByTimeAsync(INBOX_SYNC_INTERVAL_MS);

    expect(syncInbox).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
