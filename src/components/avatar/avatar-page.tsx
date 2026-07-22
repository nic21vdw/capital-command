"use client";

import { useMemo, useState } from "react";
import { Clapperboard, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import type { AvatarVideo } from "@/types/domain";

/**
 * Higgsfield avatar videos: real footage of Nic driven by a trained AI
 * avatar — no dialogue to write here, the scene/motion prompt does the work.
 */

function statusBadge(status: AvatarVideo["status"]) {
  const label = { queued: "Queued", processing: "Generating…", completed: "Ready", failed: "Failed" }[status];
  const tone =
    status === "completed"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : status === "failed"
        ? "border-red-400/30 bg-red-400/10 text-red-200"
        : "border-amber-400/30 bg-amber-400/10 text-amber-100";
  return <Badge className={tone}>{label}</Badge>;
}

export function AvatarPage() {
  const { data, loading, refresh } = useAppData();
  const avatarVideos = useMemo(() => data.avatarVideos ?? [], [data.avatarVideos]);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    if (!prompt.trim()) return void toast.error("Describe the scene you want the avatar in.");
    setGenerating(true);
    try {
      const response = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "Avatar video", prompt })
      });
      const json = (await response.json()) as { avatarVideo?: AvatarVideo; error?: string };
      if (!response.ok || !json.avatarVideo) {
        toast.error(json.error ?? "Could not start the avatar video.");
        return;
      }
      if (json.avatarVideo.status === "failed") {
        toast.error(json.avatarVideo.error ?? "Could not start the avatar video.");
      } else {
        toast.success("Avatar video queued — this can take a few minutes.");
        setTitle("");
        setPrompt("");
      }
      void refresh();
    } catch {
      toast.error("Could not start the avatar video.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Higgsfield"
        title="Avatar Videos"
        description="Generate real-footage-style clips of your Higgsfield avatar in any scene — no lines to deliver. Set up the avatar once with the Higgsfield CLI (higgsfield auth login), then queue scenes here."
      />

      <Card className="mb-6 space-y-3">
        <Input placeholder="Video title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} />
        <Textarea
          placeholder="Describe the scene — e.g. 'walking through a modern office talking on the phone, upbeat energy'"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="flex justify-end">
          <Button onClick={() => void generate()} disabled={generating}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generating ? "Queuing…" : "Generate"}
          </Button>
        </div>
      </Card>

      {avatarVideos.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <Clapperboard className="h-8 w-8 text-[var(--accent)]" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {loading ? "Loading…" : "No avatar videos yet — describe a scene above to generate one."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {avatarVideos.map((video) => (
            <AvatarVideoCard key={video.id} video={video} refresh={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function AvatarVideoCard({ video, refresh }: { video: AvatarVideo; refresh: () => Promise<void> | void }) {
  const remove = async () => {
    if (!window.confirm("Delete this avatar video?")) return;
    const response = await fetch(`/api/avatar/${video.id}`, { method: "DELETE" });
    if (response.ok) void refresh();
    else toast.error("Could not delete the avatar video.");
  };

  const checkStatus = async () => {
    const response = await fetch(`/api/avatar/${video.id}`, { cache: "no-store" });
    if (response.ok) void refresh();
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-white">{video.title}</h3>
          <p className="text-xs text-[var(--muted-foreground)]">{new Date(video.createdAt).toLocaleDateString()}</p>
        </div>
        {statusBadge(video.status)}
      </div>

      {video.status === "completed" && video.videoUrl ? (
        <video src={video.videoUrl} poster={video.thumbnailUrl} controls className="aspect-[9/16] w-full rounded-lg bg-black" />
      ) : (
        <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 text-center text-xs text-[var(--muted-foreground)]">
          {video.status === "failed" ? video.error ?? "Generation failed." : "Rendering…"}
        </div>
      )}

      <p className="line-clamp-2 text-xs text-[var(--muted-foreground)]">{video.prompt}</p>

      <div className="flex gap-2">
        {video.status === "processing" || video.status === "queued" ? (
          <Button variant="secondary" className="flex-1 px-3 py-1.5 text-xs" onClick={() => void checkStatus()}>
            Check status
          </Button>
        ) : null}
        <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => void remove()}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Card>
  );
}
