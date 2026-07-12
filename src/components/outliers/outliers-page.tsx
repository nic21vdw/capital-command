"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Flame,
  Loader2,
  Plus,
  RefreshCw,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { CompetitionPanel } from "@/components/outliers/competition-panel";
import { readJson, useOutlierRadar, type RadarState } from "@/components/outliers/use-outlier-radar";
import { channelGroupOptions, DEFAULT_COMPETITION_GROUP, normalizeGroupLabel } from "@/lib/youtube/competitor-trends";
import { cn } from "@/lib/utils";
import {
  buildOutlierInsights,
  formatDurationSeconds,
  type Outlier,
  type OutlierConfig,
  type ScanRun,
  type WatchlistChannel
} from "@/lib/youtube/outliers";

/**
 * Outlier Radar: manage a watchlist of channels to monitor, trigger stats
 * pulls, and browse the flagged outliers with inline free-text tagging.
 * All state lives server-side in data/youtube-outliers.json; this component
 * just talks to /api/youtube/watchlist and /api/youtube/outliers.
 */

type SortKey = "multiplier" | "detectedAt" | "views" | "publishedAt";

function formatCount(value: number): string {
  return Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function OutliersPage() {
  const { state, setState, loadError, load } = useOutlierRadar();
  const [channelInput, setChannelInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("multiplier");
  const [sortDesc, setSortDesc] = useState(true);
  const [configDraft, setConfigDraft] = useState<OutlierConfig | null>(null);
  const [expandedVideoIds, setExpandedVideoIds] = useState<Record<string, boolean>>({});
  const [confirmRemoveChannel, setConfirmRemoveChannel] = useState<WatchlistChannel | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const addChannel = async () => {
    const input = channelInput.trim();
    if (!input || adding) return;
    setAdding(true);
    try {
      const data = await readJson<{ channels: WatchlistChannel[]; added: WatchlistChannel }>(
        await fetch("/api/youtube/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input })
        })
      );
      setState((current) => (current ? { ...current, channels: data.channels } : current));
      setChannelInput("");
      toast.success(`Added ${data.added.title} to the watchlist.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  };

  const removeChannel = async (channel: WatchlistChannel) => {
    try {
      const data = await readJson<{ channels: WatchlistChannel[] }>(
        await fetch(`/api/youtube/watchlist?id=${encodeURIComponent(channel.id)}`, { method: "DELETE" })
      );
      setState((current) => (current ? { ...current, channels: data.channels } : current));
      toast.success(`Removed ${channel.title}. Its flagged outliers are kept.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const runScan = async (force: boolean): Promise<boolean> => {
    if (scanning) return false;
    setScanning(true);
    try {
      const data = await readJson<RadarState & { run: ScanRun }>(
        await fetch(`/api/youtube/outliers/run${force ? "?force=1" : ""}`, { method: "POST" })
      );
      setState((current) => ({
        ...data,
        configured: current?.configured ?? true,
        insightsConfigured: current?.insightsConfigured ?? false
      }));
      const { run } = data;
      const summary = `Checked ${run.channelsChecked}, skipped ${run.channelsSkipped} (cached), failed ${run.channelsFailed} · ${run.unitsUsed} quota units · ${Math.max(0, run.newOutliers)} new outlier${run.newOutliers === 1 ? "" : "s"}`;
      if (run.notes.length > 0) toast.warning(run.notes.join(" "));
      else if (run.channelsFailed > 0) toast.warning(`${summary}. Check the watchlist for per-channel errors.`);
      else toast.success(summary);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setScanning(false);
    }
  };

  const saveGroup = async (channel: WatchlistChannel, rawGroup: string) => {
    const group = normalizeGroupLabel(rawGroup);
    if (group === normalizeGroupLabel(channel.group)) return;
    try {
      const data = await readJson<{ channels: WatchlistChannel[] }>(
        await fetch("/api/youtube/watchlist", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: channel.id, group })
        })
      );
      setState((current) => (current ? { ...current, channels: data.channels } : current));
      toast.success(group ? `${channel.title} labeled “${group}”.` : `Label removed from ${channel.title}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const saveTag = async (videoId: string, tag: string, previous: string) => {
    if (tag === previous) return;
    try {
      await readJson(
        await fetch("/api/youtube/outliers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId, tag })
        })
      );
      setState((current) =>
        current
          ? { ...current, outliers: current.outliers.map((o) => (o.videoId === videoId ? { ...o, tag } : o)) }
          : current
      );
      toast.success("Tag saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const saveConfig = async () => {
    if (!configDraft) return;
    try {
      const data = await readJson<{ config: OutlierConfig }>(
        await fetch("/api/youtube/outliers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: configDraft })
        })
      );
      setState((current) => (current ? { ...current, config: data.config } : current));
      setConfigDraft(null);
      toast.success("Detection settings saved. They apply on the next stats pull.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const sortedOutliers = useMemo(() => {
    if (!state) return [];
    const direction = sortDesc ? -1 : 1;
    return [...state.outliers].sort((a, b) => {
      const value =
        sortKey === "multiplier"
          ? a.multiplier - b.multiplier
          : sortKey === "views"
            ? a.views - b.views
            : sortKey === "publishedAt"
              ? a.publishedAt.localeCompare(b.publishedAt)
              : a.detectedAt.localeCompare(b.detectedAt);
      return value * direction;
    });
  }, [state, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const channelsById = useMemo(() => new Map((state?.channels ?? []).map((c) => [c.id, c])), [state]);

  const toggleExpanded = (videoId: string) =>
    setExpandedVideoIds((current) => ({ ...current, [videoId]: !current[videoId] }));

  const lastRun = state?.runs[0] ?? null;
  const config = configDraft ?? state?.config ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="YouTube tools"
        title="Outlier Radar"
        description="Watch other channels, baseline them on the median views of their recent uploads, and flag videos breaking out above the baseline. One click analyzes your competition as a group — shared breakout topics, packaging patterns, and an AI brief on what to make next."
      />

      {loadError ? (
        <Card className="mb-4 border-red-500/30 bg-red-500/10 text-sm text-red-200">
          <p className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {loadError}
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void load()}>
            Retry
          </Button>
        </Card>
      ) : null}

      {state && !state.configured ? (
        <Card className="mb-4 border-amber-500/30 bg-amber-500/10 text-sm text-amber-200">
          <p className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            YouTube is not connected. Set YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET and use Connect YouTube in the
            Uploading Center — the Radar reuses that connection read-only.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Watchlist */}
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Channel watchlist</h2>
            <Badge>{state ? `${state.channels.length} channel${state.channels.length === 1 ? "" : "s"}` : "…"}</Badge>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void addChannel();
            }}
          >
            <Input
              value={channelInput}
              onChange={(event) => setChannelInput(event.target.value)}
              placeholder="Channel URL, @handle, or UC… channel id"
              disabled={adding}
            />
            <Button type="submit" disabled={adding || !channelInput.trim()} className="shrink-0">
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add
            </Button>
          </form>
          <div className="mt-4 space-y-2">
            {state && state.channels.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
                No channels yet — paste a channel URL or @handle above to start monitoring.
              </p>
            ) : null}
            {state?.channels.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
              >
                {channel.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={channel.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
                    {channel.title.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://www.youtube.com/channel/${channel.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm font-medium text-white hover:underline"
                    >
                      {channel.title}
                    </a>
                    {channel.handle ? (
                      <span className="truncate text-xs text-[var(--muted-foreground)]">{channel.handle}</span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                    {channel.baseline && channel.baseline.sampleSize > 0
                      ? `Baseline ${formatCount(channel.baseline.medianViews)} median views · last ${channel.baseline.sampleSize} videos`
                      : "No baseline yet — run a stats pull"}
                    {channel.lastFetchedAt ? ` · fetched ${formatDate(channel.lastFetchedAt)}` : ""}
                  </p>
                  {channel.lastError ? (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-300">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate" title={channel.lastError}>
                        {channel.lastError}
                      </span>
                    </p>
                  ) : null}
                </div>
                <Input
                  defaultValue={channel.group}
                  // Uncontrolled + key so external refreshes update the value.
                  key={`${channel.id}:${channel.group}`}
                  list="channel-group-suggestions"
                  placeholder="Group (optional)"
                  aria-label={`Group label for ${channel.title}`}
                  title={`Optional: label channels (e.g. ${DEFAULT_COMPETITION_GROUP}) to filter the Competition analysis to a subset — by default it covers every channel here`}
                  className="h-9 w-40 shrink-0"
                  onBlur={(event) => void saveGroup(channel, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  }}
                />
                <Button
                  variant="ghost"
                  className="shrink-0 px-2"
                  aria-label={`Remove ${channel.title}`}
                  title="Remove from watchlist"
                  onClick={() => setConfirmRemoveChannel(channel)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <datalist id="channel-group-suggestions">
            {[DEFAULT_COMPETITION_GROUP, ...(state ? channelGroupOptions(state.channels) : [])]
              .filter((label, index, all) => all.indexOf(label) === index)
              .map((label) => (
                <option key={label} value={label} />
              ))}
          </datalist>
        </Card>

        {/* Run log + detection settings */}
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-white">Run log</h2>
            {lastRun ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
                  <p className="font-medium text-white">Last pull · {formatDate(lastRun.at)}</p>
                  <p className="mt-1 text-[var(--muted-foreground)]">
                    {lastRun.unitsUsed} quota units of 10,000/day · {lastRun.channelsChecked} checked ·{" "}
                    {lastRun.channelsSkipped} cached · {lastRun.channelsFailed} failed
                  </p>
                  {lastRun.notes.map((note) => (
                    <p key={note} className="mt-1 flex items-center gap-1 text-amber-300">
                      <AlertTriangle className="h-3 w-3 shrink-0" /> {note}
                    </p>
                  ))}
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto text-xs text-[var(--muted-foreground)]">
                  {state?.runs.slice(1).map((run) => (
                    <p key={run.id} className="tabular-nums">
                      {formatDate(run.at)} · {run.unitsUsed}u · {run.channelsChecked} checked
                      {run.channelsFailed ? ` · ${run.channelsFailed} failed` : ""}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No pulls yet.</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-white">Detection settings</h2>
            {config ? (
              <div className="space-y-3 text-sm">
                <label className="flex items-center justify-between gap-3 text-[var(--muted-foreground)]">
                  Outlier multiplier
                  <Input
                    type="number"
                    min={1}
                    step={0.5}
                    className="h-9 w-24 text-right"
                    value={config.multiplier}
                    onChange={(e) => setConfigDraft({ ...config, multiplier: Number(e.target.value) })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-[var(--muted-foreground)]">
                  Baseline window (videos)
                  <Input
                    type="number"
                    min={3}
                    max={50}
                    className="h-9 w-24 text-right"
                    value={config.baselineWindow}
                    onChange={(e) => setConfigDraft({ ...config, baselineWindow: Number(e.target.value) })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-[var(--muted-foreground)]">
                  Cache cooldown (minutes)
                  <Input
                    type="number"
                    min={0}
                    className="h-9 w-24 text-right"
                    value={config.cooldownMinutes}
                    onChange={(e) => setConfigDraft({ ...config, cooldownMinutes: Number(e.target.value) })}
                  />
                </label>
                {configDraft ? (
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={() => void saveConfig()}>
                      Save settings
                    </Button>
                    <Button variant="ghost" onClick={() => setConfigDraft(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    A video is flagged at ≥ {config.multiplier}× the channel&apos;s median views over its last{" "}
                    {config.baselineWindow} uploads.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
            )}
          </Card>
        </div>
      </div>

      {/* Competition analysis across labeled channels */}
      {state ? <CompetitionPanel state={state} setState={setState} scanning={scanning} runScan={runScan} /> : null}

      {/* Outliers table */}
      <Card className="mt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Flame className="h-4 w-4 text-[var(--accent)]" /> Flagged outliers
            <Badge>{sortedOutliers.length}</Badge>
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void runScan(true)} disabled={scanning || !state?.configured}>
              Force refresh
            </Button>
            <Button onClick={() => void runScan(false)} disabled={scanning || !state?.configured}>
              {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {scanning ? "Pulling stats…" : "Pull stats"}
            </Button>
          </div>
        </div>
        {sortedOutliers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
            Nothing flagged yet. Add channels to the watchlist and run a stats pull — videos at{" "}
            {state ? `${state.config.multiplier}×` : "3×"} their channel&apos;s baseline will land here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                  <th className="pb-2 pr-3 font-medium">Video</th>
                  <th className="pb-2 pr-3 font-medium">Channel</th>
                  {(
                    [
                      ["views", "Views"],
                      ["multiplier", "Multiplier"]
                    ] as Array<[SortKey, string]>
                  ).map(([key, label]) => (
                    <th key={key} className="pb-2 pr-3 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className={cn(
                          "inline-flex items-center gap-1 uppercase tracking-wider transition hover:text-white",
                          sortKey === key && "text-white"
                        )}
                      >
                        {label}
                        {sortKey === key ? (
                          sortDesc ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUp className="h-3 w-3" />
                          )
                        ) : null}
                      </button>
                    </th>
                  ))}
                  <th className="pb-2 pr-3 font-medium">Length</th>
                  {(
                    [
                      ["publishedAt", "Published"],
                      ["detectedAt", "Detected"]
                    ] as Array<[SortKey, string]>
                  ).map(([key, label]) => (
                    <th key={key} className="pb-2 pr-3 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className={cn(
                          "inline-flex items-center gap-1 uppercase tracking-wider transition hover:text-white",
                          sortKey === key && "text-white"
                        )}
                      >
                        {label}
                        {sortKey === key ? (
                          sortDesc ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUp className="h-3 w-3" />
                          )
                        ) : null}
                      </button>
                    </th>
                  ))}
                  <th className="pb-2 font-medium">Tag / notes</th>
                </tr>
              </thead>
              <tbody>
                {sortedOutliers.map((outlier) => {
                  const expanded = Boolean(expandedVideoIds[outlier.videoId]);
                  return (
                    <OutlierRow
                      key={outlier.videoId}
                      outlier={outlier}
                      channel={channelsById.get(outlier.channelId)}
                      expanded={expanded}
                      onToggle={() => toggleExpanded(outlier.videoId)}
                      onSaveTag={saveTag}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(confirmRemoveChannel)}
        title="Remove channel?"
        description={
          confirmRemoveChannel
            ? `This removes ${confirmRemoveChannel.title} from the watchlist. Its flagged outliers are kept.`
            : undefined
        }
        onClose={() => setConfirmRemoveChannel(null)}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRemoveChannel(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirmRemoveChannel) void removeChannel(confirmRemoveChannel);
              setConfirmRemoveChannel(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

const OUTLIER_TABLE_COLUMNS = 8;

function OutlierRow({
  outlier,
  channel,
  expanded,
  onToggle,
  onSaveTag
}: {
  outlier: Outlier;
  channel: WatchlistChannel | undefined;
  expanded: boolean;
  onToggle: () => void;
  onSaveTag: (videoId: string, tag: string, previous: string) => Promise<void>;
}) {
  return (
    <>
      <tr className={cn("border-b border-[var(--border)] last:border-b-0", expanded && "border-b-0")}>
        <td className="max-w-[300px] py-2.5 pr-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? "Hide video breakdown" : "Show video breakdown"}
              title={expanded ? "Hide breakdown" : "Why did this break out?"}
              className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <a
              href={outlier.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-1.5 text-white hover:underline"
              title={outlier.title}
            >
              <span className="truncate">{outlier.title}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
            </a>
          </div>
        </td>
        <td className="max-w-[160px] truncate py-2.5 pr-3 text-[var(--muted-foreground)]" title={outlier.channelTitle}>
          {outlier.channelTitle}
        </td>
        <td className="py-2.5 pr-3 tabular-nums text-white" title={`baseline ${formatCount(outlier.baselineViews)}`}>
          {formatCount(outlier.views)}
        </td>
        <td className="py-2.5 pr-3">
          <Badge
            className={cn(
              "tabular-nums",
              outlier.multiplier >= 10
                ? "border-red-400/30 bg-red-500/15 text-red-200"
                : outlier.multiplier >= 5
                  ? "border-amber-400/30 bg-amber-500/15 text-amber-200"
                  : "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
            )}
          >
            {outlier.multiplier.toFixed(1)}×
          </Badge>
        </td>
        <td className="py-2.5 pr-3 tabular-nums text-[var(--muted-foreground)]">
          {outlier.durationSeconds !== null ? formatDurationSeconds(outlier.durationSeconds) : "—"}
        </td>
        <td className="py-2.5 pr-3 text-[var(--muted-foreground)]">{formatDay(outlier.publishedAt)}</td>
        <td className="py-2.5 pr-3 text-[var(--muted-foreground)]">{formatDay(outlier.detectedAt)}</td>
        <td className="py-2.5">
          <Input
            defaultValue={outlier.tag}
            // Uncontrolled + key so external refreshes (e.g. a scan) update the value.
            key={`${outlier.videoId}:${outlier.tag}`}
            placeholder="hook style, topic, format…"
            className="h-9 min-w-[180px]"
            onBlur={(event) => void onSaveTag(outlier.videoId, event.target.value.trim(), outlier.tag)}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
          />
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-[var(--border)] last:border-b-0">
          <td colSpan={OUTLIER_TABLE_COLUMNS} className="pb-4 pl-6 pr-2 pt-1">
            <OutlierInsightsPanel outlier={outlier} channel={channel} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * The per-video breakdown behind the row chevron: duration vs the channel
 * norm, views/day, like rate, and CPR (comments per 1,000 views), plus the
 * generated what-worked / what-to-check notes from buildOutlierInsights.
 */
function OutlierInsightsPanel({ outlier, channel }: { outlier: Outlier; channel: WatchlistChannel | undefined }) {
  const insights = useMemo(() => buildOutlierInsights(outlier, channel), [outlier, channel]);

  const stats: Array<{ label: string; value: string; comparison: string | null }> = [
    {
      label: "Duration",
      value:
        insights.durationSeconds !== null
          ? `${formatDurationSeconds(insights.durationSeconds)}${insights.format === "short" ? " · Short" : ""}`
          : "—",
      comparison:
        insights.channelMedianDurationSeconds !== null
          ? `channel ~${formatDurationSeconds(insights.channelMedianDurationSeconds)}`
          : null
    },
    {
      label: "Views / day",
      value: insights.viewsPerDay !== null ? formatCount(insights.viewsPerDay) : "—",
      comparison: "since publish"
    },
    {
      label: "Like rate",
      value: insights.likeRate !== null ? formatRate(insights.likeRate) : "—",
      comparison: insights.channelMedianLikeRate !== null ? `channel ~${formatRate(insights.channelMedianLikeRate)}` : null
    },
    {
      label: "CPR (comments / 1k views)",
      value: insights.cpr !== null ? insights.cpr.toFixed(1) : "—",
      comparison: insights.channelMedianCpr !== null ? `channel ~${insights.channelMedianCpr.toFixed(1)}` : null
    }
  ];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">{stat.label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">{stat.value}</p>
            {stat.comparison ? <p className="text-xs text-[var(--muted-foreground)]">{stat.comparison}</p> : null}
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">What worked</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
            {insights.whatWorked.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" />
                {note}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">What to check</h3>
          {insights.watchouts.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted-foreground)]">
              {insights.watchouts.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" />
                  {note}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Not enough engagement data to compare against the channel yet.
            </p>
          )}
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            Built from public stats only — CTR and retention are private to the channel owner.
          </p>
        </div>
      </div>
      {insights.missingData.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {insights.missingData.map((note) => (
            <p key={note} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0" /> {note}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
