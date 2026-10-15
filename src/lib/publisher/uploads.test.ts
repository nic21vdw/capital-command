import { mkdir, readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { dataPath } from "@/lib/paths";
import { deleteUpload, saveUploadFromStream } from "./uploads";

describe("incoming upload storage", () => {
  it("removes the unreturned partial upload directory on a disconnected body", async () => {
    const root = dataPath("uploads");
    await mkdir(root, { recursive: true });
    const before = (await readdir(root)).sort();
    const failure = new Error("request disconnected");
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      }
    });

    await expect(saveUploadFromStream(body, "master.mp4", "video/mp4")).rejects.toThrow("request disconnected");

    expect((await readdir(root)).sort()).toEqual(before);
  });

  it("keeps a completed upload intact for the queue", async () => {
    const bytes = Uint8Array.from([1, 3, 5, 7]);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    });

    const saved = await saveUploadFromStream(body, "My Master.mp4", "video/mp4");
    try {
      expect(await readFile(saved.path)).toEqual(Buffer.from(bytes));
    } finally {
      await deleteUpload(saved.id);
    }
  });
});
