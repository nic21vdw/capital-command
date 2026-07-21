"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  AtSign,
  AudioLines,
  CalendarClock,
  Clapperboard,
  FileText,
  Images,
  Lightbulb,
  Loader2,
  UploadCloud,
  Wand2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

/**
 * Distribution Centre: the start-to-finish pipeline board. One glance shows
 * where every video stands — idea → script → edit → outputs (video, audio,
 * carousel, X pack) → schedule — with a jump into the right tool for the next
 * step of each.
 */

type Overview = {
  ideas: { suggested: number; saved: number; scripted: number };
  scripts: {
    draft: number;
    ready: number;
    produced: number;
    latest: Array<{ id: string; title: string; status: string; updatedAt: string }>;
  };
  longform: {
    total: number;
    processing: number;
    latest: Array<{
      id: string;
      name: string;
      status: string;
      hasExport: boolean;
      hasAudio: boolean;
      hasPublishKit: boolean;
      updatedAt: string;
    }>;
  };
  clips: { jobs: number; processing: number; clipsReady: number };
  carousels: { total: number; latest: Array<{ id: string; title: string; slides: number; createdAt: string }> };
  xPack: { posts: number; replies: number; date: string } | null;
  publish: {
    enabled: boolean;
    configuredPlatforms: string[];
    queued: number;
    scheduled: number;
    published: number;
    manual: number;
    failed: number;
    nextDue: { title: string; publishAt: string } | null;
  };
};

export function DistributionPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch("/api/studio/overview", { cache: "no-store" })
      .then((response) => response.json())
      .then((json: Overview) => setOverview(json))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !overview) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  const stages: Array<{
    href: string;
    icon: typeof Lightbulb;
    title: string;
    stat: string;
    detail: string;
    cta: string;
  }> = [
    {
      href: "/ideas",
      icon: Lightbulb,
      title: "1 · Ideas",
      stat: `${overview.ideas.saved} saved`,
      detail: `${overview.ideas.suggested} fresh suggestions · ${overview.ideas.scripted} already scripted`,
      cta: "Research ideas"
    },
    {
      href: "/scripts",
      icon: FileText,
      title: "2 · Scripts",
      stat: `${overview.scripts.ready} ready`,
      detail: `${overview.scripts.draft} drafts in progress · ${overview.scripts.produced} produced`,
      cta: "Write scripts"
    },
    {
      href: "/longform",
      icon: Clapperboard,
      title: "3 · Edit",
      stat: `${overview.longform.total} projects`,
      detail:
        overview.longform.processing > 0
          ? `${overview.longform.processing} still analyzing`
          : "Hook, cuts, captions, music, SFX",
      cta: "Open editor"
    },
    {
      href: "/clips",
      icon: Wand2,
      title: "4 · Shorts",
      stat: `${overview.clips.clipsReady} clips ready`,
      detail: `${overview.clips.jobs} generator runs${overview.clips.processing ? ` · ${overview.clips.processing} running` : ""}`,
      cta: "Cut shorts"
    },
    {
      href: "/uploading-center",
      icon: UploadCloud,
      title: "5 · Schedule",
      stat: overview.publish.enabled ? `${overview.publish.queued} queued` : "Publishing off",
      detail: overview.publish.enabled
        ? `${overview.publish.scheduled} scheduled · ${overview.publish.published} published${overview.publish.failed ? ` · ${overview.publish.failed} failed` : ""}`
        : "Enable PUBLISH_ENABLED to schedule uploads",
      cta: "Open uploading center"
    }
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Distribution Centre"
        title="Start to Finish"
        description="The whole pipeline on one board: ideas become scripts, scripts become edits, edits become uploads, shorts, carousels, audio and posts — everything ready for scheduled publishing."
      />

      {/* Pipeline stages */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {stages.map((stage) => {
          const Icon = stage.icon;
          return (
            <Link key={stage.href} href={stage.href} className="group">
              <Card className="flex h-full flex-col gap-2 transition group-hover:border-[var(--border-strong)]">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--accent)]" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{stage.title}</p>
                </div>
                <p className="text-xl font-bold text-white">{stage.stat}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{stage.detail}</p>
                <p className="mt-auto flex items-center gap-1 pt-2 text-xs font-medium text-[var(--accent)]">
                  {stage.cta} <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                </p>
              </Card>
            </Link>
          );
        })}
      </div>

      {overview.publish.nextDue ? (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-5 w-5 text-[var(--accent)]" />
            <div>
              <p className="text-sm font-medium text-white">Next scheduled: {overview.publish.nextDue.title}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {new Date(overview.publish.nextDue.publishAt).toLocaleString()}
              </p>
            </div>
          </div>
          <Link href="/uploading-center">
            <Button variant="secondary" className="px-3 py-1.5 text-xs">
              View queue
            </Button>
          </Link>
        </Card>
      ) : null}

      {/* Per-video output readiness + side channels */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold text-white">Latest videos — outputs</h3>
          {overview.longform.latest.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No long-form projects yet — start one in the editor.</p>
          ) : (
            overview.longform.latest.map((project) => (
              <div key={project.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{project.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <OutputBadge ok={project.hasExport} label="Video" />
                    <OutputBadge ok={project.hasAudio} label="Audio" />
                    <OutputBadge ok={project.hasPublishKit} label="Titles + description" />
                  </div>
                </div>
                <Link href={`/longform?open=${project.id}`} className="shrink-0 text-xs font-medium text-[var(--accent)]">
                  Open →
                </Link>
              </div>
            ))
          )}
        </Card>

        <div className="space-y-6">
          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <Images className="h-4 w-4 text-[var(--accent)]" />
                <h3 className="text-sm font-semibold">Instagram carousels</h3>
              </div>
              <Link href="/carousels" className="text-xs font-medium text-[var(--accent)]">
                Open →
              </Link>
            </div>
            {overview.carousels.total === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">None yet — generate one from a script or video.</p>
            ) : (
              overview.carousels.latest.map((carousel) => (
                <p key={carousel.id} className="text-sm text-[var(--muted-foreground)]">
                  <span className="text-white/90">{carousel.title}</span> · {carousel.slides} slides
                </p>
              ))
            )}
          </Card>

          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <AtSign className="h-4 w-4 text-[var(--accent)]" />
                <h3 className="text-sm font-semibold">X / Threads</h3>
              </div>
              <Link href="/x-posts" className="text-xs font-medium text-[var(--accent)]">
                Open →
              </Link>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              {overview.xPack
                ? `Today's pack is ready: ${overview.xPack.posts} posts + ${overview.xPack.replies} replies.`
                : "No pack yet today — hit Generate for 24 fresh posts."}
            </p>
          </Card>

          <Card className="space-y-2">
            <div className="flex items-center gap-2 text-white">
              <AudioLines className="h-4 w-4 text-[var(--accent)]" />
              <h3 className="text-sm font-semibold">Audio / podcast</h3>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              Every finished long-form export can become an mp3 (Export tab → “Create audio version”) — the same edit,
              ready for Spotify when you are.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function OutputBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge className={cn("text-[10px]", ok ? "text-emerald-300" : "opacity-50")}>
      {ok ? "✓" : "·"} {label}
    </Badge>
  );
}
