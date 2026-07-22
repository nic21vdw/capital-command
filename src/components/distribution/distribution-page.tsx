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
  Lock,
  MessageSquare,
  Mic,
  PenLine,
  Wand2,
  type LucideIcon
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

/**
 * Distribution Centre — the content transformer. Pick what you're starting
 * with (long-form video, audio, carousel, text-only post, or a raw idea) from
 * the big source tabs, and every output it can become fans out below:
 *
 *   video  → everything (shorts, audio, X, threads, text, carousel)
 *   audio  → text formats + carousel now · video/shorts unlock by recording
 *   text/idea → text + carousel now · record video to unlock the rest
 *
 * The point: whatever you feed in, one board manages all the outputs — and the
 * "Unlock next" row is exactly the "record video to do video + audio" nudge.
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

type SourceKey = "video" | "audio" | "carousel" | "text" | "idea";
type OutputKey = "longform" | "shorts" | "audio" | "x" | "threads" | "text" | "carousel";

// The five things you can start from — the big tabs.
const SOURCES: Array<{
  key: SourceKey;
  label: string;
  icon: LucideIcon;
  tagline: string;
  startHref: string;
  startCta: string;
}> = [
  {
    key: "video",
    label: "Long-form video",
    icon: Clapperboard,
    tagline: "A recorded video — your richest starting point.",
    startHref: "/longform",
    startCta: "Open Long-Form Editor"
  },
  {
    key: "audio",
    label: "Audio",
    icon: Mic,
    tagline: "A spoken track or podcast episode.",
    startHref: "/podcasts",
    startCta: "Open Podcast Studio"
  },
  {
    key: "carousel",
    label: "Carousel photos",
    icon: Images,
    tagline: "A set of designed slides.",
    startHref: "/carousels",
    startCta: "Open Carousels"
  },
  {
    key: "text",
    label: "Text-only post",
    icon: PenLine,
    tagline: "A written post — no audio or video yet.",
    startHref: "/x-posts",
    startCta: "Open X / Threads"
  },
  {
    key: "idea",
    label: "Just an idea",
    icon: Lightbulb,
    tagline: "A concept or keyword to build from.",
    startHref: "/ideas",
    startCta: "Open Idea Lab"
  }
];

// Canonical metadata + destination tool for each output type.
const OUTPUTS: Record<OutputKey, { label: string; icon: LucideIcon; href: string; cta: string }> = {
  longform: { label: "Long-form video", icon: Clapperboard, href: "/longform", cta: "Open editor" },
  shorts: { label: "Shorts / Reels", icon: Wand2, href: "/clips", cta: "Cut shorts" },
  audio: { label: "Podcast audio", icon: AudioLines, href: "/podcasts", cta: "Build episodes" },
  x: { label: "X posts", icon: AtSign, href: "/x-posts", cta: "Write posts" },
  threads: { label: "Thread posts", icon: MessageSquare, href: "/facebook", cta: "Write thread" },
  text: { label: "Text-only post", icon: FileText, href: "/x-posts", cta: "Write post" },
  carousel: { label: "Instagram carousel", icon: Images, href: "/carousels", cta: "Generate" }
};

// Fixed display order so the grids read the same on every tab.
const OUTPUT_ORDER: OutputKey[] = ["shorts", "longform", "audio", "x", "threads", "text", "carousel"];

type Capability = {
  status: "ready" | "locked";
  note: string;
  // Optional next-step link — used by ready cards to override the default tool,
  // and by locked cards that have a concrete first step (e.g. write a script).
  href?: string;
  cta?: string;
};

// The transform matrix: for each source, what each output becomes. Outputs a
// source IS (e.g. video → long-form video) are simply omitted. Every "locked"
// entry names the step that unlocks it — recording is done off-app, so those
// have no link; scripting does, so idea → long-form points at the Script tool.
const MATRIX: Record<SourceKey, Partial<Record<OutputKey, Capability>>> = {
  video: {
    shorts: { status: "ready", note: "Auto-cut vertical shorts & reels from the best moments." },
    audio: { status: "ready", note: "Generate a full MP3, topic episodes and an RSS release for podcast platforms." },
    x: { status: "ready", note: "Turn the transcript into keyword-aware X posts." },
    threads: { status: "ready", note: "Spin the transcript into FB / IG thread posts." },
    text: { status: "ready", note: "Pull standalone text-only posts from the ideas covered." },
    carousel: { status: "ready", note: "Generate an Instagram carousel from the video's ideas." }
  },
  audio: {
    x: { status: "ready", note: "Transcribe, then write X posts from what you said." },
    threads: { status: "ready", note: "Transcribe into FB / IG thread posts." },
    text: { status: "ready", note: "Write text-only posts from the episode's ideas." },
    carousel: { status: "ready", note: "Generate carousel slides from the topics discussed." },
    longform: { status: "locked", note: "Record video to turn this into a full long-form video." },
    shorts: { status: "locked", note: "No footage yet — record video to cut shorts & reels." }
  },
  carousel: {
    x: { status: "ready", note: "Reframe the carousel's copy as X posts." },
    threads: { status: "ready", note: "Expand the slides into a FB / IG thread." },
    text: { status: "ready", note: "Lift the key slide into a standalone text post." },
    longform: { status: "locked", note: "Record video to build a long-form video around these ideas." },
    shorts: { status: "locked", note: "Record video to cut shorts from this topic." },
    audio: { status: "locked", note: "Record audio to add a spoken version." }
  },
  text: {
    x: { status: "ready", note: "Reformat it into an X post or thread." },
    threads: { status: "ready", note: "Reformat it into a FB / IG thread." },
    carousel: { status: "ready", note: "Generate a carousel from this post's idea." },
    longform: {
      status: "locked",
      note: "Write a script, then record — that unlocks video + audio.",
      href: "/scripts",
      cta: "Write a script"
    },
    shorts: { status: "locked", note: "Script & record to cut shorts from this idea." },
    audio: { status: "locked", note: "Record audio to add a spoken version." }
  },
  idea: {
    x: { status: "ready", note: "Draft X posts straight from the idea." },
    threads: { status: "ready", note: "Draft a FB / IG thread from the idea." },
    text: { status: "ready", note: "Draft a text-only post from the idea." },
    carousel: { status: "ready", note: "Generate carousel slides from the idea." },
    longform: {
      status: "locked",
      note: "Write a script, then record — full long-form video + audio.",
      href: "/scripts",
      cta: "Write a script"
    },
    shorts: {
      status: "locked",
      note: "Script & record, then auto-cut shorts.",
      href: "/scripts",
      cta: "Write a script"
    },
    audio: { status: "locked", note: "Record audio to add a spoken version." }
  }
};

// Live counts surfaced on the matching ready card, so the transform board also
// shows what's already been produced.
function statFor(key: OutputKey, overview: Overview): string | undefined {
  switch (key) {
    case "shorts":
      return overview.clips.clipsReady > 0 ? `${overview.clips.clipsReady} clips ready` : undefined;
    case "longform":
      return overview.longform.total > 0 ? `${overview.longform.total} in editor` : undefined;
    case "carousel":
      return overview.carousels.total > 0 ? `${overview.carousels.total} made` : undefined;
    case "x":
      return overview.xPack ? `${overview.xPack.posts} posts queued today` : undefined;
    default:
      return undefined;
  }
}

export function DistributionPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceKey>("video");

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

  const activeSource = SOURCES.find((item) => item.key === source) ?? SOURCES[0];
  const caps = MATRIX[source];
  const ordered = OUTPUT_ORDER.filter((key) => caps[key]);
  const ready = ordered.filter((key) => caps[key]?.status === "ready");
  const locked = ordered.filter((key) => caps[key]?.status === "locked");

  return (
    <div>
      <PageHeader
        eyebrow="Distribution Centre"
        title="Turn any input into every output"
        description="Pick what you're starting with — a long-form video, audio, a carousel, a text-only post, or just an idea — and every format it can become fans out below. Videos do everything; text and ideas set you up to record and unlock the rest."
      />

      {/* Big source tabs — the "what do you have?" selector. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SOURCES.map((item) => {
          const Icon = item.icon;
          const active = item.key === source;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSource(item.key)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition",
                active
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_0_1px_var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg transition",
                  active ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "bg-white/6 text-[var(--accent)]"
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-white">{item.label}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{item.tagline}</span>
            </button>
          );
        })}
      </div>

      {/* Intro line + a jump into where you actually load this source. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
        <p className="text-sm text-[var(--muted-foreground)]">
          Starting from <span className="font-medium text-white">{activeSource.label.toLowerCase()}</span> — here&apos;s
          everything you can turn it into.
        </p>
        <Link href={activeSource.startHref}>
          <Button variant="secondary" className="px-3 py-1.5 text-xs">
            {activeSource.startCta} <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>

      {/* Ready now — direct transforms. */}
      <div className="mt-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          Ready now
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
            {ready.length}
          </span>
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ready.map((key) => (
            <OutputCard key={key} outputKey={key} cap={caps[key]!} stat={statFor(key, overview)} />
          ))}
        </div>
      </div>

      {/* Unlock next — the "record video to do video + audio" nudge. */}
      {locked.length > 0 ? (
        <div className="mt-8">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Lock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
            Unlock next
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {locked.map((key) => (
              <OutputCard key={key} outputKey={key} cap={caps[key]!} />
            ))}
          </div>
        </div>
      ) : null}

      {overview.publish.nextDue ? (
        <Card className="mt-8 flex flex-wrap items-center justify-between gap-3">
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
    </div>
  );
}

function OutputCard({ outputKey, cap, stat }: { outputKey: OutputKey; cap: Capability; stat?: string }) {
  const meta = OUTPUTS[outputKey];
  const Icon = meta.icon;
  const isReady = cap.status === "ready";
  const href = cap.href ?? (isReady ? meta.href : undefined);
  const cta = cap.cta ?? meta.cta;

  return (
    <Card
      className={cn(
        "flex h-full flex-col gap-2",
        isReady ? "transition hover:border-[var(--border-strong)]" : "border-dashed bg-[var(--surface)]/60"
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", isReady ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]")} />
        <p className={cn("text-sm font-semibold", isReady ? "text-white" : "text-white/70")}>{meta.label}</p>
        {isReady ? (
          <Badge className="ml-auto border-emerald-400/20 bg-emerald-400/10 text-[10px] text-emerald-300">Ready</Badge>
        ) : (
          <Badge className="ml-auto text-[10px]">
            <Lock className="mr-1 h-2.5 w-2.5" /> Locked
          </Badge>
        )}
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{cap.note}</p>
      {stat ? <p className="text-xs font-medium text-[var(--accent)]">{stat}</p> : null}
      {href ? (
        <Link href={href} className="mt-auto pt-1">
          <Button variant={isReady ? "secondary" : "ghost"} className="w-full px-3 py-1.5 text-xs">
            {cta} <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      ) : (
        <p className="mt-auto pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]/70">
          Record to unlock
        </p>
      )}
    </Card>
  );
}
