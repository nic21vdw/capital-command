import path from "node:path";
import { config } from "dotenv";
import { historyDaysFromEnv, KEEP_BACKUPS, runStateBackup } from "@/lib/backup/state-backup";
import { dataRoot } from "@/lib/paths";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function megabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const result = await runStateBackup({
    dataDir: flag("--data") ?? dataRoot(),
    rootDir: process.cwd(),
    destDir: flag("--dest"),
    limits: { historyDays: historyDaysFromEnv() }
  });

  if (!result.ok) {
    console.error(`Backup FAILED: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Backed up ${result.fileCount} state files (${megabytes(result.bytes)}) to:`);
  console.log(`  ${result.path}`);
  const { excludedSecrets, skipped, skippedCounts } = result.manifest;
  const present = excludedSecrets.filter((secret) => secret.present).length;
  console.log(
    `Left out on purpose: ${present} secret file(s) (listed in manifest.json), ${skipped.length} oversized or tooling item(s), ` +
      `${skippedCounts.history} older history journal(s), ${skippedCounts.derived} rebuildable source file(s).`
  );
  if (result.pruned.length > 0) console.log(`Removed ${result.pruned.length} older backup(s); the newest ${KEEP_BACKUPS} are kept.`);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
}

void main();
