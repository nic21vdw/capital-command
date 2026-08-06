"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import type { PodcastEpisode, PodcastShow } from "@/lib/podcast/types";

type PodcastResponse = {
  show: PodcastShow;
  episodes: PodcastEpisode[];
  configured: boolean;
  feedUrl: string | null;
  problems: string[];
};

const FIELDS: { key: keyof PodcastShow; label: string; hint?: string; long?: boolean }[] = [
  { key: "title", label: "Show title" },
  { key: "author", label: "Author" },
  { key: "email", label: "Owner email", hint: "Spotify emails this address to verify you own the show." },
  { key: "link", label: "Show link", hint: "Your YouTube channel is a fine answer." },
  { key: "artworkUrl", label: "Cover art URL", hint: "Square JPEG/PNG, 1400-3000px, on a public HTTPS URL." },
  { key: "category", label: "Category" },
  { key: "language", label: "Language" },
  { key: "copyright", label: "Copyright" },
  { key: "description", label: "Description", long: true }
];

function minutes(seconds: number) {
  const total = Math.round(seconds / 60);
  return total >= 60 ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total}m`;
}

export function PodcastPage() {
  const [state, setState] = useState<PodcastResponse | null>(null);
  const [draft, setDraft] = useState<PodcastShow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback((next: PodcastResponse) => {
    setState(next);
    setDraft(next.show);
  }, []);

  useEffect(() => {
    void fetch("/api/podcast")
      .then((response) => response.json())
      .then(apply)
      .catch(() => toast.error("Could not read the podcast feed."));
  }, [apply]);

  async function send(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const response = await fetch("/api/podcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "That did not work.");
      apply(json as PodcastResponse);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!state || !draft) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the feed…
      </div>
    );
  }

  const ready = state.configured && state.problems.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow="Formats"
        title="Podcast / Spotify"
        description="Spotify has no upload API, so the app publishes an RSS feed and Spotify pulls from it. Every long-form edit the pipeline finishes is added here automatically as an episode."
        actions={
          <Button
            variant="secondary"
            disabled={busy !== null || !state.configured}
            onClick={() => void send("refresh").then((ok) => ok && toast.success("Feed republished"))}
          >
            {busy === "refresh" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Republish feed
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Feed URL</p>
            <p className="mt-1 break-all text-sm text-white">
              {state.feedUrl ??
                "Not hosted yet. The R2 bucket is connected but private: turn on its Public Development URL (or attach a custom domain) in the Cloudflare dashboard, then put that address in S3_PUBLIC_BASE_URL."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={ready ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : ""}>
              {ready ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5" /> Ready to submit
                </>
              ) : (
                <>
                  <TriangleAlert className="mr-1.5 h-3.5 w-3.5" /> Not submittable yet
                </>
              )}
            </Badge>
            {state.feedUrl ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(state.feedUrl!)
                    .then(() => toast.success("Feed URL copied"))
                    .catch(() => toast.error("Could not copy"))
                }
              >
                <Copy className="mr-2 h-4 w-4" /> Copy
              </Button>
            ) : null}
          </div>
        </div>

        {state.problems.length > 0 ? (
          <ul className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-4 text-sm text-amber-200">
            {state.problems.map((problem) => (
              <li key={problem}>· {problem}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted-foreground)]">
            Paste this URL once into Spotify for Creators → Add your podcast → I have an existing podcast, then click the link
            in the verification email. After that every new episode arrives on its own.{" "}
            <a
              className="inline-flex items-center gap-1 text-white underline decoration-white/30 underline-offset-4"
              href="https://creators.spotify.com/dash/podcasts"
              target="_blank"
              rel="noreferrer"
            >
              Open Spotify for Creators <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <h2 className="text-sm font-semibold text-white">Show details</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            These become the channel tags in the feed. Spotify reads them again on every fetch, so a fix here reaches the
            listing without resubmitting.
          </p>
          <div className="mt-4 space-y-3">
            {FIELDS.map((field) => (
              <div key={field.key}>
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  {field.label}
                </label>
                {field.long ? (
                  <Textarea
                    className="mt-1.5"
                    rows={4}
                    value={String(draft[field.key])}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  />
                ) : (
                  <Input
                    className="mt-1.5"
                    value={String(draft[field.key])}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  />
                )}
                {field.hint ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{field.hint}</p> : null}
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                checked={draft.explicit}
                onChange={(event) => setDraft({ ...draft, explicit: event.target.checked })}
              />
              Explicit content
            </label>
          </div>
          <Button
            className="mt-4"
            disabled={busy !== null}
            onClick={() => void send("save-show", { show: draft }).then((ok) => ok && toast.success("Show details saved"))}
          >
            {busy === "save-show" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save show details
          </Button>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-white">
            Episodes <span className="text-[var(--muted-foreground)]">({state.episodes.length})</span>
          </h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            One per long-form edit. Shorts never come here — they are not episodes.
          </p>
          {state.episodes.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--muted-foreground)]">
              Nothing published yet. The next stream the pipeline finishes lands here on its own.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {state.episodes.map((episode) => (
                <li
                  key={episode.id}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{episode.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {new Date(episode.publishedAt).toLocaleDateString()} · {minutes(episode.durationSec)} ·{" "}
                        {(episode.bytes / 1_000_000).toFixed(0)} MB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="px-2"
                      disabled={busy !== null}
                      onClick={() =>
                        void send("remove-episode", { episodeId: episode.id }).then(
                          (ok) => ok && toast.success("Episode removed from the feed")
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
