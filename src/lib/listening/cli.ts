import { SOURCE_LABELS } from "@/lib/listening/model";
import { applyScan, collectScan, scanFailed } from "@/lib/listening/scan";
import { readListeningStore, updateListeningStore } from "@/lib/listening/store";

/**
 * Listening scan CLI — the same "Scan now" the /listening page runs, so it can
 * be put on a schedule later.
 *
 *   npm run listening:scan
 *
 * Reads the keyword groups and source switches from data/listening.json in the
 * checkout it runs in, queries Hacker News and Reddit, and merges new results
 * (deduped by url). Exits 1 if any source failed — a 403 or 429 from Reddit is
 * printed with its status, never hidden — so a scheduler sees the failure.
 *
 * Nothing registers this as a scheduled task. If it is ever scheduled, register
 * it from the production checkout only (see AGENTS.md).
 */

async function main() {
  const collected = await collectScan(await readListeningStore());
  let report = null as ReturnType<typeof applyScan>["report"] | null;
  const store = await updateListeningStore((current) => {
    const applied = applyScan(current, collected);
    report = applied.report;
    return applied.store;
  });
  const finished = report as ReturnType<typeof applyScan>["report"] | null;
  if (!finished) throw new Error("The scan produced no report.");

  console.log(`Listening scan at ${finished.at}`);
  if (finished.sources.length === 0) console.error("  No sources are switched on - enable Hacker News or Reddit on /listening.");
  for (const source of finished.sources) {
    const label = SOURCE_LABELS[source.source];
    if (source.ok) {
      console.log(`  ${label}: ${source.queries} queries, ${source.matched} matching, ${source.added} new`);
    } else {
      console.error(`  ${label}: FAILED${source.httpStatus ? ` (HTTP ${source.httpStatus})` : ""} - ${source.error}`);
      if (source.added > 0) console.error(`    ${source.added} new result(s) from before the failure were still saved.`);
    }
  }
  const fresh = store.results.filter((result) => result.status === "new").length;
  console.log(`  ${store.results.length} results on the list, ${fresh} waiting for triage`);
  if (scanFailed(finished)) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
