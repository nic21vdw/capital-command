import path from "node:path";
import { formatRestoreReport, restoreBackup } from "@/lib/backup/restore";
import { dataRoot } from "@/lib/paths";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const VALUE_FLAGS = new Set(["--data", "--staging", "--port"]);

function archiveArgument(): string | undefined {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (VALUE_FLAGS.has(args[index])) index += 1;
    else if (!args[index].startsWith("--")) return args[index];
  }
  return undefined;
}

async function main() {
  const archive = archiveArgument();
  if (!archive) {
    console.error("Usage: npm run backup:restore -- <backup.zip> [--live] [--staging <dir>] [--data <dir>] [--port 3000]");
    console.error("Without --live the backup is extracted to a staging folder and compared with data/; nothing is overwritten.");
    process.exitCode = 2;
    return;
  }

  try {
    const result = await restoreBackup({
      archive: path.resolve(archive),
      dataDir: flag("--data") ?? dataRoot(),
      rootDir: process.cwd(),
      live: process.argv.includes("--live"),
      stagingDir: flag("--staging"),
      port: flag("--port") ? Number(flag("--port")) : undefined
    });
    console.log(formatRestoreReport(result));
  } catch (error) {
    console.error(`Restore refused: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
