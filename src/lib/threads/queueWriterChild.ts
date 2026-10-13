import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { mutateQueue } from "@/lib/threads/queue";
import type { ThreadsQueueItem } from "@/lib/threads/types";

const [name, barrier, countText] = process.argv.slice(2);
const writers = ["a", "b"];
const count = Number(countText);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(target: string) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function startTogether() {
  await writeFile(path.join(barrier, `ready-${name}`), "");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await Promise.all(writers.map((writer) => exists(path.join(barrier, `ready-${writer}`))));
    if (ready.every(Boolean)) return;
    await sleep(5);
  }
  throw new Error("the other writer never started");
}

function item(id: string): ThreadsQueueItem {
  return {
    id,
    batchDate: "2026-10-03",
    slot: 1,
    accountId: "primary",
    version: "text",
    topic: "queue",
    format: "insight",
    text: id,
    publishAt: "2026-10-03T12:00:00Z",
    status: "pending",
    attempts: 0,
    createdAt: "2026-10-02T12:00:00Z"
  };
}

async function main() {
  await startTogether();
  for (let index = 0; index < count; index += 1) {
    await mutateQueue((items) => ({ items: [...items, item(`${name}-${index}`)], result: undefined }));
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
