"use client";

import { useMemo, useState } from "react";
import {
  AtSign,
  CalendarDays,
  Check,
  Copy,
  MessageSquare,
  Pencil,
  Send,
  Sparkles,
  Target,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { makeXActivity, useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  analyzeActivities,
  computeWeekStatus,
  daysBetween,
  localDateKey,
  type WeekStatus,
  type XAnalysis
} from "@/lib/x-strategy/analytics";
import { cn } from "@/lib/utils";
import type { XActivity, XActivityType, XStrategy } from "@/types/domain";

/** Matches the provider's mutate signature. */
type MutateFn = (action: string, payload?: unknown, options?: { successMessage?: string }) => Promise<void>;

interface GenerateResponse {
  sessionBrief: string;
  strategy: string | null;
  reason: string | null;
  configured: boolean;
}

export function XStrategyPage() {
  const { data, mutate } = useAppData();
  const x = data.xStrategy;
  const today = localDateKey();

  const analysis = useMemo(() => analyzeActivities(x.activities, today), [x.activities, today]);
  const week = useMemo(
    () => computeWeekStatus(x.activities, x.dailyReplyTarget, x.dailyPostTarget, today),
    [x.activities, x.dailyReplyTarget, x.dailyPostTarget, today]
  );

  return (
    <div>
      <PageHeader
        eyebrow="X / Twitter"
        title="Reply Studio"
        description="Generate today's reply plan, stay on cadence (3 replies + 1 post per day), and log everything you post — all in one place."
      />

      <WeeklyTracker week={week} />

      <div className="mt-6">
        <Tabs
          tabs={[
            {
              id: "brief",
              label: "Today's brief",
              icon: Sparkles,
              content: <BriefTab analysis={analysis} week={week} />
            },
            { id: "log", label: "Log activity", icon: Send, content: <LogTab mutate={mutate} /> },
            {
              id: "history",
              label: "History",
              icon: CalendarDays,
              content: <HistoryTab activities={x.activities} today={today} mutate={mutate} />
            },
            { id: "settings", label: "Brief & targets", icon: Pencil, content: <SettingsTab x={x} mutate={mutate} /> }
          ]}
        />
      </div>
    </div>
  );
}

function WeeklyTracker({ week }: { week: WeekStatus }) {
  const replyPct = week.weekReplyTarget ? (week.weekReplies / week.weekReplyTarget) * 100 : 0;
  const postPct = week.weekPostTarget ? (week.weekPosts / week.weekPostTarget) * 100 : 0;
  const behind = week.replyCarryDeficit > 0 || week.postCarryDeficit > 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-[var(--muted-foreground)]">This week</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Weekly cadence</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{week.replyTargetPerDay} replies/day</Badge>
          <Badge>{week.postTargetPerDay} post/day</Badge>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        {week.days.map((day) => {
          const done = day.repliesMet && day.postsMet;
          return (
            <div
              key={day.date}
              className={cn(
                "rounded-2xl border p-3 text-center transition",
                day.isToday ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-white/8 bg-[var(--well)]",
                day.isFuture && "opacity-40"
              )}
            >
              <p className="text-xs font-medium text-[var(--muted-foreground)]">{day.weekday}</p>
              <p className={cn("mt-1 text-sm font-semibold", done ? "text-[var(--accent)]" : "text-white")}>
                {day.replies}/{week.replyTargetPerDay}
                <span className="text-[var(--muted-foreground)]"> r</span>
              </p>
              <p className={cn("text-sm font-semibold", day.postsMet ? "text-[var(--accent)]" : "text-white")}>
                {day.posts}/{week.postTargetPerDay}
                <span className="text-[var(--muted-foreground)]"> p</span>
              </p>
              {done && !day.isFuture ? <Check className="mx-auto mt-1 h-4 w-4 text-[var(--accent)]" /> : null}
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--muted-foreground)]">Replies this week</span>
            <span className="font-medium text-white">
              {week.weekReplies}/{week.weekReplyTarget}
            </span>
          </div>
          <Progress className="mt-2" value={replyPct} />
        </div>
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--muted-foreground)]">Posts this week</span>
            <span className="font-medium text-white">
              {week.weekPosts}/{week.weekPostTarget}
            </span>
          </div>
          <Progress className="mt-2" value={postPct} />
        </div>
      </div>

      <div
        className={cn(
          "mt-5 rounded-2xl border p-4 text-sm",
          behind ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-white/8 bg-[var(--well)] text-white"
        )}
      >
        {week.remainingReplies === 0 && week.remainingPosts === 0 ? (
          <span>Today&apos;s minimum is done. Anything more is a bonus — nice work.</span>
        ) : (
          <span>
            <strong>Today&apos;s goal:</strong> {week.remainingReplies} more repl
            {week.remainingReplies === 1 ? "y" : "ies"} and {week.remainingPosts} more post
            {week.remainingPosts === 1 ? "" : "s"}.
            {behind
              ? ` You're carrying a catch-up from earlier this week (${week.replyCarryDeficit} replies, ${week.postCarryDeficit} posts), so today's bar is raised to keep you on pace.`
              : ""}
          </span>
        )}
      </div>
    </Card>
  );
}

function BriefTab({ analysis, week }: { analysis: XAnalysis; week: WeekStatus }) {
  const [focus, setFocus] = useState("");
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setReason(null);
    try {
      const response = await fetch("/api/x-strategy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus })
      });
      if (!response.ok) throw new Error("request failed");
      const json = (await response.json()) as GenerateResponse;
      setBrief(json.sessionBrief);
      setReason(json.reason);
      toast.success("Session brief ready.");
    } catch {
      toast.error("Could not generate the session brief.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      toast.success("Copied the session brief.");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable — select and copy the text manually.");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Today&apos;s session brief</h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Generate a copy-paste brief for your Claude browser session. Optionally point it at a focus topic.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Optional focus topic (e.g. context engineering)"
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
          />
          <Button onClick={generate} disabled={loading} className="shrink-0">
            <Sparkles className="mr-2 h-4 w-4" />
            {loading ? "Generating…" : "Generate brief"}
          </Button>
        </div>

        {reason ? (
          <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">{reason}</p>
        ) : null}

        {brief ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button variant="secondary" onClick={copy} className="shrink-0">
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? "Copied" : "Copy to clipboard"}
              </Button>
            </div>
            <Textarea readOnly value={brief} className="min-h-[360px] font-mono text-xs leading-relaxed" />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/12 bg-[var(--well)] p-8 text-center text-sm text-[var(--muted-foreground)]">
            Your generated session brief will appear here.
          </div>
        )}
      </Card>

      <div className="space-y-6">
        <Card className="space-y-3">
          <div className="flex items-center gap-2 text-white">
            <Target className="h-4 w-4 text-[var(--accent)]" />
            <h3 className="font-semibold">Today at a glance</h3>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {week.remainingReplies} repl{week.remainingReplies === 1 ? "y" : "ies"} and {week.remainingPosts} post
            {week.remainingPosts === 1 ? "" : "s"} left to hit your minimum today.
          </p>
          <p className="text-sm text-[var(--muted-foreground)]">
            This month: {analysis.repliesThisMonth} replies, {analysis.postsThisMonth} posts logged.
          </p>
        </Card>

        <Card className="space-y-3">
          <h3 className="font-semibold text-white">Avoid this week</h3>
          <p className="text-xs text-[var(--muted-foreground)]">Replied to in the last 7 days.</p>
          <div className="flex flex-wrap gap-2">
            {analysis.accountsLast7Days.length ? (
              analysis.accountsLast7Days.map((account) => <Badge key={account}>{account}</Badge>)
            ) : (
              <span className="text-sm text-[var(--muted-foreground)]">Nothing yet.</span>
            )}
          </div>
          {analysis.frequentAccounts.length ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
              Leaning on: {analysis.frequentAccounts.map((entry) => `${entry.account} (${entry.count}x)`).join(", ")}
            </div>
          ) : null}
        </Card>

        <Card className="space-y-3">
          <h3 className="font-semibold text-white">Covered recently</h3>
          <p className="text-xs text-[var(--muted-foreground)]">Topics from the last 14 days.</p>
          <div className="flex flex-wrap gap-2">
            {analysis.topicsLast14Days.length ? (
              analysis.topicsLast14Days.map((topic) => <Badge key={topic}>{topic}</Badge>)
            ) : (
              <span className="text-sm text-[var(--muted-foreground)]">Nothing yet.</span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function LogTab({ mutate }: { mutate: MutateFn }) {
  const [type, setType] = useState<XActivityType>("reply");
  const [account, setAccount] = useState("");
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [engagement, setEngagement] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setAccount("");
    setTopic("");
    setText("");
    setEngagement("");
  };

  const submit = async () => {
    if (!topic.trim() || !text.trim()) {
      toast.error("Add a topic and the exact text before logging.");
      return;
    }
    if (type === "reply" && !account.trim()) {
      toast.error("Add the account you replied to.");
      return;
    }
    setSaving(true);
    const activity = makeXActivity({
      type,
      account: type === "reply" ? account.trim() : "",
      topic: topic.trim(),
      text: text.trim(),
      engagement: engagement.trim()
    });
    await mutate("logXActivity", activity, {
      successMessage: type === "reply" ? "Reply logged." : "Post logged."
    });
    reset();
    setSaving(false);
  };

  return (
    <Card className="max-w-2xl space-y-4">
      <div className="flex gap-2">
        {(["reply", "post"] as XActivityType[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setType(option)}
            className={cn(
              "flex items-center gap-2 rounded-2xl px-4 py-2 text-sm transition",
              type === option
                ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                : "bg-white/6 text-[var(--muted-foreground)] hover:text-white"
            )}
          >
            {option === "reply" ? <MessageSquare className="h-4 w-4" /> : <AtSign className="h-4 w-4" />}
            {option === "reply" ? "Reply" : "Post"}
          </button>
        ))}
      </div>

      {type === "reply" ? (
        <div className="space-y-1">
          <label className="text-sm text-[var(--muted-foreground)]">Account replied to</label>
          <Input placeholder="@handle" value={account} onChange={(event) => setAccount(event.target.value)} />
        </div>
      ) : null}

      <div className="space-y-1">
        <label className="text-sm text-[var(--muted-foreground)]">Topic</label>
        <Input
          placeholder={type === "reply" ? "e.g. Databricks meta-harness" : "e.g. why verification beats volume"}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm text-[var(--muted-foreground)]">
          {type === "reply" ? "Exact reply text" : "Exact post text"}
        </label>
        <Textarea
          placeholder="Paste exactly what you posted…"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm text-[var(--muted-foreground)]">Engagement notes (optional)</label>
        <Input
          placeholder="e.g. author replied, 3 likes, no response yet"
          value={engagement}
          onChange={(event) => setEngagement(event.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={saving}>
          <Send className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : `Log ${type}`}
        </Button>
      </div>
    </Card>
  );
}

function HistoryTab({ activities, today, mutate }: { activities: XActivity[]; today: string; mutate: MutateFn }) {
  const recent = useMemo(() => {
    return activities
      .filter((activity) => {
        const age = daysBetween(today, activity.date);
        return age >= 0 && age <= 30;
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));
  }, [activities, today]);

  if (!recent.length) {
    return (
      <Card>
        <p className="text-sm text-[var(--muted-foreground)]">
          No replies or posts logged in the last 30 days. Log your first one from the “Log activity” tab.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Last 30 days</h3>
        <Badge>{recent.length} logged</Badge>
      </div>
      <div className="space-y-2">
        {recent.map((activity) => (
          <div
            key={activity.id}
            className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-[var(--well)] p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={activity.type === "post" ? "text-[var(--accent)]" : undefined}>{activity.type}</Badge>
                <span className="text-xs text-[var(--muted-foreground)]">{activity.date}</span>
                {activity.account ? <span className="text-sm font-medium text-white">{activity.account}</span> : null}
                <span className="text-sm text-[var(--muted-foreground)]">· {activity.topic}</span>
              </div>
              <p className="mt-2 text-sm text-white/90">{activity.text}</p>
              {activity.engagement ? (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{activity.engagement}</p>
              ) : null}
            </div>
            <Button
              variant="ghost"
              className="shrink-0 px-3"
              onClick={() => mutate("deleteXActivity", activity.id, { successMessage: "Deleted." })}
              aria-label="Delete entry"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SettingsTab({ x, mutate }: { x: XStrategy; mutate: MutateFn }) {
  const [brief, setBrief] = useState(x.brief);
  const [replyTarget, setReplyTarget] = useState(String(x.dailyReplyTarget));
  const [postTarget, setPostTarget] = useState(String(x.dailyPostTarget));
  const [savingBrief, setSavingBrief] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);

  const saveBrief = async () => {
    if (!brief.trim()) {
      toast.error("The brief can't be empty.");
      return;
    }
    setSavingBrief(true);
    await mutate("updateXBrief", { brief }, { successMessage: "Brief saved." });
    setSavingBrief(false);
  };

  const saveTargets = async () => {
    const reply = Number(replyTarget);
    const post = Number(postTarget);
    if (!Number.isFinite(reply) || !Number.isFinite(post) || reply < 0 || post < 0) {
      toast.error("Targets must be zero or a positive whole number.");
      return;
    }
    setSavingTargets(true);
    await mutate(
      "updateXTargets",
      { dailyReplyTarget: Math.round(reply), dailyPostTarget: Math.round(post) },
      { successMessage: "Targets updated." }
    );
    setSavingTargets(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card className="space-y-3">
        <div>
          <h3 className="font-semibold text-white">Positioning brief</h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            This is the voice, angles, and rules sent to your Claude session. Edit it any time (Markdown).
          </p>
        </div>
        <Textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          className="min-h-[420px] font-mono text-xs leading-relaxed"
        />
        <div className="flex justify-end">
          <Button onClick={saveBrief} disabled={savingBrief}>
            {savingBrief ? "Saving…" : "Save brief"}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <h3 className="font-semibold text-white">Daily minimums</h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Drives the weekly tracker and the catch-up math.</p>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-[var(--muted-foreground)]">Replies per day</label>
          <Input type="number" min={0} value={replyTarget} onChange={(event) => setReplyTarget(event.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-[var(--muted-foreground)]">Posts per day</label>
          <Input type="number" min={0} value={postTarget} onChange={(event) => setPostTarget(event.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button onClick={saveTargets} disabled={savingTargets}>
            {savingTargets ? "Saving…" : "Save targets"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
