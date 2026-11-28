import type { WinnerEntry } from "@/lib/winners/types";

export function winnersReport(entries: WinnerEntry[]): string {
  const out: string[] = ["# Winners to remake", ""];
  for (const entry of entries) {
    out.push(`## ${entry.title}`, "");
    for (const item of entry.evidence) {
      out.push(`- ${item.platform}: ${item.value} ${item.metric} at ${item.ageDays} days, ${item.ratio}x the median of ${item.peers} posts`);
    }
    out.push("");
    if (!entry.remix) {
      out.push(`No drafts yet${entry.remixError ? `: ${entry.remixError}` : "."}`, "");
      continue;
    }
    const { short, threads, tweet, retest, flags, angle } = entry.remix;
    out.push(`Angle: ${angle}`, "", "### Short script", "", `Hook: ${short.hook}`, "");
    short.lines.forEach((line, index) => out.push(`${index + 1}. ${line}${short.headlines[index] ? ` [${short.headlines[index]}]` : ""}`));
    out.push("", `CTA: ${short.cta}`, "", `B-roll: ${short.broll.join("; ")}`, "");
    out.push("### Threads", "", threads, "", "### Tweet draft (Nic posts by hand)", "", tweet, "");
    out.push("### Retest", "", `Between ${retest.from} and ${retest.by} with the hook: ${retest.hook}`, "", retest.note, "");
    if (flags.length > 0) out.push("### Check before use", "", ...flags.map((flag) => `- ${flag}`), "");
  }
  return out.join("\n");
}
