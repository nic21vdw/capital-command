import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { mutateQueue, queuePath, readQueue, writeQueue } from "@/lib/threads/queue";
import type { ThreadsQueueItem } from "@/lib/threads/types";

function item(id: string): ThreadsQueueItem {
  return {
    id, batchDate: "2026-10-03", slot: 1, accountId: "primary", version: "text",
    topic: "queue", format: "insight", text: id, publishAt: "2026-10-03T12:00:00Z",
    status: "pending", attempts: 0, createdAt: "2026-10-02T12:00:00Z"
  };
}

beforeEach(async () => { await unlink(queuePath()).catch(() => undefined); });

describe("Threads queue persistence", () => {
  it("starts with an empty list only when there is no saved queue", async () => {
    expect(await readQueue()).toEqual([]);
  });

  it.each(["broken JSON", '{"posts":[]}'])("preserves an invalid saved queue and refuses mutations: %s", async (raw) => {
    await mkdir(path.dirname(queuePath()), { recursive: true });
    await writeFile(queuePath(), raw, "utf8");
    await expect(readQueue()).rejects.toThrow("could not be read");
    await expect(mutateQueue((items) => ({ items: [...items, item("new")], result: true }))).rejects.toThrow("could not be read");
    expect(await readFile(queuePath(), "utf8")).toBe(raw);
  });

  it("preserves both simultaneous additions by serializing the read and the write", async () => {
    await writeQueue([item("existing")]);
    await Promise.all(["one", "two"].map((id) => mutateQueue((items) => ({ items: [...items, item(id)], result: id }))));
    expect((await readQueue()).map((entry) => entry.id).sort()).toEqual(["existing", "one", "two"]);
  });

  it("allows a later mutation after a failed one", async () => {
    await writeQueue([item("existing")]);
    await expect(mutateQueue(() => { throw new Error("edit failed"); })).rejects.toThrow("edit failed");
    await mutateQueue((items) => ({ items: [...items, item("next")], result: true }));
    expect((await readQueue()).map((entry) => entry.id)).toEqual(["existing", "next"]);
  });
});
