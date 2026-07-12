"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  BookOpen,
  Check,
  Clock,
  Copy,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { localDateKey } from "@/lib/x-strategy/analytics";
import { cn } from "@/lib/utils";
import type { XDailyPack, XPostFormat, XSuggestedPost, XSuggestedReply } from "@/types/domain";

interface GenerateResponse {
  pack: XDailyPack;
  cached: boolean;
  reason: string | null;
  configured: boolean;
}

const FORMAT_STYLES: Record<XPostFormat, string> = {
  insight: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  contrarian: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  story: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  question: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  framework: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  observation: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
};

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const meridiem = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${meridiem}`;
}

function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      toast.error("Clipboard unavailable — select and copy the text manually.");
    }
  }, []);
  return { copiedId, copy };
}

export function XPostsPage() {
  const { data, loading, refresh } = useAppData();
  const today = localDateKey();

  const storedPack = useMemo(
    () => data.xPlanner?.packs.find((pack) => pack.date === today) ?? null,
    [data.xPlanner, today]
  );

  const [pack, setPack] = useState<XDailyPack | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [focus, setFocus] = useState("");
  const autoRequested = useRef(false);

  const activePack = pack ?? storedPack;

  const generate = useCallback(
    async (force: boolean) => {
      setGenerating(true);
      try {
        const response = await fetch("/api/x-posts/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ focus, force })
        });
        if (!response.ok) throw new Error("request failed");
        const json = (await response.json()) as GenerateResponse;
        setPack(json.pack);
        setReason(json.reason);
        if (!json.cached) {
          toast.success(force ? "Fresh pack generated." : "Today's pack is ready.");
          void refresh();
        }
      } catch {
        toast.error("Could not generate today's pack.");
      } finally {
        setGenerating(false);
      }
    },
    [focus, refresh]
  );

  // First visit of the day: kick off generation automatically so the pack is
  // simply there, matching the "every day it suggests" behaviour.
  useEffect(() => {
    if (loading || storedPack || autoRequested.current) return;
    autoRequested.current = true;
    void generate(false);
  }, [loading, storedPack, generate]);

  return (
    <div>
      <PageHeader
        eyebrow="X / Threads"
        title="Daily Post Engine"
        description="Ten original posts spaced roughly every two hours, plus twenty ready replies for engaging as you scroll. Fresh every day, matched to your positioning brief — suggestions only, nothing is tracked."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Optional focus (e.g. context engineering)"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              className="sm:w-64"
            />
            <Button onClick={() => generate(true)} disabled={generating} className="shrink-0">
              <RefreshCw className={cn("mr-2 h-4 w-4", generating && "animate-spin")} />
              {generating ? "Writing…" : activePack ? "Regenerate" : "Generate today's pack"}
            </Button>
          </div>
        }
      />

      {reason ? (
        <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">{reason}</div>
      ) : null}

      {activePack ? <PackSummary pack={activePack} /> : null}

      <div className="mt-6">
        {activePack ? (
          <Tabs
            tabs={[
              {
                id: "schedule",
                label: "Today's posts",
                icon: Clock,
                content: <ScheduleTab posts={activePack.posts} />
              },
              {
                id: "replies",
                label: "Reply bank",
                icon: MessagesSquare,
                content: <RepliesTab replies={activePack.replies} />
              },
              {
                id: "playbook",
                label: "Playbook",
                icon: BookOpen,
                content: <PlaybookTab />
              }
            ]}
          />
        ) : (
          <Card>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Sparkles className="h-8 w-8 text-[var(--accent)]" />
              <p className="text-sm text-[var(--muted-foreground)]">
                {generating || loading
                  ? "Writing today's ten posts and twenty replies…"
                  : "No pack for today yet — generate one to get started."}
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function PackSummary({ pack }: { pack: XDailyPack }) {
  const first = pack.posts[0];
  const last = pack.posts[pack.posts.length - 1];
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted-foreground)]">Today&apos;s pack · {pack.date}</p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {pack.posts.length} posts · {pack.replies.length} replies
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {first && last ? (
            <Badge>
              {formatTime(first.time)} → {formatTime(last.time)}
            </Badge>
          ) : null}
          <Badge>~every 2 hours</Badge>
          {pack.focus ? <Badge className="text-[var(--accent)]">Focus: {pack.focus}</Badge> : null}
          <Badge className={pack.source === "ai" ? "text-[var(--accent)]" : undefined}>
            {pack.source === "ai" ? "Claude-written" : "Idea library"}
          </Badge>
        </div>
      </div>
    </Card>
  );
}

function ScheduleTab({ posts }: { posts: XSuggestedPost[] }) {
  return (
    <div className="relative space-y-4">
      {/* Timeline rail behind the time chips. */}
      <div aria-hidden className="absolute bottom-6 left-[52px] top-6 hidden w-px bg-white/10 sm:block" />
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

function PostCard({ post }: { post: XSuggestedPost }) {
  const { copiedId, copy } = useCopy();
  const [showThreads, setShowThreads] = useState(false);
  const text = showThreads ? post.threadsVariant : post.text;
  const overLimit = !showThreads && post.text.length > 280;
  const nearLimit = !showThreads && post.text.length > 260;

  return (
    <div className="flex gap-4">
      <div className="relative z-10 hidden w-[104px] shrink-0 flex-col items-center pt-5 sm:flex">
        <span className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1 text-xs font-semibold text-white">
          {formatTime(post.time)}
        </span>
      </div>
      <Card className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-white">
            {post.slot}
          </span>
          <span className="text-xs font-semibold text-white sm:hidden">{formatTime(post.time)}</span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
              FORMAT_STYLES[post.format]
            )}
          >
            {post.format}
          </span>
          <span className="truncate text-xs text-[var(--muted-foreground)]">{post.topic}</span>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{text}</p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-white/5 p-0.5">
            <button
              type="button"
              onClick={() => setShowThreads(false)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition",
                !showThreads ? "bg-white/10 font-medium text-white" : "text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <AtSign className="h-3 w-3" /> X
            </button>
            <button
              type="button"
              onClick={() => setShowThreads(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition",
                showThreads ? "bg-white/10 font-medium text-white" : "text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              <MessageSquare className="h-3 w-3" /> Threads
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "text-xs tabular-nums",
                overLimit ? "text-rose-300" : nearLimit ? "text-amber-300" : "text-[var(--muted-foreground)]"
              )}
            >
              {text.length} chars
            </span>
            <Button
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => copy(`${post.id}:${showThreads ? "threads" : "x"}`, text)}
            >
              {copiedId === `${post.id}:${showThreads ? "threads" : "x"}` ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" />
              )}
              Copy
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RepliesTab({ replies }: { replies: XSuggestedReply[] }) {
  const { copiedId, copy } = useCopy();
  return (
    <div>
      <p className="mb-4 text-sm text-[var(--muted-foreground)]">
        Twenty adaptable replies for when you&apos;re scrolling — each is keyed to a kind of conversation you&apos;ll run
        into. Personalize a detail before posting so it reads as written in the moment, and never paste the same reply
        twice.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {replies.map((reply, index) => (
          <Card key={reply.id} className="flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--accent)]">
                  {String(index + 1).padStart(2, "0")} · {reply.scenario}
                </p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white/90">{reply.text}</p>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => copy(reply.id, reply.text)}>
                {copiedId === reply.id ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                Copy
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const GUARDRAILS: Array<{ title: string; body: string }> = [
  {
    title: "Human cadence, not clockwork",
    body: "Suggested times carry a few minutes of daily jitter on the ~2-hour rhythm. Posting exactly on the hour, every hour, every day is a classic automation fingerprint — drift a little, skip a slot when life happens."
  },
  {
    title: "Post from the app, by hand",
    body: "Copy from here and post manually. Ten originals a day is well within normal heavy-user behaviour when they're genuinely distinct posts published by a human — it's identical, machine-timed content that trips spam systems."
  },
  {
    title: "Never cross-post identical text",
    body: "Every post ships with a reworded Threads variant. Duplicate content across (and within) platforms is a downranking signal on both — always use the variant, never the same words twice."
  },
  {
    title: "Mix broadcasting with conversation",
    body: "Pure broadcast accounts get throttled. Use the reply bank between posting slots — a healthy ratio is roughly 2 replies for every original post, which is exactly why each pack carries 20 replies to 10 posts."
  },
  {
    title: "No hashtags, no bait, few links",
    body: "The brief already bans hashtags and engagement-bait phrasing. Also keep links out of most posts — link-heavy accounts see reduced reach. When you must link, put it in a reply to your own post."
  },
  {
    title: "Stay for the conversation",
    body: "After posting, hang around a few minutes and answer early replies. Real accounts converse; spam accounts fire and forget. The engagement window right after posting also does the most for reach."
  },
  {
    title: "Rest days are fine",
    body: "Missing a day is not a crisis — a natural weekly rhythm with lighter weekends looks more human than 70 identical weeks. Consistency over months beats perfection over days."
  },
  {
    title: "Fresh angles daily",
    body: "The generator sees your last two weeks of packs and avoids recycling angles, so followers (and ranking systems) never see you repeating yourself."
  }
];

function PlaybookTab() {
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-white">
          <Clock className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="font-semibold">The daily system</h3>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--muted-foreground)]">
          <li>Each morning a fresh pack is written against your positioning brief: 10 originals + 20 replies.</li>
          <li>Post the originals at (or near) their suggested times — one roughly every two hours, ~7am to ~10pm.</li>
          <li>Between slots, spend a few minutes scrolling and spend 2-3 replies from the bank, adapted to the actual post.</li>
          <li>Use the X text on X and the Threads variant on Threads, never the same wording on both.</li>
          <li>Tomorrow it regenerates with new angles. Nothing you do here is logged or tracked.</li>
        </ol>
        <p className="text-xs text-[var(--muted-foreground)]">
          The voice, angles, and rules come from your positioning brief in Reply Studio settings — edit it there and every
          future pack follows.
        </p>
      </Card>

      <div>
        <div className="mb-3 flex items-center gap-2 text-white">
          <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="font-semibold">Anti-spam / shadow-ban guardrails</h3>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {GUARDRAILS.map((rail) => (
            <Card key={rail.title} className="space-y-1.5">
              <h4 className="text-sm font-semibold text-white">{rail.title}</h4>
              <p className="text-sm text-[var(--muted-foreground)]">{rail.body}</p>
            </Card>
          ))}
        </div>
      </div>

      <Card className="space-y-2">
        <h3 className="font-semibold text-white">On your phone</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          A daily Claude routine delivers the same brief-driven pack to the Claude app each morning, so you can copy posts
          straight from your phone when you&apos;re away from the dashboard. Manage it from Claude&apos;s routines
          (&quot;Daily X/Threads content pack&quot;).
        </p>
      </Card>
    </div>
  );
}
