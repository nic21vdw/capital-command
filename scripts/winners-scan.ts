import path from "node:path";
import { config } from "dotenv";
import { runAi } from "@/lib/ai";
import { atomicWriteFile } from "@/lib/storage/atomic-json";
import { readMetrics } from "@/lib/analytics/store";
import { dataPath } from "@/lib/paths";
import { findWinners } from "@/lib/winners/detect";
import { parseRemix, REMIX_SYSTEM, remixPrompt, remixProblems } from "@/lib/winners/remix";
import { winnersReport } from "@/lib/winners/report";
import { readExternalPosts, readWinners, writeWinners } from "@/lib/winners/store";
import type { WinnerEntry } from "@/lib/winners/types";

config({ path: path.join(process.cwd(), ".env"), quiet: true });

const TIMEZONE = process.env.PUBLISH_TIMEZONE?.trim() || "America/Toronto";

async function draft(entry: WinnerEntry, now: Date): Promise<WinnerEntry> {
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runAi({
      system: REMIX_SYSTEM,
      messages: [{ role: "user", content: remixPrompt(entry, null) + feedback }],
      maxTokens: 3000,
      temperature: 0.7,
      writer: "claude-code",
      writerSwitch: "WINNERS_WRITER"
    });
    if (!result?.text) return { ...entry, remixError: "the writer did not answer" };
    try {
      const remix = parseRemix(result.text, now, TIMEZONE);
      const problems = remixProblems(remix, entry);
      if (problems.length === 0) return { ...entry, remix, remixError: undefined };
      feedback = `\n\nYour last answer was refused: ${problems.join("; ")}. Fix those and answer again.`;
      if (attempt === 1) return { ...entry, remixError: problems.join("; ") };
    } catch (error) {
      feedback = `\n\nYour last answer was not valid JSON (${(error as Error).message}). Answer with the JSON only.`;
    }
  }
  return { ...entry, remixError: "no usable draft after two tries" };
}

async function main() {
  const now = new Date();
  const dryRun = process.argv.includes("--dry");
  const [metrics, external, store] = await Promise.all([readMetrics(), readExternalPosts(), readWinners()]);
  const winners = findWinners(Object.values(metrics.posts), now, external);
  console.log(`${winners.length} winner(s) at 2x the median or better in the last 30 days.`);
  for (const winner of winners) {
    const known = store.winners[winner.ideaId];
    const entry: WinnerEntry = known
      ? { ...known, evidence: winner.evidence, bestRatio: winner.bestRatio }
      : { ...winner, detectedAt: now.toISOString(), remix: null, status: "drafted" };
    console.log(`  ${winner.bestRatio}x  ${winner.title}${known?.remix ? " (drafted before)" : ""}`);
    store.winners[winner.ideaId] = dryRun || entry.remix || entry.status === "skipped" ? entry : await draft(entry, now);
  }
  if (dryRun) return;
  store.lastScanAt = now.toISOString();
  await writeWinners(store);
  const recent = Object.values(store.winners).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || b.bestRatio - a.bestRatio);
  await atomicWriteFile(dataPath("winners", "report.md"), winnersReport(recent));
  console.log(`Wrote ${dataPath("winners", "winners.json")} and report.md. Nothing was posted or booked.`);
}

void main();
