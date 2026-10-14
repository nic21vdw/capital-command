import path from "node:path";
import { config } from "dotenv";
import { INBOX_PLATFORM_LABEL } from "@/lib/inbox/types";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

async function main() {
  const { applyStoredCredentials } = await import("@/lib/publisher/credentials");
  await applyStoredCredentials();

  const { syncInbox } = await import("@/lib/inbox/sync");
  const { readInbox, unreadCount } = await import("@/lib/inbox/store");
  const report = await syncInbox({ force: process.argv.includes("--force") });

  console.log(`Inbox sync at ${report.at}`);
  let broken = false;
  for (const [platform, entry] of Object.entries(report.platforms)) {
    if (!entry) continue;
    const label = INBOX_PLATFORM_LABEL[platform as keyof typeof INBOX_PLATFORM_LABEL];
    const failed = entry.status === "needs-auth" || entry.status === "needs-scope" || entry.status === "error";
    if (failed) broken = true;
    console.log(
      `  ${label}: ${entry.status}, ${entry.fetchedPosts} post(s) read, ${entry.added} new${entry.detail ? ` - ${entry.detail}` : ""}`
    );
  }
  console.log(`  ${unreadCount(await readInbox())} unread in the inbox`);
  if (broken) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
