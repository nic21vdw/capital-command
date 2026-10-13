import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { PublishQueue, newPlatformState } from "@/lib/publisher/queue";
import { FileQueueStore } from "@/lib/publisher/store";
import type { QueueItem } from "@/lib/publisher/types";

const [file, name, barrier] = process.argv.slice(2);
const writers = ["a", "b"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

class GatedStore extends FileQueueStore {
  private gated = false;

  private async gate() {
    if (this.gated) return;
    this.gated = true;
    await writeFile(path.join(barrier, `ready-${name}`), "");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const ready = await Promise.all(writers.map((writer) => exists(path.join(barrier, `ready-${writer}`))));
      if (ready.every(Boolean)) return;
      await sleep(10);
    }
    throw new Error("the other writer never reached its save");
  }

  override async withLock<T>(work: () => Promise<T>): Promise<T> {
    await this.gate();
    return super.withLock(work);
  }

  override async save(text: string): Promise<void> {
    await this.gate();
    return super.save(text);
  }
}

async function main() {
  const queue = new PublishQueue(new GatedStore(file));
  await queue.load();
  const item: QueueItem = {
    id: `item-${name}`,
    clipPath: `data/clips/${name}.mp4`,
    title: `Clip ${name}`,
    caption: "",
    hashtags: [],
    publishAt: new Date(Date.UTC(2026, 9, 20, 12, name === "a" ? 0 : 5)).toISOString(),
    visibility: "private",
    createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(),
    platforms: { youtube: newPlatformState() }
  };
  await queue.add(item, "api-publish-edit");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
