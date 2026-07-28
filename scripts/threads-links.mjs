// Prints today's autopilot results with a live link per published post.
// Usage: node scripts/threads-links.mjs [YYYY-MM-DD]
import { readFileSync } from "node:fs";

const token = readFileSync(".env", "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("THREADS_ACCESS_TOKEN="))
  ?.slice("THREADS_ACCESS_TOKEN=".length)
  .trim();

const now = new Date();
const date = process.argv[2] ?? new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const queue = JSON.parse(readFileSync("data/threads-queue.json", "utf8")).filter((item) => item.batchDate === date);

if (queue.length === 0) {
  console.log(`Nothing scheduled for ${date}.`);
  process.exit(0);
}

const count = (status) => queue.filter((item) => item.status === status).length;
console.log(
  `${date}: ${count("published")} posted, ${count("pending")} pending, ${count("failed")} failed, ${count("skipped")} skipped`
);

for (const item of queue) {
  const at = new Date(item.publishAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (item.status !== "published") {
    console.log(`  ${at.padStart(8)}  ${item.status.padEnd(9)} ${item.note ?? item.error ?? ""}`);
    continue;
  }
  let link = `(id ${item.postId})`;
  try {
    const response = await fetch(`https://graph.threads.net/v1.0/${item.postId}?fields=permalink`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.permalink) link = data.permalink;
  } catch {
    // Offline or token expired — the id is still enough to find the post.
  }
  console.log(`  ${at.padStart(8)}  published ${link}`);
  console.log(`            ${item.text.slice(0, 78)}`);
}
