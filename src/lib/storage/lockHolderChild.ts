import { appendFile } from "node:fs/promises";
import { withFileLock } from "@/lib/storage/file-lock";

const [target, spans] = process.argv.slice(2);

async function main() {
  for (let round = 0; round < 5; round += 1) {
    await withFileLock(target, async () => {
      const entered = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 15));
      await appendFile(spans, `${entered} ${Date.now()}\n`);
    });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
