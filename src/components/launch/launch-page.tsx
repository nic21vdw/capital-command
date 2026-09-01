"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, Plus, RefreshCw, Rocket, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Textarea } from "@/components/ui/textarea";
import { todayLocal } from "@/lib/execution/dates";
import { buildLaunchPlan } from "@/lib/launch/playbook";
import { cn } from "@/lib/utils";
import type { LaunchCopy, LaunchStats, LaunchStatus, ProductLaunch } from "@/types/domain";

type EditableField = "product" | "productUrl" | "hunter" | "slug" | "notes";

const STATUS_LABELS: Record<LaunchStatus, string> = {
  planning: "Planning",
  scheduled: "Scheduled",
  live: "Live",
  done: "Done"
};

const STATUS_STYLES: Record<LaunchStatus, string> = {
  planning: "border-white/10 bg-white/6 text-[var(--muted-foreground)]",
  scheduled: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  live: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  done: "border-sky-400/30 bg-sky-400/10 text-sky-200"
};

const SURFACE_LABELS: Record<string, string> = {
  x: "X",
  threads: "Threads",
  linkedin: "LinkedIn",
  "youtube-community": "YouTube Community"
};

function daysLabel(days: number) {
  if (days === 0) return "Launch day";
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} to go`;
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
}

function copyToClipboard(label: string, text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error("Could not copy to clipboard"));
}

function CopyBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
        <button
          type="button"
          onClick={() => copyToClipboard(label, value)}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-white"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm text-white">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

export function LaunchPage() {
  const { data, loading, mutate } = useAppData();
  const launches = useMemo(() => data.productLaunches ?? [], [data.productLaunches]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [config, setConfig] = useState({ aiConfigured: false, productHuntConfigured: false });
  const [generating, setGenerating] = useState(false);
  const [refreshingStats, setRefreshingStats] = useState(false);
  const [brief, setBrief] = useState({ audience: "", whatItDoes: "", differentiator: "" });

  useEffect(() => {
    void fetch("/api/launch")
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (json) setConfig(json);
      })
      .catch(() => undefined);
  }, []);

  const selected = launches.find((launch) => launch.id === selectedId) ?? launches[0] ?? null;
  const today = todayLocal();
  const plan = useMemo(() => (selected ? buildLaunchPlan(selected, today) : null), [selected, today]);

  const save = (launch: ProductLaunch, successMessage?: string) =>
    mutate("upsertProductLaunch", launch, successMessage ? { successMessage } : undefined);

  // Free-text fields are held locally and written back on blur — one POST per
  // edit rather than one per keystroke. The draft carries the launch it belongs
  // to, so switching launches discards it without an effect.
  const [draft, setDraft] = useState<{ id: string; values: Partial<Record<EditableField, string>> }>({ id: "", values: {} });
  const pending = selected && draft.id === selected.id ? draft.values : {};

  const field = (key: EditableField) => ({
    value: pending[key] ?? selected?.[key] ?? "",
    onChange: (event: { target: { value: string } }) =>
      selected &&
      setDraft((current) => ({
        id: selected.id,
        values: { ...(current.id === selected.id ? current.values : {}), [key]: event.target.value }
      })),
    onBlur: () => {
      const next = pending[key];
      if (!selected || next === undefined || next === (selected[key] ?? "")) return;
      void save({ ...selected, [key]: next });
    }
  });

  const createLaunch = async () => {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + 21);
    const id = `launch-${crypto.randomUUID()}`;
    await save(
      {
        id,
        product: "CoLateral",
        productUrl: "",
        launchDate: target.toISOString().slice(0, 10),
        status: "planning",
        completedTasks: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      },
      "Launch created"
    );
    setSelectedId(id);
  };

  const generateCopy = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      const response = await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "copy", product: selected.product, productUrl: selected.productUrl, ...brief })
      });
      const json = (await response.json()) as { copy?: LaunchCopy; error?: string };
      if (!response.ok || !json.copy) {
        toast.error(json.error ?? "Could not write the launch copy");
        return;
      }
      await save({ ...selected, copy: json.copy });
      toast[json.copy.aiGenerated ? "success" : "warning"](
        json.copy.aiGenerated ? "Launch copy written" : "Offline draft written — no AI provider reachable"
      );
    } finally {
      setGenerating(false);
    }
  };

  const refreshStats = async () => {
    if (!selected?.slug) return;
    setRefreshingStats(true);
    try {
      const response = await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stats", slug: selected.slug })
      });
      const json = (await response.json()) as { stats?: LaunchStats; error?: string };
      if (!response.ok || !json.stats) {
        toast.error(json.error ?? "Could not reach Product Hunt");
        return;
      }
      await save({ ...selected, stats: json.stats }, "Stats updated");
    } finally {
      setRefreshingStats(false);
    }
  };

  if (loading && launches.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Step 2 · Formats"
        title="Launch Pad"
        description="Plan a Product Hunt launch as a content event: a playbook dated backwards from launch day, the listing copy, and the live standing once it goes up."
        actions={
          <Button onClick={createLaunch}>
            <Plus className="mr-2 h-4 w-4" />
            New launch
          </Button>
        }
      />

      {launches.length === 0 ? (
        <Card className="text-center">
          <Rocket className="mx-auto h-8 w-8 text-[var(--accent)]" />
          <p className="mt-3 text-lg font-semibold text-white">No launch planned</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted-foreground)]">
            Product Hunt gives a product one shot at being featured, and everything that decides the outcome happens in the two
            weeks before. Create a launch to date the playbook backwards from the day you pick.
          </p>
          <Button className="mt-5" onClick={createLaunch}>
            Plan a launch
          </Button>
        </Card>
      ) : null}

      {launches.length > 1 ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {launches.map((launch) => (
            <button
              key={launch.id}
              type="button"
              onClick={() => setSelectedId(launch.id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm transition-colors",
                launch.id === selected?.id
                  ? "border-[var(--accent)] bg-white/10 text-white"
                  : "border-[var(--border)] bg-white/5 text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              {launch.product} · {launch.launchDate}
            </button>
          ))}
        </div>
      ) : null}

      {selected && plan ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Launch day" value={selected.launchDate} detail={daysLabel(plan.daysUntilLaunch)} icon={<Rocket className="h-5 w-5" />} />
            <StatCard
              label="Playbook"
              value={`${plan.completed}/${plan.total}`}
              detail={plan.nextTask ? `Next: ${plan.nextTask.label}` : "Everything done"}
            />
            <StatCard
              label="Overdue"
              value={String(plan.overdueCount)}
              detail={plan.overdueCount === 0 ? "On track" : "Past their due date"}
              icon={plan.overdueCount > 0 ? <TriangleAlert className="h-5 w-5" /> : undefined}
            />
            <StatCard
              label="Product Hunt"
              value={selected.stats ? `${selected.stats.votes} votes` : "—"}
              detail={
                selected.stats
                  ? selected.stats.rank
                    ? `Rank ${selected.stats.rank} of ${selected.stats.dayLaunchCount ?? "?"} · ${selected.stats.comments} comments`
                    : `Outside the top 20 · ${selected.stats.comments} comments`
                  : "No stats read yet"
              }
            />
          </div>

          <Card>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold text-white">Launch details</h2>
              <div className="flex items-center gap-2">
                <Badge className={STATUS_STYLES[selected.status]}>{STATUS_LABELS[selected.status]}</Badge>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm(`Delete the ${selected.product} launch and its checklist progress?`)) return;
                    setSelectedId(null);
                    void mutate("deleteProductLaunch", selected.id, { successMessage: "Launch deleted" });
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Product</span>
                <Input className="mt-1.5" {...field("product")} />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Website</span>
                <Input className="mt-1.5" placeholder="https://colateral.ai?ref=producthunt" {...field("productUrl")} />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Launch date</span>
                <Input
                  className="mt-1.5"
                  type="date"
                  value={selected.launchDate}
                  onChange={(event) => void save({ ...selected, launchDate: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Status</span>
                <Select
                  className="mt-1.5"
                  value={selected.status}
                  onChange={(event) => void save({ ...selected, status: event.target.value as LaunchStatus })}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Hunter</span>
                <Input className="mt-1.5" placeholder="Self-hunting" {...field("hunter")} />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Listing slug or URL
                </span>
                <div className="mt-1.5 flex gap-2">
                  <Input placeholder="colateral" {...field("slug")} />
                  <Button variant="secondary" onClick={refreshStats} disabled={!selected.slug || refreshingStats}>
                    {refreshingStats ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                </div>
              </label>
            </div>

            {!config.productHuntConfigured ? (
              <p className="mt-4 text-xs text-[var(--muted-foreground)]">
                Live stats need a <span className="text-white">PRODUCT_HUNT_TOKEN</span> in <span className="text-white">.env.local</span>{" "}
                — create a developer token under your Product Hunt account&apos;s API dashboard. Everything else on this page works
                without it.
              </p>
            ) : null}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Listing copy</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Answer the three questions, generate a draft, then rewrite it in your own voice. Product Hunt has no API for
              creating a launch, so this is copy you paste into the submission form yourself.
            </p>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Who it is for</span>
                <Textarea
                  className="mt-1.5 min-h-20"
                  placeholder="Structural engineers at small consultancies"
                  value={brief.audience}
                  onChange={(event) => setBrief((current) => ({ ...current, audience: event.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">What it does</span>
                <Textarea
                  className="mt-1.5 min-h-20"
                  placeholder="Turns a set of drawings into a checked design package"
                  value={brief.whatItDoes}
                  onChange={(event) => setBrief((current) => ({ ...current, whatItDoes: event.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                  Why it is different
                </span>
                <Textarea
                  className="mt-1.5 min-h-20"
                  placeholder="Built by a practising engineer, not a generic AI wrapper"
                  value={brief.differentiator}
                  onChange={(event) => setBrief((current) => ({ ...current, differentiator: event.target.value }))}
                />
              </label>
            </div>

            <Button className="mt-4" onClick={generateCopy} disabled={generating}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {selected.copy ? "Rewrite the copy" : "Write the launch copy"}
            </Button>

            {selected.copy ? (
              <div className="mt-5 space-y-4">
                <CopyBlock
                  label="Tagline"
                  value={selected.copy.tagline}
                  hint={`${selected.copy.tagline.length}/60 characters`}
                />
                <CopyBlock label="Description" value={selected.copy.description} />
                <CopyBlock label="First comment" value={selected.copy.firstComment} />
                {selected.copy.topics.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Topics</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {selected.copy.topics.map((topic) => (
                        <Badge key={topic}>{topic}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {selected.copy.galleryCaptions.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Gallery order</p>
                    <ol className="mt-1.5 space-y-1 text-sm text-white">
                      {selected.copy.galleryCaptions.map((caption, index) => (
                        <li key={caption} className="flex gap-2">
                          <span className="text-[var(--muted-foreground)]">{index + 1}.</span>
                          {caption}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                {selected.copy.socialPosts.map((post) => (
                  <CopyBlock key={post.surface} label={SURFACE_LABELS[post.surface] ?? post.surface} value={post.text} />
                ))}
                {!selected.copy.aiGenerated ? (
                  <p className="text-xs text-amber-200">
                    This is the offline draft — no AI provider was reachable when it was written. Regenerate for a stronger pass.
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Playbook</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Every task is dated off {selected.launchDate}. Move the launch date and the whole schedule moves with it.
            </p>

            <div className="mt-5 space-y-6">
              {plan.groups.map((group) => (
                <div key={group.phase}>
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{group.title}</p>
                  <div className="mt-2 space-y-2">
                    {group.tasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() =>
                          void mutate("toggleLaunchTask", { launchId: selected.id, taskId: task.id, done: !task.done })
                        }
                        className={cn(
                          "flex w-full gap-3 rounded-lg border p-3 text-left transition-colors",
                          task.done
                            ? "border-emerald-400/20 bg-emerald-400/5"
                            : task.overdue
                              ? "border-amber-400/30 bg-amber-400/5 hover:border-amber-400/50"
                              : "border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border-strong)]"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                            task.done ? "border-emerald-400/40 bg-emerald-400/20 text-emerald-200" : "border-white/20"
                          )}
                        >
                          {task.done ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className={cn("text-sm font-medium", task.done ? "text-[var(--muted-foreground)] line-through" : "text-white")}>
                              {task.label}
                            </span>
                            <span className="text-xs text-[var(--muted-foreground)]">{task.dueDate}</span>
                            {task.overdue ? <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">Overdue</Badge> : null}
                          </span>
                          <span className="mt-1 block text-sm text-[var(--muted-foreground)]">{task.detail}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-white">Notes</h2>
            <Textarea
              className="mt-3"
              placeholder="Competitors launching the same day, hunter conversations, feedback worth acting on…"
              {...field("notes")}
            />
          </Card>
        </div>
      ) : null}
    </div>
  );
}
