"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Bookmark, Lightbulb, Loader2, PenLine, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { VideoIdea, VideoIdeaStatus } from "@/types/domain";

interface GenerateResponse {
  ideas: VideoIdea[];
  reason: string | null;
  configured: boolean;
}

const COMPETITION_STYLES: Record<VideoIdea["competition"], string> = {
  low: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  high: "border-rose-400/30 bg-rose-400/10 text-rose-200"
};

function scoreColor(score: number) {
  if (score >= 75) return "text-emerald-300";
  if (score >= 55) return "text-amber-300";
  return "text-[var(--muted-foreground)]";
}

export function IdeasPage() {
  const { data, loading, refresh } = useAppData();
  const [seed, setSeed] = useState("");
  const [generating, setGenerating] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [freshIdeas, setFreshIdeas] = useState<VideoIdea[] | null>(null);

  const studio = data.videoStudio;
  const ideas = useMemo(() => {
    const stored = studio?.ideas ?? [];
    if (!freshIdeas) return stored;
    // The just-generated run replaces stored "suggested" entries until refresh lands.
    return [...freshIdeas, ...stored.filter((idea) => idea.status !== "suggested")];
  }, [studio, freshIdeas]);

  const suggested = ideas.filter((idea) => idea.status === "suggested");
  const saved = ideas.filter((idea) => idea.status === "saved" || idea.status === "scripted");
  const archived = ideas.filter((idea) => idea.status === "archived");

  const generate = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/studio/ideas/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed })
      });
      if (!response.ok) throw new Error("request failed");
      const json = (await response.json()) as GenerateResponse;
      setFreshIdeas(json.ideas);
      setReason(json.reason);
      toast.success(`${json.ideas.length} ideas researched.`);
      void refresh();
    } catch {
      toast.error("Could not run the research.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Studio"
        title="Idea Lab"
        description="Type a seed keyword (or leave it open) and get scored video ideas: working titles in the channel voice, the search phrases they target, intent, and how crowded each one is. Save the winners, then send them to Scripts."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Seed keyword (e.g. claude code)"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !generating) void generate();
                }}
                className="pl-9"
              />
            </div>
            <Button onClick={() => void generate()} disabled={generating} className="shrink-0">
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {generating ? "Researching…" : "Research ideas"}
            </Button>
          </div>
        }
      />

      {reason ? (
        <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">{reason}</div>
      ) : null}

      <Tabs
        tabs={[
          {
            id: "suggested",
            label: `Suggestions (${suggested.length})`,
            icon: Lightbulb,
            content: (
              <IdeaGrid
                ideas={suggested}
                empty={
                  generating || loading
                    ? "Researching ideas…"
                    : "No suggestions yet — run a research pass to fill the board."
                }
                onLocalChange={(next) => setFreshIdeas(next.filter((idea) => idea.status === "suggested"))}
                refresh={refresh}
              />
            )
          },
          {
            id: "saved",
            label: `Saved (${saved.length})`,
            icon: Bookmark,
            content: (
              <IdeaGrid
                ideas={saved}
                empty="Nothing saved yet — save the suggestions worth making."
                onLocalChange={() => undefined}
                refresh={refresh}
              />
            )
          },
          {
            id: "archived",
            label: `Archive (${archived.length})`,
            icon: Archive,
            content: (
              <IdeaGrid ideas={archived} empty="No archived ideas." onLocalChange={() => undefined} refresh={refresh} />
            )
          }
        ]}
      />
    </div>
  );
}

function IdeaGrid({
  ideas,
  empty,
  onLocalChange,
  refresh
}: {
  ideas: VideoIdea[];
  empty: string;
  onLocalChange: (ideas: VideoIdea[]) => void;
  refresh: () => Promise<void> | void;
}) {
  if (ideas.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Lightbulb className="h-8 w-8 text-[var(--accent)]" />
          <p className="text-sm text-[var(--muted-foreground)]">{empty}</p>
        </div>
      </Card>
    );
  }
  const sorted = [...ideas].sort((a, b) => b.score - a.score);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sorted.map((idea) => (
        <IdeaCard
          key={idea.id}
          idea={idea}
          onChanged={(next) => {
            onLocalChange(next ? sorted.map((entry) => (entry.id === next.id ? next : entry)) : sorted.filter((entry) => entry.id !== idea.id));
            void refresh();
          }}
        />
      ))}
    </div>
  );
}

function IdeaCard({ idea, onChanged }: { idea: VideoIdea; onChanged: (idea: VideoIdea | null) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const setStatus = async (status: VideoIdeaStatus) => {
    setBusy(status);
    try {
      const response = await fetch(`/api/studio/ideas/${idea.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const json = (await response.json()) as { idea?: VideoIdea; error?: string };
      if (!response.ok || !json.idea) {
        toast.error(json.error ?? "Could not update the idea.");
        return;
      }
      onChanged(json.idea);
    } catch {
      toast.error("Could not update the idea.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      const response = await fetch(`/api/studio/ideas/${idea.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      onChanged(null);
    } catch {
      toast.error("Could not delete the idea.");
    } finally {
      setBusy(null);
    }
  };

  const writeScript = async () => {
    setBusy("script");
    try {
      const response = await fetch("/api/studio/scripts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ideaId: idea.id })
      });
      const json = (await response.json()) as { script?: { id: string }; error?: string; reason?: string | null };
      if (!response.ok || !json.script) {
        toast.error(json.error ?? "Could not write the script.");
        return;
      }
      if (json.reason) toast.warning(json.reason);
      else toast.success("Script written — opening it now.");
      router.push(`/scripts?scriptId=${json.script.id}`);
    } catch {
      toast.error("Could not write the script.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-white">{idea.title}</h3>
          {idea.angle ? <p className="mt-1 text-sm text-[var(--muted-foreground)]">{idea.angle}</p> : null}
        </div>
        <span className={cn("shrink-0 text-2xl font-bold tabular-nums", scoreColor(idea.score))}>{idea.score}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", COMPETITION_STYLES[idea.competition])}>
          {idea.competition} competition
        </span>
        <Badge>{idea.searchIntent}</Badge>
        <Badge>{idea.format === "both" ? "long + short" : idea.format}</Badge>
        {idea.status === "scripted" ? <Badge className="text-[var(--accent)]">scripted</Badge> : null}
      </div>

      {idea.keywords.length ? (
        <div className="flex flex-wrap gap-1.5">
          {idea.keywords.map((keyword) => (
            <span key={keyword} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
              {keyword}
            </span>
          ))}
        </div>
      ) : null}

      {idea.rationale ? <p className="text-xs text-[var(--muted-foreground)]">{idea.rationale}</p> : null}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
        {idea.status === "suggested" ? (
          <Button variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => void setStatus("saved")}>
            {busy === "saved" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />} Save
          </Button>
        ) : null}
        {idea.status !== "archived" ? (
          <Button className="gap-1.5 px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => void writeScript()}>
            {busy === "script" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />} Write script
          </Button>
        ) : null}
        {idea.status !== "archived" ? (
          <Button variant="ghost" className="gap-1.5 px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => void setStatus("archived")}>
            <Archive className="h-3.5 w-3.5" /> Archive
          </Button>
        ) : (
          <>
            <Button variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => void setStatus("saved")}>
              <Bookmark className="h-3.5 w-3.5" /> Restore
            </Button>
            <Button variant="danger" className="gap-1.5 px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => void remove()}>
              {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
