"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Music4, Sparkles, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import type { MusicTrack } from "@/lib/longform/types";
import type { MusicJobRecord } from "@/lib/music/jobs";
import type { MusicModel } from "@/lib/music/models";
import { cn } from "@/lib/utils";

/**
 * Music Studio: one prompt, five licensed models, and every finished take
 * lands in the same music library the Long-Form Editor pulls from. The form
 * reshapes itself around the selected model's capabilities — duration, lyrics
 * and takes only appear where the model actually supports them.
 */

type StudioState = {
  configured: boolean;
  models: MusicModel[];
  jobs: MusicJobRecord[];
  tracks: MusicTrack[];
};

const POLL_MS = 5000;

export function MusicStudioPage() {
  const [state, setState] = useState<StudioState>({ configured: true, models: [], jobs: [], tracks: [] });
  const [loading, setLoading] = useState(true);
  const [modelId, setModelId] = useState<string>("lyria3-pro");
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [samples, setSamples] = useState(1);
  const [starting, setStarting] = useState(false);
  const [writingBrief, setWritingBrief] = useState(false);
  const aliveRef = useRef(true);

  const model = useMemo(
    () => state.models.find((entry) => entry.id === modelId) ?? state.models[0] ?? null,
    [state.models, modelId]
  );
  const pending = state.jobs.filter((job) => job.status === "pending");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/music", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as StudioState;
    if (aliveRef.current) setState(data);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh().finally(() => {
      if (aliveRef.current) setLoading(false);
    });
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  // Polling each pending job is what advances it: the poll that sees the model
  // finish is the one that imports its takes into the library.
  useEffect(() => {
    if (pending.length === 0) return;
    const ids = pending.map((job) => job.requestId);
    const timer = setInterval(() => {
      void Promise.all(
        ids.map((requestId) => fetch(`/api/music?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" }))
      )
        .then(() => refresh())
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  // Picking a model re-fits the controls to it, so a length carried over from
  // a 10-minute model can't outrun a 3-minute one.
  const selectModel = (next: MusicModel) => {
    setModelId(next.id);
    setDurationSec(next.duration ? next.duration.default : null);
    setSamples(1);
    if (next.vocals === "none") setInstrumental(true);
  };

  const writeBrief = async () => {
    const idea = prompt.trim();
    if (!idea || writingBrief) return;
    setWritingBrief(true);
    try {
      const response = await fetch("/api/music/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea })
      });
      const data = (await response.json()) as { brief?: { title: string; style: string; prompt: string }; error?: string };
      if (!response.ok || !data.brief) {
        toast.error(data.error ?? "Could not write that prompt.");
        return;
      }
      // ACE-Step wants tags, everything else wants prose.
      setPrompt(model?.vocals === "field" && model.id === "ace-step" ? data.brief.style : data.brief.prompt);
      if (!title.trim()) setTitle(data.brief.title);
    } catch {
      toast.error("Could not reach the prompt writer.");
    } finally {
      setWritingBrief(false);
    }
  };

  const generate = async () => {
    if (!model || starting) return;
    if (!prompt.trim()) return void toast.error("Describe the music you want.");
    setStarting(true);
    try {
      const response = await fetch("/api/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: model.id,
          prompt,
          title,
          lyrics,
          instrumental,
          durationSec: durationSec ?? undefined,
          samples
        })
      });
      const data = (await response.json()) as { job?: MusicJobRecord; error?: string };
      if (!response.ok || !data.job) {
        toast.error(data.error ?? "Could not start that generation.");
        return;
      }
      toast.success(`${model.label} is writing your track.`);
      await refresh();
    } catch {
      toast.error("Could not reach the studio.");
    } finally {
      setStarting(false);
    }
  };

  const removeTrack = async (track: MusicTrack) => {
    try {
      await fetch(`/api/longform/music/${track.id}`, { method: "DELETE" });
      await refresh();
    } catch {
      toast.error("Could not delete that track.");
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Create"
        title="Music Studio"
        description="Write background music with licensed models on fal.ai. Every finished take lands in the shared music library, ready to drop onto a long-form timeline."
      />

      {!state.configured && (
        <Card className="mb-6 border-amber-400/30 bg-amber-400/5">
          <p className="text-sm text-amber-200">
            Set <code className="rounded bg-black/30 px-1.5 py-0.5">FAL_KEY</code> in <code>.env</code> to turn the studio
            on. Grab one from fal.ai/dashboard/keys — generations are billed per second of audio by fal.
          </p>
        </Card>
      )}

      <Card className="mb-6 space-y-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Model</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {state.models.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectModel(entry)}
                className={cn(
                  "rounded-lg border p-3 text-left transition",
                  entry.id === model?.id
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] hover:border-[var(--border-strong)]"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-white">{entry.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{entry.vendor}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{entry.blurb}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge>{entry.duration ? `${entry.duration.min}–${entry.duration.max}s` : "model picks length"}</Badge>
                  <Badge>{entry.vocals === "none" ? "instrumental" : "vocals"}</Badge>
                  {entry.maxSamples > 1 && <Badge>up to {entry.maxSamples} takes</Badge>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {model && (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="music-prompt" className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {model.promptLabel}
                </label>
                <button
                  type="button"
                  onClick={() => void writeBrief()}
                  disabled={writingBrief || !prompt.trim()}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] transition hover:underline disabled:opacity-50"
                >
                  {writingBrief ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  Write it for me
                </button>
              </div>
              <Textarea
                id="music-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={model.promptPlaceholder}
              />
            </div>

            <Input placeholder="Track title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} />

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-white">
                <input
                  type="checkbox"
                  checked={instrumental}
                  disabled={model.vocals === "none"}
                  onChange={(event) => setInstrumental(event.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Instrumental
                {model.vocals === "none" && (
                  <span className="text-xs text-[var(--muted-foreground)]">({model.label} has no vocals)</span>
                )}
              </label>

              {model.duration && (
                <label className="flex flex-1 items-center gap-3 text-sm text-white">
                  <span className="whitespace-nowrap text-[var(--muted-foreground)]">Length</span>
                  <input
                    type="range"
                    min={model.duration.min}
                    max={model.duration.max}
                    step={5}
                    value={durationSec ?? model.duration.default}
                    onChange={(event) => setDurationSec(Number(event.target.value))}
                    className="flex-1 accent-[var(--accent)]"
                  />
                  <span className="w-20 text-right tabular-nums">{formatLength(durationSec ?? model.duration.default)}</span>
                </label>
              )}

              {model.maxSamples > 1 && (
                <label className="flex items-center gap-2 text-sm text-white">
                  <span className="text-[var(--muted-foreground)]">Takes</span>
                  <select
                    value={samples}
                    onChange={(event) => setSamples(Number(event.target.value))}
                    className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm text-white"
                  >
                    {Array.from({ length: model.maxSamples }, (_, index) => index + 1).map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {model.vocals === "field" && !instrumental && (
              <Textarea
                value={lyrics}
                onChange={(event) => setLyrics(event.target.value)}
                placeholder={"[verse]\nWrite the lyrics here, or leave it blank and the model writes them."}
                className="min-h-24"
              />
            )}

            <div className="flex justify-end">
              <Button onClick={() => void generate()} disabled={starting || !state.configured}>
                {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {starting ? "Starting…" : `Generate with ${model.label}`}
              </Button>
            </div>
          </>
        )}
      </Card>

      {state.jobs.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Recent generations</p>
          {state.jobs.slice(0, 8).map((job) => (
            <Card key={job.requestId} className="flex items-center gap-3 py-3">
              {job.status === "pending" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
              ) : (
                <Music4
                  className={cn("h-4 w-4 shrink-0", job.status === "complete" ? "text-emerald-300" : "text-red-400")}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{job.title}</p>
                <p className="truncate text-xs text-[var(--muted-foreground)]">
                  {job.modelLabel} ·{" "}
                  {job.status === "pending"
                    ? typeof job.queuePosition === "number"
                      ? `queued (position ${job.queuePosition})`
                      : "generating…"
                    : job.status === "complete"
                      ? `${job.trackIds.length} take${job.trackIds.length === 1 ? "" : "s"} in your library`
                      : (job.error ?? "failed")}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        Library · {state.tracks.length} track{state.tracks.length === 1 ? "" : "s"}
      </p>
      {state.tracks.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Music4 className="h-8 w-8 text-[var(--accent)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {loading ? "Loading…" : "No music yet — describe a track above and generate one."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {state.tracks.map((track) => (
            <Card key={track.id} className="space-y-2 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{track.fileName}</p>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                    {formatLength(track.durationSec)}
                    {track.origin ? ` · ${track.origin.modelLabel}` : " · uploaded"}
                    {track.origin?.prompt ? ` · ${track.origin.prompt}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeTrack(track)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:border-red-400/60 hover:text-red-400"
                  aria-label={`Delete ${track.fileName}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <audio controls preload="none" src={`/api/longform/music/${track.id}`} className="h-9 w-full" />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
