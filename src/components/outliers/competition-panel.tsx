"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, ExternalLink, Loader2, Sparkles, Swords } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { readJson, type RadarState } from "@/components/outliers/use-outlier-radar";
import { cn } from "@/lib/utils";
import {
  buildCompetitorTrendReport,
  channelGroupOptions,
  DEFAULT_COMPETITION_GROUP
} from "@/lib/youtube/competitor-trends";
import { formatDurationSeconds, type CompetitorInsight } from "@/lib/youtube/outliers";

/**
 * Competition analysis: one button that refreshes stats for the labeled
 * channels, shows the cross-channel trend breakdown (recomputed live from the
 * store — same pure function the server uses), and generates an AI brief on
 * what to make next. Sits alongside the Radar without touching how the
 * watchlist or the outlier table work.
 */

const ALL_GROUPS = "__all__";

function formatCount(value: number): string {
  return Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function CompetitionPanel({
  state,
  setState,
  scanning,
  runScan
}: {
  state: RadarState;
  setState: React.Dispatch<React.SetStateAction<RadarState | null>>;
  scanning: boolean;
  runScan: (force: boolean) => Promise<boolean>;
}) {
  const groups = useMemo(() => channelGroupOptions(state.channels), [state.channels]);
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL_GROUPS);
  const [analyzing, setAnalyzing] = useState(false);

  const group = selectedGroup === ALL_GROUPS ? null : selectedGroup;
  // Reset a stale selection if its last channel was unlabeled/removed.
  const effectiveGroup = group !== null && !groups.some((g) => g === group) ? null : group;

  const report = useMemo(
    () => buildCompetitorTrendReport(state.channels, state.outliers, { group: effectiveGroup }),
    [state.channels, state.outliers, effectiveGroup]
  );

  const latestInsight: CompetitorInsight | null = useMemo(
    () => state.competitorInsights.find((insight) => insight.group === effectiveGroup) ?? null,
    [state.competitorInsights, effectiveGroup]
  );

  const analyze = async () => {
    if (analyzing || scanning) return;
    setAnalyzing(true);
    try {
      // One click: refresh stats (cooldown-aware, so repeat clicks are cheap)…
      if (state.configured) {
        const ok = await runScan(false);
        if (!ok) return;
      }
      // …then generate the AI brief over the fresh numbers.
      if (!state.insightsConfigured) {
        toast.info("Trend breakdown updated. Set ANTHROPIC_API_KEY to also get the AI competition brief.");
        return;
      }
      const data = await readJson<{ insight: CompetitorInsight; competitorInsights: CompetitorInsight[] }>(
        await fetch("/api/youtube/outliers/competitor-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group: effectiveGroup })
        })
      );
      setState((current) => (current ? { ...current, competitorInsights: data.competitorInsights } : current));
      toast.success("Competition brief generated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  };

  const hasLabeledChannels = report.channelCount > 0;
  const busy = analyzing || scanning;

  return (
    <Card className="mt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Swords className="h-4 w-4 text-[var(--accent)]" /> Competition analysis
          <Badge>
            {report.channelCount} channel{report.channelCount === 1 ? "" : "s"}
          </Badge>
        </h2>
        <div className="flex items-center gap-2">
          {groups.length > 1 ? (
            <Select
              value={selectedGroup}
              onChange={(event) => setSelectedGroup(event.target.value)}
              className="h-10 w-44"
              aria-label="Channel group to analyze"
            >
              <option value={ALL_GROUPS}>All labeled channels</option>
              {groups.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </Select>
          ) : null}
          <Button onClick={() => void analyze()} disabled={busy || !hasLabeledChannels}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {analyzing ? "Analyzing…" : "Analyze competition"}
          </Button>
        </div>
      </div>

      {!hasLabeledChannels ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
          No channels are labeled yet. Type a label — e.g. <span className="text-white">{DEFAULT_COMPETITION_GROUP}</span> — in
          the group field on a watchlist channel above, then analyze the group here with one click.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Group-level stat tiles */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: "Channels analyzed",
                value: String(report.channelCount),
                detail: `${report.channelsWithOutliers} with breakouts`
              },
              {
                label: "Breakout videos",
                value: String(report.outlierCount),
                detail: `${report.recentOutlierCount} in the last 90 days`
              },
              {
                label: "Shorts vs long-form",
                value:
                  report.formatSplit.shorts + report.formatSplit.long > 0
                    ? `${report.formatSplit.shorts} / ${report.formatSplit.long}`
                    : "—",
                detail: report.formatSplit.unknown > 0 ? `${report.formatSplit.unknown} unknown length` : "among breakouts"
              },
              {
                label: "Median multiplier",
                value: report.medianMultiplier !== null ? `${report.medianMultiplier.toFixed(1)}×` : "—",
                detail: "over channel baseline"
              }
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">{stat.label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">{stat.value}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{stat.detail}</p>
              </div>
            ))}
          </div>

          {report.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {report.warnings.map((warning) => (
                <p key={warning} className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 shrink-0" /> {warning}
                </p>
              ))}
            </div>
          ) : null}

          {report.outlierCount === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
              No breakouts flagged for this group yet — Analyze competition pulls fresh stats and flags videos at{" "}
              {state.config.multiplier}× their channel&apos;s baseline.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* What the group is winning with */}
              <div className="space-y-4">
                {report.themes.length > 0 ? (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Trending topics across breakouts
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {report.themes.map((theme) => (
                        <span
                          key={theme.phrase}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                            theme.channelCount >= 2
                              ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-white"
                              : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)]"
                          )}
                          title={theme.examples.map((example) => `${example.channelTitle}: ${example.title}`).join("\n")}
                        >
                          {theme.phrase}
                          <span className="tabular-nums text-[var(--muted-foreground)]">
                            {theme.videoCount}v · {theme.channelCount}ch
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {report.titleSignals.length > 0 ? (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      Packaging patterns in breakout titles
                    </h3>
                    <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
                      {report.titleSignals.map((signal) => (
                        <li key={signal.id} className="flex items-center justify-between gap-2">
                          <span>{signal.label}</span>
                          <span className="tabular-nums text-xs">
                            {signal.videoCount} video{signal.videoCount === 1 ? "" : "s"} ·{" "}
                            {Math.round(signal.share * 100)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">What this means for you</h3>
                  <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
                    {report.takeaways.map((note) => (
                      <li key={note} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Top breakouts across the group */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Top competitor breakouts
                </h3>
                <div className="mt-2 space-y-2">
                  {report.topOutliers.map((video) => (
                    <a
                      key={video.videoId}
                      href={video.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 transition hover:border-white/25"
                    >
                      <Badge
                        className={cn(
                          "shrink-0 tabular-nums",
                          video.multiplier >= 10
                            ? "border-red-400/30 bg-red-500/15 text-red-200"
                            : video.multiplier >= 5
                              ? "border-amber-400/30 bg-amber-500/15 text-amber-200"
                              : "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
                        )}
                      >
                        {video.multiplier.toFixed(1)}×
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-white" title={video.title}>
                          {video.title}
                        </span>
                        <span className="block truncate text-xs text-[var(--muted-foreground)]">
                          {video.channelTitle} · {formatCount(video.views)} views
                          {video.durationSeconds !== null ? ` · ${formatDurationSeconds(video.durationSeconds)}` : ""}
                        </span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI brief */}
          {latestInsight ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                  <Sparkles className="h-3.5 w-3.5" /> AI competition brief
                </h3>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {formatDate(latestInsight.generatedAt)} · {latestInsight.channelCount} channels ·{" "}
                  {latestInsight.outlierCount} breakouts
                </p>
              </div>
              <div className="prose prose-invert max-w-none text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{latestInsight.insights}</ReactMarkdown>
              </div>
            </div>
          ) : report.outlierCount > 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">
              {state.insightsConfigured
                ? "Analyze competition also generates an AI brief: cross-channel trends, what's working, and 5 next-video ideas grounded in the numbers above."
                : "Set ANTHROPIC_API_KEY in .env.local to add an AI brief — cross-channel trends and next-video ideas — to this analysis."}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
