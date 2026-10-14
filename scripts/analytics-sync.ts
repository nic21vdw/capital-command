import path from "node:path";
import { config } from "dotenv";
import { syncAnalytics } from "@/lib/analytics/sync";
import { applyStoredCredentials } from "@/lib/publisher/credentials";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

async function main() {
  await applyStoredCredentials();
  const report = await syncAnalytics({ force: process.argv.includes("--force") });

  if (report.status === "busy") {
    console.log("Another sync is already running; nothing was started.");
    return;
  }
  console.log(`Analytics sync ${report.status}: ${report.fetched} of ${report.considered} due post(s) read.`);
  for (const account of report.accounts) {
    console.log(`  ${account.key}: ${account.status}, ${account.fetched} read${account.note ? ` - ${account.note}` : ""}`);
  }
  if (report.status === "error") process.exitCode = 1;
}

void main();
