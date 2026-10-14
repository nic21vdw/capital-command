import { SOURCE_LABELS } from "@/lib/listening/model";
import { runListeningScan } from "@/lib/listening/run";
import { scanFailed } from "@/lib/listening/scan";
import { readListeningStore } from "@/lib/listening/store";

/**
 * Listening scan CLI - the same scan the /listening page and the two-hourly
 * schedule run.
 *
 *   npm run listening:scan
 *
 * Reads the keywords and source switches from data/listening/config.json in the
 * checkout it runs in, queries every enabled source, classifies and merges new
 * hits (deduped by url and by text). Exits 1 if any source failed - a 403 or 429
 * is printed with its status, never hidden - so a scheduler sees the failure.
 *
 * The running app already scans every two hours; run this from a terminal only
 * for a scan on demand. It does not share the app's single-flight lock, so do not
 * run it while the app is mid-scan.
 */

async function main() {
  const { report, classified, newLeads } = await runListeningScan();

  console.log(`Listening scan at ${report.at}`);
  if (report.sources.length === 0) console.error("  No sources are switched on - enable one on /listening.");
  for (const source of report.sources) {
    const label = SOURCE_LABELS[source.source];
    if (source.skipped) {
      console.log(`  ${label}: skipped - ${source.error ?? source.note ?? "nothing to do"}`);
    } else if (source.ok) {
      console.log(`  ${label}: ${source.queries} queries, ${source.matched} matching, ${source.added} new${source.note ? ` (${source.note})` : ""}`);
    } else {
      console.error(`  ${label}: FAILED${source.httpStatus ? ` (HTTP ${source.httpStatus})` : ""} - ${source.error}`);
      if (source.added > 0) console.error(`    ${source.added} new result(s) from before the failure were still saved.`);
    }
  }
  console.log(`  classified ${classified.ai} with the model, ${classified.heuristic} by keywords; ${newLeads} new high-score lead(s)`);
  const store = await readListeningStore();
  const waiting = store.results.filter((result) => result.status === "new").length;
  console.log(`  ${store.results.length} results on the list, ${waiting} waiting for triage`);
  if (scanFailed(report)) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
