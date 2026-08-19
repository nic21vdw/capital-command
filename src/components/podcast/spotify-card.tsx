"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Link2, Loader2, RefreshCw, Search, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SpotifyShow } from "@/lib/spotify/api";
import type { SpotifyStatus } from "@/lib/spotify/status";

export function SpotifyCard({
  showTitle,
  episodeCount,
  onStatus
}: {
  showTitle: string;
  episodeCount: number;
  onStatus: (status: SpotifyStatus) => void;
}) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpotifyShow[] | null>(null);

  const apply = useCallback(
    (next: SpotifyStatus) => {
      setStatus(next);
      onStatus(next);
    },
    [onStatus]
  );

  useEffect(() => {
    void fetch("/api/spotify")
      .then((response) => response.json())
      .then(apply)
      .catch(() => undefined);
  }, [apply]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "spotify") toast.success("Spotify connected");
    const error = params.get("connect_error");
    if (error) toast.error(error);
    if (params.has("connected") || params.has("connect_error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function send(action: string, body: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const response = await fetch("/api/spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "That did not work.");
      if (action === "search-shows") {
        const found = json.results as SpotifyShow[];
        setResults(found);
        if (found.length === 0) toast.error("Spotify has no show by that name yet.");
      } else {
        apply(json as SpotifyStatus);
        setResults(null);
      }
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return (
      <Card className="mb-5">
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Asking Spotify…
        </div>
      </Card>
    );
  }

  if (!status.configured) {
    return (
      <Card className="mb-5">
        <h2 className="text-sm font-semibold text-white">Spotify</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Put SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env (developer.spotify.com/dashboard → your app) and this
          page can tell you which episodes Spotify has actually pulled in.
        </p>
      </Card>
    );
  }

  const liveCount = Object.keys(status.live).length;

  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Spotify</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {status.connected
              ? `Connected as ${status.profile?.name ?? "your account"}${status.profile?.email ? ` (${status.profile.email})` : ""}.`
              : "Connect the account to read the show through Spotify's own eyes."}{" "}
            Publishing still happens through the feed — Spotify has no upload API for creators.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.connected ? (
            <>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void send("refresh").then((ok) => ok && toast.success("Re-read from Spotify"))}
              >
                {busy === "refresh" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Re-check
              </Button>
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void send("disconnect").then((ok) => ok && toast.success("Spotify disconnected"))}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button onClick={() => window.location.assign("/api/auth/spotify")}>Connect Spotify</Button>
          )}
        </div>
      </div>

      {status.error ? (
        <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-amber-200">{status.error}</p>
      ) : null}

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        {status.show ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{status.show.name}</p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {status.show.totalEpisodes} episode{status.show.totalEpisodes === 1 ? "" : "s"} on Spotify · {liveCount}{" "}
                of {episodeCount} from this feed are live
                {status.pending.length > 0 ? ` · ${status.pending.length} still to be pulled in` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
                <Check className="mr-1.5 h-3.5 w-3.5" /> Show linked
              </Badge>
              <a
                className="inline-flex items-center gap-1 text-sm text-white underline decoration-white/30 underline-offset-4"
                href={status.show.url}
                target="_blank"
                rel="noreferrer"
              >
                Open <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <Button variant="ghost" disabled={busy !== null} onClick={() => void send("unlink-show")}>
                <Unlink className="mr-2 h-4 w-4" /> Not this show
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-[var(--muted-foreground)]">
              {status.showId
                ? "The linked show could not be read back from Spotify. Search for it again below."
                : "Point the app at the show on Spotify once the feed has been claimed there. Paste its link, or search by name."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input
                className="min-w-[16rem] flex-1"
                placeholder={showTitle || "Show name or open.spotify.com link"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void send("search-shows", { query: query.trim() || showTitle })}
              >
                {busy === "search-shows" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search
              </Button>
              <Button
                disabled={busy !== null || !query.trim()}
                onClick={() =>
                  void send("link-show", { show: query.trim() }).then((ok) => ok && toast.success("Show linked"))
                }
              >
                <Link2 className="mr-2 h-4 w-4" /> Link
              </Button>
            </div>
            {results && results.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {results.map((show) => (
                  <li
                    key={show.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{show.name}</p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        {show.publisher} · {show.totalEpisodes} episodes
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        void send("link-show", { show: show.id }).then((ok) => ok && toast.success("Show linked"))
                      }
                    >
                      Use this
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}
