"use client";

import Link from "next/link";
import { Loader2, Trophy } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ExperimentReport, ExperimentStatus, VariantReport } from "@/lib/experiments/evaluate";
import { experimentGroups, experimentTitle, reasonLabel, shortDate, statusCounts, variantStateLabel } from "@/lib/experiments/view";
import type { VariantOrigin } from "@/lib/experiments/types";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<ExperimentStatus, BadgeTone> = { running: "info", decided: "success", inconclusive: "warning" };

const ORIGIN_LABEL: Record<VariantOrigin, string> = { original: "Original", ai: "AI written", edited: "Edited" };

function VariantRow({ variant, winner, timeZone }: { variant: VariantReport; winner: boolean; timeZone: string }) {
  const measured = variant.state === "measured" && variant.views !== null;
  return (
    <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm", winner ? "tone-success tone-edge" : "border-[var(--border)]")}>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white">{variant.id}</span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-white">{variant.value}</p>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          {ORIGIN_LABEL[variant.origin]}
          {variant.publishAt ? ` · goes out ${shortDate(variant.publishAt, timeZone)}` : ""}
        </p>
      </div>
      <div className="text-right text-xs text-[var(--muted-foreground)]">
        {winner ? (
          <span className="tone-success tone-text mb-0.5 flex items-center justify-end gap-1 font-semibold">
            <Trophy className="h-3.5 w-3.5" aria-hidden /> Winner
          </span>
        ) : null}
        {measured ? (
          <>
            <span className="font-semibold tabular-nums text-white">{Math.round(variant.views!).toLocaleString("en-US")}</span> views
            {variant.viewsIndex !== null ? <span className="block">{variant.viewsIndex.toFixed(1)}x a typical post</span> : null}
          </>
        ) : variant.state === "measuring" && variant.windowEndsAt ? (
          <span>Measuring until {shortDate(variant.windowEndsAt, timeZone)}</span>
        ) : (
          <span>{variantStateLabel(variant.state)}</span>
        )}
      </div>
    </li>
  );
}

function ExperimentCard({ report, timeZone }: { report: ExperimentReport; timeZone: string }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-white">{experimentTitle(report)}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Started {shortDate(report.createdAt, timeZone)} · each variant measured over {report.windowHours} hours
          </p>
        </div>
        <Badge tone={STATUS_TONE[report.status]}>{reasonLabel(report.reason)}</Badge>
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">{report.summary}</p>
      <ul className="space-y-2" aria-label="Variants">
        {report.variants.map((variant) => (
          <VariantRow key={variant.id} variant={variant} winner={report.winnerId === variant.id} timeZone={timeZone} />
        ))}
      </ul>
    </Card>
  );
}

function Group({ title, reports, timeZone }: { title: string; reports: ExperimentReport[]; timeZone: string }) {
  if (reports.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        {title} ({reports.length})
      </h3>
      <div className="grid gap-3 lg:grid-cols-2">
        {reports.map((report) => (
          <ExperimentCard key={report.id} report={report} timeZone={timeZone} />
        ))}
      </div>
    </div>
  );
}

export function ExperimentsSection({
  state,
  reports,
  timeZone
}: {
  state: "loading" | "ready" | "error";
  reports: ExperimentReport[];
  timeZone: string;
}) {
  const groups = experimentGroups(reports);
  return (
    <section aria-label="Experiments" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Experiments</h2>
        {state === "ready" ? <span className="text-xs text-[var(--muted-foreground)]">{statusCounts(reports)}</span> : null}
      </div>
      {state === "loading" ? (
        <p className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the experiments
        </p>
      ) : null}
      {state === "error" ? <p className="text-sm text-[var(--muted-foreground)]">The experiments could not be read. Reload the page to try again.</p> : null}
      {state === "ready" && reports.length === 0 ? (
        <Card className="text-sm text-[var(--muted-foreground)]">
          No experiments yet. To test titles or hooks on a clip, open it in the{" "}
          <Link href="/uploading-center" className="underline underline-offset-2">
            Uploading Center
          </Link>{" "}
          and choose Test titles on its card. Nothing is tested unless you start it.
        </Card>
      ) : null}
      {state === "ready" ? (
        <>
          <Group title="Running" reports={groups.running} timeZone={timeZone} />
          <Group title="Decided" reports={groups.decided} timeZone={timeZone} />
          <Group title="Inconclusive" reports={groups.inconclusive} timeZone={timeZone} />
        </>
      ) : null}
    </section>
  );
}
