import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { PublishQueue } from "@/lib/publisher/queue";
import { FileQueueStore } from "@/lib/publisher/store";

const [file, role, barrier] = process.argv.slice(2);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function signal(name: string) {
  await writeFile(path.join(barrier, name), "");
}

async function waitFor(name: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await exists(path.join(barrier, name))) return;
    await sleep(10);
  }
  throw new Error(`never saw ${name}`);
}

async function main() {
  const queue = new PublishQueue(new FileQueueStore(file));
  const item = (await queue.get("post"))!;
  const now = new Date("2026-10-01T10:00:00.000Z");

  if (role === "publisher") {
    await signal("publisher-loaded");
    await waitFor("claimer-loaded");
    await queue.claim(item, "youtube", now);
    await queue.recordSuccess(item, "youtube", { status: "published", postId: "yt-from-publisher" }, now);
    await signal("publisher-done");
    return;
  }

  await signal("claimer-loaded");
  await waitFor("publisher-done");
  const claimed = await queue.claim(item, "youtube", now);
  await writeFile(path.join(barrier, "claim-result"), String(claimed));
  if (claimed) await queue.recordSuccess(item, "youtube", { status: "published", postId: "yt-from-claimer" }, now);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
