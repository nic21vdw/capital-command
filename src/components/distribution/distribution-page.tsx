"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
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
  Scissors,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { POSTING_MODES, PostingTag, type PostingMode } from "@/components/ui/posting-tag";
import type { AutomationCard } from "@/lib/automations/types";
import { setupNeed, type SetupInputs } from "@/lib/distribution/setup";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { dateTimeFormat } from "@/lib/publisher/intl";
import { cn } from "@/lib/utils";

/**
 * Distribution Centre — the content pipeline, drawn as a top-down tree.
 *
 * Pick what you're starting with (long-form video, audio, carousel, text-only
 * post, or a raw idea) from the big source tabs. The selected source becomes
 * the ROOT of a flow that reads the way the work actually happens:
 *
 *   Livestream recording  →  Clean master  →  fans out into every format
 *
 * The root is the raw material. The "clean master" is the processing step
 * (cut the quiet parts, dead air and stumbles). From the master the media
 * outputs branch out (shorts, topical videos, podcast audio). For spoken
 * sources a Transcript node hangs off the master and the text formats
 * (newsletter/text, X, threads, carousel) branch from there — because that's
 * literally what they're generated from.
 *
 * Every node is still a live transform: ready nodes link into their tool,
 * locked ones name the step that unlocks them (usually "record video"). Only
 * the layout changed — flat "Ready now / Unlock next" grids became one tree.
 */

type Overview = {
  ideas: { suggested: number; saved: number; scripted: number };
  scripts: {
    draft: number;
    ready: number;
    produced: number;
    latest: Array<{
      id: string;
      title: string;
      status: string;
      updatedAt: string;
    }>;
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
  carousels: {
    total: number;
    latest: Array<{
      id: string;
      title: string;
      slides: number;
      createdAt: string;
    }>;
  };
  xPack: { posts: number; replies: number; date: string } | null;
  /** Threads posts on today's calendar: the same count the Day Summary shows. */
  threadsToday?: number;
  publish: {
    enabled: boolean;
    /** The publish time zone every slot is read in (PUBLISH_TIMEZONE). */
    timezone?: string;
    configuredPlatforms: string[];
    queued: number;
    scheduled: number;
    published: number;
    manual: number;
    failed: number;
    nextDue: { title: string; publishAt: string } | null;
  };
};

/**
 * "Sat, Oct 10, 1:30 AM America/Toronto": the same short stamp the board uses,
 * read in the PUBLISH time zone. The bare toLocaleString() printed the browser's
 * zone in a US numeric format ("10/11/2026, 1:30:00 AM"), which is a different
 * hour from the one the board shows whenever the two zones differ.
 */
function formatNextDue(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    const stamp = dateTimeFormat("en-US", timeZone ? { ...options, timeZone } : options).format(date);
    return timeZone ? `${stamp} (${timeZone})` : stamp;
  } catch {
    return dateTimeFormat("en-US", options).format(date);
  }
}

type SourceKey = "video" | "audio" | "carousel" | "text" | "idea";
type OutputKey =
  | "longform"
  | "shorts"
  | "audio"
  | "x"
  | "threads"
  | "text"
  | "carousel";

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
    startCta: "Open Long-Form Editor",
  },
  {
    key: "audio",
    label: "Audio",
    icon: Mic,
    tagline: "A spoken track or podcast episode.",
    startHref: "/longform",
    startCta: "Add it in the editor",
  },
  {
    key: "carousel",
    label: "Carousel photos",
    icon: Images,
    tagline: "A set of designed slides.",
    startHref: "/carousels",
    startCta: "Open Carousels",
  },
  {
    key: "text",
    label: "Text-only post",
    icon: PenLine,
    tagline: "A written post — no audio or video yet.",
    startHref: "/x-posts",
    startCta: "Add a Threads post",
  },
  {
    key: "idea",
    label: "Just an idea",
    icon: Lightbulb,
    tagline: "A concept or keyword to build from.",
    startHref: "/ideas",
    startCta: "Open Idea Lab",
  },
];

// Canonical metadata + destination tool for each output type.
//
// `posting` is the honest answer to "what happens when I schedule this": a
// one-word mode plus where it really goes. Keep it in step with the code that
// does the posting (publish queue, Threads autopilot), not with the tool's name.
const OUTPUTS: Record<
  OutputKey,
  {
    label: string;
    icon: LucideIcon;
    href: string;
    cta: string;
    posting: { mode: PostingMode; where: string };
  }
> = {
  longform: {
    label: "Long-form video",
    icon: Clapperboard,
    href: "/longform",
    cta: "Open editor",
    posting: {
      mode: "automatic",
      where: "YouTube, uploaded private so you can review it before it goes public.",
    },
  },
  shorts: {
    label: "Shorts / Reels",
    icon: Wand2,
    href: "/clips",
    cta: "Cut shorts",
    posting: {
      mode: "automatic",
      where:
        "YouTube, Instagram and Facebook. TikTok lands in your TikTok inbox: finish the post in the app.",
    },
  },
  audio: {
    label: "Audio",
    icon: AudioLines,
    href: "/longform",
    cta: "Export audio",
    posting: {
      mode: "automatic",
      where: "Spotify, through the podcast feed the app publishes (one-time feed claim in Spotify).",
    },
  },
  x: {
    label: "X posts",
    icon: AtSign,
    href: "/x-posts",
    cta: "Write posts",
    posting: { mode: "copy-only", where: "The app writes them; you copy and post on X." },
  },
  threads: {
    label: "Thread posts",
    icon: MessageSquare,
    href: "/facebook",
    cta: "Write thread",
    posting: {
      mode: "manual",
      where: "Facebook / Instagram Post Library: copy and paste, nothing is sent.",
    },
  },
  text: {
    label: "Text-only post",
    icon: FileText,
    href: "/x-posts",
    cta: "Add a Threads post",
    posting: {
      mode: "automatic",
      where: "Threads, sent through the day by the autopilot once it is armed.",
    },
  },
  carousel: {
    label: "Carousel",
    icon: Images,
    href: "/carousels",
    cta: "Generate",
    posting: {
      mode: "automatic",
      where:
        "Instagram and Facebook when booked as a one-off. TikTok, YouTube and repeating schedules are reminders.",
    },
  },
};

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
    longform: {
      status: "ready",
      note: "Cut topical, standalone YouTube videos from the best segments.",
    },
    shorts: {
      status: "ready",
      note: "Auto-cut vertical shorts & reels from the best moments.",
    },
    audio: {
      status: "ready",
      note: "Strip the audio into a full podcast mp3 for Spotify.",
    },
    x: {
      status: "ready",
      note: "Turn the transcript into keyword-aware X posts.",
    },
    threads: {
      status: "ready",
      note: "Spin the transcript into FB / IG thread posts.",
    },
    text: {
      status: "ready",
      note: "Pull a newsletter or standalone text post from the transcript.",
    },
    carousel: {
      status: "ready",
      note: "Generate a carousel (posts to Instagram and Facebook) from the video's ideas.",
    },
  },
  audio: {
    x: {
      status: "ready",
      note: "Transcribe, then write X posts from what you said.",
    },
    threads: { status: "ready", note: "Transcribe into FB / IG thread posts." },
    text: {
      status: "ready",
      note: "Write text-only posts from the episode's ideas.",
    },
    carousel: {
      status: "ready",
      note: "Generate carousel slides from the topics discussed.",
    },
    longform: {
      status: "locked",
      note: "Record video to turn this into a full long-form video.",
    },
    shorts: {
      status: "locked",
      note: "No footage yet — record video to cut shorts & reels.",
    },
  },
  carousel: {
    x: { status: "ready", note: "Reframe the carousel's copy as X posts." },
    threads: {
      status: "ready",
      note: "Expand the slides into a FB / IG thread.",
    },
    text: {
      status: "ready",
      note: "Lift the key slide into a standalone text post.",
    },
    longform: {
      status: "locked",
      note: "Record video to build a long-form video around these ideas.",
    },
    shorts: {
      status: "locked",
      note: "Record video to cut shorts from this topic.",
    },
    audio: { status: "locked", note: "Record audio to add a spoken version." },
  },
  text: {
    x: { status: "ready", note: "Reformat it into an X post or thread." },
    threads: { status: "ready", note: "Reformat it into a FB / IG thread." },
    carousel: {
      status: "ready",
      note: "Generate a carousel from this post's idea.",
    },
    longform: {
      status: "locked",
      note: "Write a script, then record — that unlocks video + audio.",
      href: "/scripts",
      cta: "Write a script",
    },
    shorts: {
      status: "locked",
      note: "Script & record to cut shorts from this idea.",
    },
    audio: { status: "locked", note: "Record audio to add a spoken version." },
  },
  idea: {
    x: { status: "ready", note: "Draft X posts straight from the idea." },
    threads: { status: "ready", note: "Draft a FB / IG thread from the idea." },
    text: { status: "ready", note: "Draft a text-only post from the idea." },
    carousel: {
      status: "ready",
      note: "Generate carousel slides from the idea.",
    },
    longform: {
      status: "locked",
      note: "Write a script, then record — full long-form video + audio.",
      href: "/scripts",
      cta: "Write a script",
    },
    shorts: {
      status: "locked",
      note: "Script & record, then auto-cut shorts.",
      href: "/scripts",
      cta: "Write a script",
    },
    audio: { status: "locked", note: "Record audio to add a spoken version." },
  },
};

// The pipeline spine per source: the raw asset (root) and the "clean master"
// processing step it becomes before anything fans out. For spoken sources the
// master is a literal clean-up pass; for the others it's the prepared asset.
const PIPELINE: Record<
  SourceKey,
  {
    root: { label: string; tagline: string; icon: LucideIcon };
    master: { label: string; note: string };
  }
> = {
  video: {
    root: {
      label: "Livestream recording",
      tagline: "Your richest source — one long raw recording.",
      icon: Clapperboard,
    },
    master: {
      label: "Clean master",
      note: "Cut the quiet parts, dead air and stumbles into one tight master.",
    },
  },
  audio: {
    root: {
      label: "Podcast recording",
      tagline: "A spoken track or podcast episode.",
      icon: Mic,
    },
    master: {
      label: "Clean master",
      note: "Trim the silence and stumbles into a clean audio master.",
    },
  },
  carousel: {
    root: {
      label: "Carousel photos",
      tagline: "A set of designed slides.",
      icon: Images,
    },
    master: {
      label: "Finished deck",
      note: "Your designed slides, ready to repurpose everywhere else.",
    },
  },
  text: {
    root: {
      label: "Text-only post",
      tagline: "A written post — no audio or video yet.",
      icon: PenLine,
    },
    master: {
      label: "Polished draft",
      note: "Your post, tightened and ready to spin into other formats.",
    },
  },
  idea: {
    root: {
      label: "Just an idea",
      tagline: "A concept or keyword to build from.",
      icon: Lightbulb,
    },
    master: {
      label: "Working concept",
      note: "Your idea, shaped into a hook you can build on.",
    },
  },
};

// The intermediate node spoken sources route their text formats through.
const TRANSCRIPT = {
  label: "Transcript",
  note: "Auto-transcribed and ready to repurpose as text.",
};

// Which outputs hang straight off the master (media) vs. off the transcript
// (text/social). Sources with spoken audio route text through the transcript;
// the rest fan every output directly off the master.
const MEDIA_CHILDREN: OutputKey[] = ["longform", "shorts", "audio"];
const TEXT_CHILDREN: OutputKey[] = ["text", "x", "threads", "carousel"];
const SPOKEN_SOURCES: SourceKey[] = ["video", "audio"];
// Four 224px columns (900px) is what the page can hold on a rail at laptop widths;
// a fifth made the tree 1.5x wider than the page and cropped its right-hand side.
const MAX_ON_ONE_RAIL = 4;

// Live counts surfaced on the matching ready card, so the transform board also
// shows what's already been produced.
function statFor(key: OutputKey, overview: Overview): string | undefined {
  switch (key) {
    case "shorts":
      return overview.clips.clipsReady > 0
        ? `${overview.clips.clipsReady} clips ready`
        : undefined;
    case "longform":
      return overview.longform.total > 0
        ? `${overview.longform.total} in editor`
        : undefined;
    case "carousel":
      return overview.carousels.total > 0
        ? `${overview.carousels.total} made`
        : undefined;
    case "x": {
      // The Day Summary's count of Threads posts today (autopilot slots and hand-added
      // posts alike), not the X pack's own tally, so the two screens agree.
      const today = overview.threadsToday ?? overview.xPack?.posts ?? 0;
      return today > 0 ? `${today} Threads post${today === 1 ? "" : "s"} today` : undefined;
    }
    default:
      return undefined;
  }
}

export function DistributionPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceKey>("video");
  // The Automations cards say whether the podcast and Threads runners are blocked.
  // Unknown (still loading, or the call failed) must never read as blocked.
  const [cards, setCards] = useState<AutomationCard[] | null>(null);

  useEffect(() => {
    void fetch("/api/automations", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((json: { cards?: AutomationCard[] } | null) => setCards(json?.cards ?? null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void fetch("/api/studio/overview", { cache: "no-store" })
      .then((response) => response.json())
      .then((json: Overview) => setOverview(json))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const activeSource =
    SOURCES.find((item) => item.key === source) ?? SOURCES[0];

  // Registered before the loading early-return below, so the hook runs on
  // every render regardless of whether the overview has loaded yet.
  useColateralSurface({
    route: "/distribution",
    title: "Distribution Centre",
    summary: "Pick a source, then follow the pipeline into every format it can become.",
    fields: [
      {
        id: "source",
        label: "Starting source",
        value: source,
        kind: "select",
        options: SOURCES.map((item) => item.key),
      },
    ],
    controls: [
      {
        id: "openStartTool",
        label: "Open editor for this source",
        group: "Start",
      },
    ],
    readings: overview
      ? [
          { label: "Ideas suggested", value: String(overview.ideas.suggested) },
          { label: "Scripts ready", value: String(overview.scripts.ready) },
          { label: "Clips ready", value: String(overview.clips.clipsReady) },
          { label: "Carousels made", value: String(overview.carousels.total) },
          {
            label: "Publish queue",
            value: `${overview.publish.queued} queued, ${overview.publish.failed} failed`,
          },
        ]
      : [],
    setField: (id, value) => {
      if (id !== "source") return false;
      if (typeof value !== "string" || !SOURCES.some((item) => item.key === value)) return false;
      setSource(value as SourceKey);
      return true;
    },
    click: (id) => {
      if (id !== "openStartTool") return false;
      window.location.href = activeSource.startHref;
      return true;
    },
  });

  if (loading || !overview) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  const setupInputs: SetupInputs = {
    configuredPlatforms: overview.publish.configuredPlatforms,
    publishEnabled: overview.publish.enabled,
    cards,
  };
  const pipeline = PIPELINE[source];
  const caps = MATRIX[source];
  const spoken = SPOKEN_SOURCES.includes(source);

  // Nodes that hang straight off the "clean master".
  const mediaNodes = MEDIA_CHILDREN.filter((key) => caps[key]);
  // Text/social formats. For spoken sources they route through the Transcript
  // node; otherwise they fan directly off the master alongside the media nodes.
  const textNodes = TEXT_CHILDREN.filter((key) => caps[key]);
  const showTranscript = spoken && textNodes.length > 0;
  // Spoken sources: the media formats plus the Transcript hang off the master, and the
  // text formats hang off the Transcript. Others fan everything straight off the master.
  const firstTier = spoken ? mediaNodes : [...mediaNodes, ...textNodes];
  const fitsOneRail = firstTier.length + (showTranscript ? 1 : 0) <= MAX_ON_ONE_RAIL;
  const RootIcon = pipeline.root.icon;

  return (
    <div>
      <PageHeader
        eyebrow="Step 3 · Schedule"
        title="Distribution Centre"
        description="Pick what you're starting with, then follow the pipeline down: your raw material becomes a clean master, and from there it fans out into every format you can post. Videos do everything; text and ideas set you up to record and unlock the rest."
      />

      {overview.publish.failed > 0 ? (
        <Link
          href="/uploading-center"
          className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1 max-sm:min-h-10 text-xs font-medium text-red-300 transition hover:bg-red-500/20"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {overview.publish.failed} failed - see why in the Uploading Center
        </Link>
      ) : null}
      {/* The key to the one-word tags on every format below. */}
      <Card className="mb-6 flex flex-wrap items-start gap-x-6 gap-y-2 py-3">
        <p className="w-full text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          What &ldquo;schedule&rdquo; means
        </p>
        {(Object.keys(POSTING_MODES) as PostingMode[]).map((mode) => (
          <div key={mode} className="flex min-w-[220px] flex-1 items-start gap-2">
            <PostingTag mode={mode} className="mt-0.5 shrink-0" />
            <p className="text-xs text-[var(--muted-foreground)]">
              {POSTING_MODES[mode].meaning}
            </p>
          </div>
        ))}
      </Card>

      {/* Big source tabs — the "what do you have?" selector / root of the tree. */}
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
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg transition",
                  active
                    ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                    : "bg-white/6 text-[var(--accent)]",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-white">
                {item.label}
              </span>
              <span className="text-xs text-[var(--muted-foreground)]">
                {item.tagline}
              </span>
            </button>
          );
        })}
      </div>

      {/* The pipeline, drawn as a top-down tree: root → clean master → fan-out.
          It never scrolls sideways (that cropped the Transcript branch with no cue):
          up to four nodes sit on one rail, more go into a wrapping panel, and the
          Transcript's text formats get their own panel underneath it. */}
      <div className="mt-8 pb-4">
        <div className="mx-auto flex w-full flex-col items-center">
          {/* Root — the raw material, with the jump into where you load it. */}
          <StageCard
            tone="root"
            icon={RootIcon}
            label={pipeline.root.label}
            note={pipeline.root.tagline}
          >
            <Link href={activeSource.startHref} className="mt-3 block">
              <Button className="w-full px-3 py-1.5 text-xs">
                {activeSource.startCta} <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          </StageCard>

          <PipeDrop />

          {/* Clean master — the processing step. */}
          <StageCard
            tone="process"
            icon={Scissors}
            label={pipeline.master.label}
            note={pipeline.master.note}
          />

          <PipeDrop />

          {/* Fan-out — media nodes off the master, with the Transcript beside them. */}
          {fitsOneRail ? (
            <div className="pipe-branch">
              {firstTier.map((key) => (
                <div key={key} className="pipe-col">
                  <OutputCard
                    outputKey={key}
                    cap={caps[key]!}
                    stat={statFor(key, overview)}
                    inputs={setupInputs}
                  />
                </div>
              ))}
              {showTranscript ? (
                <div className="pipe-col self-stretch">
                  <StageCard
                    tone="process"
                    icon={FileText}
                    label={TRANSCRIPT.label}
                    note={TRANSCRIPT.note}
                  />
                  {/* Runs on down to the panel of text formats below. */}
                  <PipeDrop grow />
                </div>
              ) : null}
            </div>
          ) : (
            <FanPanel label={`What ${pipeline.root.label.toLowerCase()} can become`}>
              {firstTier.map((key) => (
                <OutputCard
                  key={key}
                  outputKey={key}
                  cap={caps[key]!}
                  stat={statFor(key, overview)}
                  inputs={setupInputs}
                />
              ))}
            </FanPanel>
          )}

          {showTranscript ? (
            <FanPanel label="Written from the transcript">
              {textNodes.map((key) => (
                <OutputCard
                  key={key}
                  outputKey={key}
                  cap={caps[key]!}
                  stat={statFor(key, overview)}
                  inputs={setupInputs}
                />
              ))}
            </FanPanel>
          ) : null}
        </div>
      </div>

      {overview.publish.nextDue ? (
        <Card className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-5 w-5 text-[var(--accent)]" />
            <div>
              <p className="text-sm font-medium text-white">
                Next scheduled: {overview.publish.nextDue.title}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {formatNextDue(overview.publish.nextDue.publishAt, overview.publish.timezone)}
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

// A single node in the fan-out: root/master/transcript are STAGE nodes, drawn
// in a fixed-width column so the connector rails line up cleanly.
function StageCard({
  tone,
  icon: Icon,
  label,
  note,
  children,
}: {
  tone: "root" | "process";
  icon: LucideIcon;
  label: string;
  note: string;
  children?: ReactNode;
}) {
  const isRoot = tone === "root";
  return (
    <div
      className={cn(
        "w-[200px] rounded-xl border p-4 text-left",
        isRoot
          ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border-strong)] bg-[var(--surface-2)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            isRoot
              ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
              : "bg-white/6 text-[var(--accent)]",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm font-semibold text-white">{label}</p>
      </div>
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">{note}</p>
      {children}
    </div>
  );
}

// The vertical connector between stacked stages in the tree.
function PipeDrop({ grow = false }: { grow?: boolean }) {
  return (
    <div className={cn("flex h-7 justify-center", grow && "min-h-7 flex-1")} aria-hidden>
      <span className="w-[2px] bg-[var(--border-strong)]" />
    </div>
  );
}

// A bordered group of format cards that wraps to the width it is given.
function FanPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="w-full max-w-[940px] rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)]/40 p-4"
    >
      <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </p>
      <div className="flex flex-wrap items-stretch justify-center gap-3">{children}</div>
    </section>
  );
}

function OutputCard({
  outputKey,
  cap,
  stat,
  inputs,
}: {
  outputKey: OutputKey;
  cap: Capability;
  stat?: string;
  inputs: SetupInputs;
}) {
  const meta = OUTPUTS[outputKey];
  // "Automatic" is what happens once everything is connected; say so when it is not.
  const need = meta.posting.mode === "automatic" ? setupNeed(outputKey, inputs) : null;
  const Icon = meta.icon;
  const isReady = cap.status === "ready";
  const href = cap.href ?? (isReady ? meta.href : undefined);
  const cta = cap.cta ?? meta.cta;

  return (
    <Card
      className={cn(
        "flex h-full w-[200px] flex-col gap-2",
        isReady
          ? "transition hover:border-[var(--border-strong)]"
          : "border-dashed bg-[var(--surface)]/60",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4",
            isReady ? "text-[var(--accent)]" : "text-[var(--muted-foreground)]",
          )}
        />
        <p
          className={cn(
            "text-sm font-semibold",
            isReady ? "text-white" : "text-[var(--muted-foreground-2)]",
          )}
        >
          {meta.label}
        </p>
        {isReady ? (
          <Badge tone="success" className="ml-auto text-[10px]">
            Ready
          </Badge>
        ) : (
          <Badge className="ml-auto text-[10px]">
            <Lock className="mr-1 h-2.5 w-2.5" /> Locked
          </Badge>
        )}
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">{cap.note}</p>
      {isReady ? (
        <div className="flex flex-col items-start gap-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <PostingTag mode={meta.posting.mode} />
            {need ? (
              <Link
                href={need.href}
                title={`${need.reason} - fix it in ${need.hrefLabel}`}
                className="text-[11px] font-medium text-amber-300 underline decoration-dotted underline-offset-2 hover:text-amber-200 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
              >
                (needs setup)
              </Link>
            ) : null}
          </div>
          {need ? (
            <p className="text-[11px] text-amber-300/90">
              {need.reason.charAt(0).toUpperCase() + need.reason.slice(1)}
              {/[.\u2026]$/.test(need.reason) ? "" : "."}{" "}
              <Link href={need.href} className="underline underline-offset-2 hover:text-amber-200">
                Open {need.hrefLabel}
              </Link>
            </p>
          ) : null}
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {meta.posting.where}
          </p>
        </div>
      ) : null}
      {stat ? (
        <p className="text-xs font-medium text-[var(--accent)]">{stat}</p>
      ) : null}
      {href ? (
        <Link href={href} className="mt-auto pt-1">
          <Button
            variant={isReady ? "secondary" : "ghost"}
            className="w-full px-3 py-1.5 text-xs"
          >
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
