"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Clock3,
  Download,
  ExternalLink,
  Loader2,
  Podcast,
  RadioTower,
  Rss,
  Scissors,
  Send,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type {
  PodcastConnection,
  PodcastDestinationId,
  PodcastEpisode,
  PodcastGenerationMode
} from "@/lib/podcasts/types";

type PodcastJob = {
  id: string;
  fileName: string;
  createdAt: string;
  durationSec: number;
  hasTranscript: boolean;
  episodeCount: number;
};

type PodcastOverview = {
  jobs: PodcastJob[];
  episodes: PodcastEpisode[];
  connections: PodcastConnection[];
  feedUrl: string;
  publicFeedReady: boolean;
};

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function localDateTimeValue(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function EpisodeCard({ episode, onSaved }: { episode: PodcastEpisode; onSaved: () => void }) {
  const [title, setTitle] = useState(episode.title);
  const [description, setDescription] = useState(episode.description);
  const [scheduledAt, setScheduledAt] = useState(localDateTimeValue(episode.scheduledAt));
  const [destinations, setDestinations] = useState<PodcastDestinationId[]>(episode.destinations);
  const [saving, setSaving] = useState(false);

  const toggleDestination = (id: PodcastDestinationId) => {
    setDestinations((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const save = async (publishNow = false) => {
    setSaving(true);
    try {
      const response = await fetch("/api/podcasts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: episode.id,
          title,
          description,
          destinations,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          status: scheduledAt ? "scheduled" : "draft",
          publishNow
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save the episode.");
      toast.success(publishNow ? "Episode added to the live RSS feed." : scheduledAt ? "Episode scheduled." : "Draft saved.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/6 text-[var(--accent)]">
            {episode.kind === "full" ? <Podcast className="h-4 w-4" /> : <Scissors className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{episode.kind === "full" ? "Full episode" : "Topic episode"}</Badge>
              <Badge className="capitalize">{episode.status}</Badge>
              <span className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                <Clock3 className="h-3 w-3" /> {durationLabel(episode.durationSec)}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">From {episode.sourceName}</p>
          </div>
        </div>
        <a
          href={`/api/podcasts/audio?id=${encodeURIComponent(episode.id)}`}
          download={episode.fileName}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-white transition hover:bg-white/8"
        >
          <Download className="h-3.5 w-3.5" /> MP3
        </a>
      </div>

      <audio className="w-full" controls preload="metadata" src={`/api/podcasts/audio?id=${encodeURIComponent(episode.id)}`} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]">
        <div className="space-y-3">
          <label className="block text-xs font-medium text-[var(--muted-foreground)]">
            Episode title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]"
            />
          </label>
          <label className="block text-xs font-medium text-[var(--muted-foreground)]">
            Show notes
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-sm text-white outline-none transition focus:border-[var(--accent)]"
            />
          </label>
        </div>
        <div className="space-y-3 rounded-lg border border-[var(--border)] bg-white/[0.025] p-3">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Distribution</p>
          <div className="grid grid-cols-2 gap-2">
            {(["spotify", "apple", "youtube", "substack"] as PodcastDestinationId[]).map((id) => {
              const selected = destinations.includes(id);
              const label = id === "apple" ? "Apple" : id === "youtube" ? "YouTube" : id[0].toUpperCase() + id.slice(1);
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => toggleDestination(id)}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${
                    selected ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-white" : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
                  }`}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]" : "border-[var(--border)]"}`}>
                    {selected ? <Check className="h-3 w-3" /> : null}
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)]">
            Release date and time
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void save(false)} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
              {scheduledAt ? "Save schedule" : "Save draft"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void save(true)} disabled={saving} className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> Publish to feed
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function PodcastStudioPage() {
  const [overview, setOverview] = useState<PodcastOverview | null>(null);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [mode, setMode] = useState<PodcastGenerationMode>("full-and-chapters");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/podcasts", { cache: "no-store" });
    const next = (await response.json()) as PodcastOverview;
    setOverview(next);
    setSelectedJobId((current) => current || next.jobs[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load().catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error));
      setLoading(false);
    });
  }, [load]);

  const selectedJob = useMemo(() => overview?.jobs.find((job) => job.id === selectedJobId), [overview, selectedJobId]);

  const generate = async () => {
    if (!selectedJobId) return;
    setGenerating(true);
    try {
      const response = await fetch("/api/podcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJobId, mode })
      });
      const result = (await response.json()) as { episodes?: PodcastEpisode[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Podcast generation failed.");
      toast.success(`Generated ${result.episodes?.length ?? 0} podcast audio file${result.episodes?.length === 1 ? "" : "s"}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  if (loading || !overview) {
    return <div className="flex min-h-[50vh] items-center justify-center text-[var(--muted-foreground)]"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Create & distribute"
        title="Podcast Studio"
        description="Turn a processed livestream into a normalized full episode, shorter topic episodes, show notes and a schedule that feeds Spotify, Apple Podcasts, YouTube Music and Substack."
        actions={
          <a href="/master-calendar" className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-white transition hover:bg-white/8">
            <CalendarClock className="h-4 w-4" /> Open Master Calendar
          </a>
        }
      />

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {overview.connections.map((connection) => (
          <Card key={connection.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/6 text-[var(--accent)]">
                {connection.delivery === "rss" ? <Rss className="h-4 w-4" /> : <RadioTower className="h-4 w-4" />}
              </span>
              <Badge className={connection.ready ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : ""}>
                {connection.ready ? "Feed ready" : connection.delivery === "rss" ? "Setup needed" : "Manual"}
              </Badge>
            </div>
            <h2 className="mt-3 text-sm font-semibold text-white">{connection.label}</h2>
            <p className="mt-1 min-h-10 text-xs leading-relaxed text-[var(--muted-foreground)]">{connection.note}</p>
            <a href={connection.setupUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
              Open setup <ExternalLink className="h-3 w-3" />
            </a>
          </Card>
        ))}
      </div>

      <Card className="mb-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--accent)]" /><h2 className="font-semibold text-white">Generate from a livestream</h2></div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">The full MP3 is loudness-normalized for podcasts. Topic episodes follow transcript pauses and stay roughly 4–15 minutes long.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(260px,1fr)_220px_auto]">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              Processed livestream
              <select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]">
                {overview.jobs.length === 0 ? <option value="">No finished livestreams</option> : null}
                {overview.jobs.map((job) => <option key={job.id} value={job.id}>{job.fileName}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              Output package
              <select value={mode} onChange={(event) => setMode(event.target.value as PodcastGenerationMode)} className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--accent)]">
                <option value="full-and-chapters">Full + topic episodes</option>
                <option value="full">Full episode only</option>
                <option value="chapters">Topic episodes only</option>
              </select>
            </label>
            <Button onClick={() => void generate()} disabled={!selectedJobId || generating} className="gap-2 self-end">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Podcast className="h-4 w-4" />}
              {generating ? "Generating…" : "Generate MP3s"}
            </Button>
          </div>
        </div>
        {selectedJob ? <p className="mt-3 text-xs text-[var(--muted-foreground)]">{durationLabel(selectedJob.durationSec)} source · {selectedJob.hasTranscript ? "Transcript ready" : "Transcript will be generated"} · {selectedJob.episodeCount} existing outputs</p> : null}
      </Card>

      <Card className="mb-5 border-dashed bg-white/[0.02] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Podcast RSS feed</p><p className="mt-1 break-all text-sm text-white">{overview.feedUrl}</p></div>
          <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(overview.feedUrl).then(() => toast.success("RSS feed copied."))} className="gap-1.5"><Rss className="h-3.5 w-3.5" /> Copy feed</Button>
        </div>
        {!overview.publicFeedReady ? <p className="mt-2 text-xs text-amber-200">This local feed works for previewing, but podcast directories need a public HTTPS URL. Set PODCAST_PUBLIC_BASE_URL when Command is hosted.</p> : null}
      </Card>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div><p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Audio library</p><h2 className="mt-1 text-xl font-semibold text-white">Episodes & topic cuts</h2></div>
        <Badge>{overview.episodes.length} total</Badge>
      </div>
      {overview.episodes.length === 0 ? (
        <Card className="border-dashed py-12 text-center"><Podcast className="mx-auto h-7 w-7 text-[var(--muted-foreground)]" /><p className="mt-3 text-sm font-medium text-white">No podcast audio yet</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">Choose a finished livestream above and generate the first package.</p></Card>
      ) : (
        <div className="space-y-4">{overview.episodes.map((episode) => <EpisodeCard key={`${episode.id}:${episode.updatedAt}`} episode={episode} onSaved={() => void load()} />)}</div>
      )}
    </div>
  );
}

