import { config } from "dotenv";
import path from "node:path";
import { dataRoot } from "@/lib/paths";
import { formatPruneReport, parsePruneArgs, pruneData } from "@/lib/retention/prune";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

async function main() {
  let args;
  try {
    args = parsePruneArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const report = await pruneData({
    dataDir: args.dataDir ? path.resolve(args.dataDir) : dataRoot(),
    apply: args.apply,
    sourceDays: args.sourceDays,
    queueBackend: process.env.PUBLISH_QUEUE_BACKEND
  });
  console.log(formatPruneReport(report));
  if (report.failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
