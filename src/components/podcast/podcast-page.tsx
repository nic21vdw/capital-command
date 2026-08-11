"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, Pencil, RefreshCw, Trash2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import type { EpisodeCandidate } from "@/lib/podcast/candidates";
import type { FeedBlocker } from "@/lib/podcast/feed";
import type { PodcastEpisode, PodcastShow } from "@/lib/podcast/types";

type PodcastResponse = {
  show: PodcastShow;
  episodes: PodcastEpisode[];
  configured: boolean;
  feedUrl: string | null;
  publicBaseUrl: string | null;
  bucketConnected: boolean;
  blockers: FeedBlocker[];
  candidates: EpisodeCandidate[];
  feedWarning?: string;
};

const FIELDS: { key: keyof PodcastShow; label: string; hint?: string; long?: boolean }[] = [
  { key: "title", label: "Show title" },
  { key: "author", label: "Author" },
  { key: "email", label: "Owner email", hint: "Spotify emails this address to verify you own the show." },
  { key: "link", label: "Show link", hint: "Your YouTube channel is a fine answer." },
  { key: "artworkUrl", label: "Cover art URL", hint: "Square JPEG/PNG, 1400-3000px. Upload one below and this fills itself in." },
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
  // null means "not touched yet", which is what lets the stream's own episode
  // be preselected while still allowing it to be cleared back to nothing.
  const [picked, setPicked] = useState<string | null>(null);
  const requestedProject = useSearchParams().get("project");
  const [hostDraft, setHostDraft] = useState("");
  const [changingHost, setChangingHost] = useState(false);

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
      if ((json as PodcastResponse).feedWarning) toast.error((json as PodcastResponse).feedWarning!);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function uploadArtwork(file: File) {
    setBusy("artwork");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/podcast/artwork", { method: "POST", body });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "That image could not be used.");
      toast.success(`Cover art set — ${json.width}×${json.height}`);
      const refreshed = await fetch("/api/podcast").then((res) => res.json());
      apply(refreshed as PodcastResponse);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function savePublicBaseUrl() {
    const ok = await send("set-public-url", { url: hostDraft });
    if (ok) {
      setChangingHost(false);
      setHostDraft("");
      toast.success("Feed address saved and in use — nothing to restart");
    }
  }

  async function publishCandidate(candidate: EpisodeCandidate) {
    if (!candidate.hasAudio) {
      setBusy("publish-export");
      try {
        const response = await fetch(
          `/api/longform/projects/${candidate.projectId}/export/${candidate.exportId}/audio`,
          { method: "POST" }
        );
        if (!response.ok) {
          const json = await response.json().catch(() => ({}));
          throw new Error(json.error ?? "The MP3 could not be cut from that export.");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        setBusy(null);
        return;
      }
    }
    const ok = await send("publish-export", { projectId: candidate.projectId, exportId: candidate.exportId });
    if (ok) toast.success("Episode added to the feed");
  }

  if (!state || !draft) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the feed…
      </div>
    );
  }

  const ready = state.blockers.length === 0;
  const unpublished = state.candidates.filter((candidate) => !candidate.published);
  // `?project=` is the stream the sidebar handed this page. Pick its episode
  // rather than making him find it among every recording ever cut.
  const fromStream = requestedProject
    ? state.candidates.find((candidate) => candidate.projectId === requestedProject)
    : undefined;
  const selected =
    picked === null
      ? fromStream
      : state.candidates.find((candidate) => `${candidate.projectId}:${candidate.exportId}` === picked);

  return (
    <div>
      <PageHeader
        eyebrow="Step 2 · Formats"
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
              {state.feedUrl ?? "Not hosted yet — give the bucket its public address below and the feed gets a home."}
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
            {state.publicBaseUrl && !changingHost ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setHostDraft(state.publicBaseUrl ?? "");
                  setChangingHost(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" /> Change address
              </Button>
            ) : null}
          </div>
        </div>

        {state.bucketConnected && (!state.publicBaseUrl || changingHost) ? (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Public address of the bucket
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Input
                className="min-w-[16rem] flex-1"
                placeholder="https://pub-xxxxxxxxxxxx.r2.dev"
                value={hostDraft}
                spellCheck={false}
                onChange={(event) => setHostDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && busy === null) void savePublicBaseUrl();
                }}
              />
              <Button disabled={busy !== null} onClick={() => void savePublicBaseUrl()}>
                {busy === "set-public-url" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save and use it
              </Button>
              {changingHost ? (
                <Button variant="ghost" disabled={busy !== null} onClick={() => setChangingHost(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Cloudflare dashboard → R2 → your bucket → Settings → Public Development URL, or the custom domain you
              attached. Saved here it is used immediately and kept for next time — the app does not need restarting, and
              any stream whose episode was skipped for this can be published under Publish an episode.
            </p>
          </div>
        ) : null}

        {state.blockers.length > 0 ? (
          <ul className="mt-4 space-y-3 border-t border-[var(--border)] pt-4 text-sm">
            {state.blockers.map((blocker) => (
              <li key={blocker.code}>
                <p className="text-amber-200">{blocker.problem}</p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{blocker.fix}</p>
              </li>
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
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Upload cover art
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg"
                disabled={!state.configured || busy !== null}
                className="mt-1.5 block w-full text-sm text-[var(--muted-foreground)] file:mr-3 file:rounded-lg file:border file:border-[var(--border)] file:bg-white/5 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-white/10 disabled:opacity-50"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadArtwork(file);
                }}
              />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {busy === "artwork" ? "Uploading…" : "Checked for square and size before it goes anywhere."}
              </p>
            </div>
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

          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
              Publish an episode
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              The pipeline adds each finished edit on its own. Use this when it could not — or for an older edit it never
              saw.
            </p>
            {state.candidates.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                No finished long-form export to publish yet. Export an edit in the Long-form editor first.
              </p>
            ) : (
              <>
                <select
                  className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm text-white"
                  value={selected ? `${selected.projectId}:${selected.exportId}` : ""}
                  onChange={(event) => setPicked(event.target.value)}
                >
                  <option value="">
                    {unpublished.length > 0 ? "Choose a finished export…" : "Every export is already in the feed"}
                  </option>
                  {state.candidates.map((candidate) => (
                    <option
                      key={`${candidate.projectId}:${candidate.exportId}`}
                      value={`${candidate.projectId}:${candidate.exportId}`}
                      disabled={candidate.published}
                    >
                      {candidate.title} · {minutes(candidate.durationSec)}
                      {candidate.published ? " · already an episode" : candidate.hasAudio ? "" : " · MP3 not cut yet"}
                    </option>
                  ))}
                </select>
                <Button
                  className="mt-3"
                  disabled={busy !== null || !selected || selected.published || !state.configured}
                  onClick={() => selected && void publishCandidate(selected)}
                >
                  {busy === "publish-export" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {selected && !selected.hasAudio ? "Cut the MP3 and publish" : "Publish to the feed"}
                </Button>
                {!state.configured ? (
                  <p className="mt-2 text-xs text-amber-200">
                    Nothing can be published until the feed has a permanent public URL — see the reasons above.
                  </p>
                ) : null}
              </>
            )}
          </div>

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
