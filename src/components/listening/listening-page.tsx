"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Ear, Loader2, Plus, Radar, Send, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useRefreshListeningLeads } from "@/components/listening/leads-badge";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { HIGH_LEAD_SCORE, isHighLead, leadSummary } from "@/lib/listening/leads";
import {
  HIT_CATEGORIES,
  LISTENING_INTENTS,
  LISTENING_SOURCES,
  REPLY_CHECKLIST,
  RESULT_STATUSES,
  SCAN_INTERVAL_MS,
  SOURCE_LABELS,
  SOURCE_NOTES,
  intentOfTerms,
  type HitCategory,
  type KeywordGroup,
  type ListeningIntent,
  type ListeningResult,
  type ListeningSnapshot,
  type ListeningSource,
  type ResultStatus,
  type ScanReport
} from "@/lib/listening/model";
import { cn } from "@/lib/utils";

const INTENT_LABELS: Record<ListeningIntent, string> = {
  pain: "Pain",
  comparison: "Comparison",
  pricing: "Pricing",
  brand: "Brand",
  competitor: "Competitor"
};
const INTENT_TONE: Record<ListeningIntent, BadgeTone> = { pain: "warning", comparison: "info", pricing: "accent", brand: "success", competitor: "neutral" };
const STATUS_LABELS: Record<ResultStatus, string> = { new: "New", seen: "Seen", "sent-to-outreach": "In Outreach", dismissed: "Dismissed" };
const CATEGORY_LABELS: Record<HitCategory, string> = { lead: "Lead", mention: "Mention", competitor: "Competitor", noise: "Noise" };
const CATEGORY_TONE: Record<HitCategory, BadgeTone> = { lead: "success", mention: "info", competitor: "warning", noise: "neutral" };
const TRIAGE_STATUSES = ["new", "seen", "dismissed"] as const;

type StatusFilter = ResultStatus | "all";
type CategoryFilter = HitCategory | "all";
type CallResult = ListeningSnapshot & { error?: string; report?: ScanReport; joined?: boolean; newLeads?: number };

const labelClass = "text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]";

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function moodOf(sentiment: number): { label: string; tone: BadgeTone } {
  if (sentiment >= 0.25) return { label: "Positive", tone: "success" };
  if (sentiment <= -0.25) return { label: "Negative", tone: "danger" };
  return { label: "Neutral", tone: "neutral" };
}

async function call(method: "POST" | "PATCH", body: unknown): Promise<CallResult> {
  const response = await fetch("/api/listening", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = (await response.json().catch(() => ({}))) as CallResult;
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

function scanSummary(report: ScanReport | undefined): string {
  if (!report) return "Never scanned";
  if (report.sources.length === 0) return "No sources switched on";
  return report.sources
    .map((source) => {
      if (source.skipped) return `${SOURCE_LABELS[source.source]}: skipped`;
      if (!source.ok) return `${SOURCE_LABELS[source.source]}: failed${source.httpStatus ? ` (HTTP ${source.httpStatus})` : ""}`;
      return `${SOURCE_LABELS[source.source]}: ${source.added} new of ${source.matched}`;
    })
    .join(" · ");
}

function nextScanLabel(store: ListeningSnapshot): string {
  if (!store.autoScan) return "Automatic scanning is off";
  if (!store.lastScan) return "Due now";
  const due = new Date(store.lastScan.at).getTime() + SCAN_INTERVAL_MS;
  const minutes = Math.round((due - Date.now()) / 60_000);
  if (minutes <= 0) return "Due now";
  return minutes < 90 ? `Next scan in about ${minutes} min` : `Next scan in about ${Math.round(minutes / 60)} h`;
}

async function fetchListening(): Promise<ListeningSnapshot> {
  const response = await fetch("/api/listening", { cache: "no-store" });
  const json = (await response.json().catch(() => ({}))) as ListeningSnapshot & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

export function ListeningPage() {
  const [store, setStore] = useState<ListeningSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<ListeningSource | "all">("all");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [termDrafts, setTermDrafts] = useState<Record<string, string>>({});
  const [newGroup, setNewGroup] = useState<{ name: string; intent: ListeningIntent }>({ name: "", intent: "pain" });
  const refreshLeads = useRefreshListeningLeads();

  useEffect(() => {
    let live = true;
    fetchListening().then(
      (json) => {
        if (live) setStore(json);
      },
      (error: unknown) => {
        if (live) setLoadError(error instanceof Error ? error.message : String(error));
      }
    );
    return () => {
      live = false;
    };
  }, []);

  const run = async (action: () => Promise<ListeningSnapshot>, success?: string) => {
    try {
      setStore(await action());
      refreshLeads();
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const scan = async () => {
    setScanning(true);
    try {
      const result = await call("POST", { action: "scan" });
      setStore(result);
      refreshLeads();
      const failed = result.report?.sources.filter((source) => !source.ok && !source.skipped) ?? [];
      const added = result.report?.sources.reduce((sum, source) => sum + source.added, 0) ?? 0;
      if (failed.length > 0) {
        toast.error(failed.map((source) => `${SOURCE_LABELS[source.source]}: ${source.error}`).join(" | "));
      } else {
        const leads = result.newLeads ?? 0;
        toast.success(added === 0 ? "Scan finished - nothing new" : `Scan finished - ${added} new${leads > 0 ? `, ${leads} high-score lead${leads === 1 ? "" : "s"}` : ""}`);
      }
    } catch (error) {
      toast.error(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setScanning(false);
    }
  };

  const sendToOutreach = async (result: ListeningResult) => {
    setSendingId(result.id);
    const ok = await run(() => call("POST", { action: "send-to-outreach", resultId: result.id }), "Sent to Outreach");
    setSendingId(null);
    return ok;
  };

  const setResult = (resultId: string, patch: { status?: (typeof TRIAGE_STATUSES)[number]; note?: string }) =>
    run(() => call("PATCH", { resultId, ...patch }));
  const saveGroups = (groups: KeywordGroup[], success?: string) => run(() => call("PATCH", { groups }), success);
  const setSources = (sources: Partial<Record<ListeningSource, boolean>>) => run(() => call("PATCH", { sources }));
  const setAutoScan = (autoScan: boolean) => run(() => call("PATCH", { autoScan }));

  const results = useMemo(() => store?.results ?? [], [store]);
  const groups = useMemo(() => store?.groups ?? [], [store]);
  const visible = useMemo(
    () =>
      results
        .filter(
          (result) =>
            (statusFilter === "all" || result.status === statusFilter) &&
            (categoryFilter === "all" || result.category === categoryFilter) &&
            (sourceFilter === "all" || result.source === sourceFilter)
        )
        .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt)),
    [results, statusFilter, categoryFilter, sourceFilter]
  );
  const counts = useMemo(() => {
    const out: Record<ResultStatus, number> = { new: 0, seen: 0, "sent-to-outreach": 0, dismissed: 0 };
    for (const result of results) out[result.status] += 1;
    return out;
  }, [results]);
  const categoryCounts = useMemo(() => {
    const out: Record<HitCategory, number> = { lead: 0, mention: 0, competitor: 0, noise: 0 };
    for (const result of results) if (statusFilter === "all" || result.status === statusFilter) out[result.category] += 1;
    return out;
  }, [results, statusFilter]);
  const leads = useMemo(() => leadSummary(results, 10), [results]);
  const lastScan = store?.lastScan;
  const failedSources = lastScan?.sources.filter((source) => !source.ok && !source.skipped) ?? [];
  const skippedSources = lastScan?.sources.filter((source) => source.skipped || source.note) ?? [];

  const surfaceResults = visible.slice(0, 40);
  useColateralSurface({
    route: "/listening",
    title: "Listening",
    summary:
      "Public Hacker News, Reddit, YouTube and Bluesky posts matching the keyword groups, scanned every two hours while the app runs. Each hit is classified as a lead, mention, competitor or noise with a sentiment and a score; high-score leads are what to answer. Nothing is ever posted from here.",
    fields: [
      { id: "statusFilter", label: "Show", value: statusFilter, kind: "select", options: ["all", ...RESULT_STATUSES] },
      { id: "categoryFilter", label: "Category", value: categoryFilter, kind: "select", options: ["all", ...HIT_CATEGORIES] },
      { id: "sourceFilter", label: "Source", value: sourceFilter, kind: "select", options: ["all", ...LISTENING_SOURCES] },
      ...LISTENING_SOURCES.filter((source) => source !== "x").map((source) => ({
        id: `source:${source}`,
        label: `Scan ${SOURCE_LABELS[source]}`,
        value: store?.sources[source] ?? true,
        kind: "boolean" as const
      })),
      { id: "autoScan", label: "Scan every two hours", value: store?.autoScan ?? true, kind: "boolean" },
      ...surfaceResults
        .filter((result) => result.status !== "sent-to-outreach")
        .map((result) => ({
          id: `status:${result.id}`,
          label: `${result.title.slice(0, 80)} status`,
          value: result.status,
          kind: "select" as const,
          options: [...TRIAGE_STATUSES]
        }))
    ],
    controls: [{ id: "scan", label: scanning ? "Scanning…" : "Scan now", group: "Scan", disabled: scanning }],
    readings: [
      {
        label: "New leads",
        value:
          leads.newLeads === 0
            ? "None waiting"
            : `${leads.newLeads} waiting: ${leads.leads
                .map((lead) => {
                  const hit = results.find((result) => result.id === lead.id);
                  return `[${lead.id}] ${lead.title} - ${SOURCE_LABELS[lead.source]} - score ${lead.score}, ${hit?.sentiment ?? 0} sentiment - ${hit?.reason ?? ""} - ${lead.url}`;
                })
                .join("; ")}`
      },
      { label: "Results", value: `${results.length} (${counts.new} new, ${counts.seen} seen, ${counts["sent-to-outreach"]} sent to outreach, ${counts.dismissed} dismissed)` },
      { label: "Last scan", value: lastScan ? `${lastScan.at} - ${scanSummary(lastScan)}` : "Never scanned" },
      { label: "Next scan", value: store ? nextScanLabel(store) : "Unknown" },
      ...failedSources.map((source) => ({ label: `${SOURCE_LABELS[source.source]} error`, value: source.error ?? "failed" })),
      ...skippedSources.map((source) => ({ label: `${SOURCE_LABELS[source.source]} note`, value: source.error ?? source.note ?? "skipped" })),
      {
        label: "Keyword groups",
        value: groups.map((group) => `${group.name} (${group.intent}): ${group.terms.join(", ")}`).join(" | ") || "None"
      },
      {
        label: "Listed results",
        value:
          surfaceResults
            .map((result) => `[${result.id}] ${result.title} - ${result.url} - ${result.category}, score ${result.score}, sentiment ${result.sentiment} - ${result.status}`)
            .join("; ") || "None"
      },
      { label: "Reply checklist", value: REPLY_CHECKLIST.join(" ") }
    ],
    setField: (id, value) => {
      if (id === "statusFilter") {
        if (value !== "all" && !RESULT_STATUSES.includes(value as ResultStatus)) return false;
        setStatusFilter(value as StatusFilter);
        return true;
      }
      if (id === "categoryFilter") {
        if (value !== "all" && !HIT_CATEGORIES.includes(value as HitCategory)) return false;
        setCategoryFilter(value as CategoryFilter);
        return true;
      }
      if (id === "sourceFilter") {
        if (value !== "all" && !LISTENING_SOURCES.includes(value as ListeningSource)) return false;
        setSourceFilter(value as ListeningSource | "all");
        return true;
      }
      if (id.startsWith("source:")) {
        const source = id.slice("source:".length) as ListeningSource;
        if (typeof value !== "boolean" || source === "x" || !LISTENING_SOURCES.includes(source)) return false;
        void setSources({ [source]: value });
        return true;
      }
      if (id === "autoScan") {
        if (typeof value !== "boolean") return false;
        void setAutoScan(value);
        return true;
      }
      if (id.startsWith("status:")) {
        const resultId = id.slice("status:".length);
        if (!TRIAGE_STATUSES.includes(value as (typeof TRIAGE_STATUSES)[number]) || !results.some((result) => result.id === resultId)) return false;
        void setResult(resultId, { status: value as (typeof TRIAGE_STATUSES)[number] });
        return true;
      }
      return false;
    },
    click: (id) => {
      if (id !== "scan" || scanning) return false;
      void scan();
      return true;
    }
  });

  if (!store && !loadError) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const addTerm = (group: KeywordGroup) => {
    const term = (termDrafts[group.id] ?? "").trim().toLowerCase();
    if (!term) return;
    if (group.terms.some((existing) => existing.toLowerCase() === term)) {
      toast.message(`"${term}" is already in ${group.name}`);
      return;
    }
    void saveGroups(groups.map((entry) => (entry.id === group.id ? { ...entry, terms: [...entry.terms, term] } : entry))).then((ok) => {
      if (ok) setTermDrafts((current) => ({ ...current, [group.id]: "" }));
    });
  };

  const removeTerm = (group: KeywordGroup, term: string) =>
    void saveGroups(groups.map((entry) => (entry.id === group.id ? { ...entry, terms: entry.terms.filter((t) => t !== term) } : entry)));

  const addGroup = () => {
    const name = newGroup.name.trim();
    if (!name) return;
    const group: KeywordGroup = { id: `group-${crypto.randomUUID()}`, name, intent: newGroup.intent, terms: [] };
    void saveGroups([...groups, group], "Group added").then((ok) => {
      if (ok) setNewGroup({ name: "", intent: newGroup.intent });
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Studio"
        title="Listening"
        description="Hacker News, Reddit, YouTube and Bluesky posts where someone describes a problem CoLateral solves, scanned every two hours while the app is open. Each one is sorted into lead, mention, competitor or noise, with a sentiment and a score. Answer the leads you genuinely can help with; nothing is posted from here."
        actions={
          <Button onClick={() => void scan()} disabled={scanning}>
            {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
        }
      />

      {loadError ? (
        <Card className="tone-danger tone-edge tone-soft mb-5">
          <p className="text-sm text-white">Could not load Listening: {loadError}</p>
        </Card>
      ) : null}

      {failedSources.length > 0 ? (
        <Card className="tone-warning tone-edge tone-soft mb-5">
          <div className="flex gap-3">
            <TriangleAlert className="tone-text mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1 text-sm text-white">
              <p className="font-medium">The last scan did not reach every source.</p>
              {failedSources.map((source) => (
                <p key={source.source}>
                  <span className="font-medium">{SOURCE_LABELS[source.source]}:</span> {source.error}
                </p>
              ))}
              <p className="text-[var(--muted-foreground)]">Results from the sources that answered were still saved.</p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="New leads"
          value={String(leads.newLeads)}
          detail={`Score ${HIGH_LEAD_SCORE}+ and still new`}
          icon={<UserPlus className="h-5 w-5" />}
          tone={leads.newLeads > 0 ? "success" : "neutral"}
        />
        <StatCard label="Waiting for triage" value={String(counts.new)} detail={`${results.length} on the list`} icon={<Ear className="h-5 w-5" />} />
        <StatCard label="In Outreach" value={String(counts["sent-to-outreach"])} detail={`${counts.seen} seen, ${counts.dismissed} dismissed`} icon={<Send className="h-5 w-5" />} />
        <StatCard label="Last scan" value={lastScan ? ago(lastScan.at) || "—" : "Never"} detail={store ? nextScanLabel(store) : scanSummary(lastScan)} />
      </div>

      <Card className="mt-5">
        <h2 className="text-lg font-semibold text-white">Before you reply</h2>
        <ul className="mt-3 space-y-2 text-sm text-white">
          {REPLY_CHECKLIST.map((item) => (
            <li key={item} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
              {item}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          {(["new", "seen", "sent-to-outreach", "dismissed", "all"] as StatusFilter[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setStatusFilter(option)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                statusFilter === option
                  ? "border-[var(--accent)] bg-white/10 text-white"
                  : "border-[var(--border)] bg-white/5 text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              {option === "all" ? "All" : STATUS_LABELS[option]}{" "}
              <span className="text-[var(--muted-foreground)]">{option === "all" ? results.length : counts[option]}</span>
            </button>
          ))}
          <Select
            className="ml-auto h-9 w-40"
            aria-label="Source"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as ListeningSource | "all")}
          >
            <option value="all">All sources</option>
            {LISTENING_SOURCES.filter((source) => source !== "x").map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(["all", ...HIT_CATEGORIES] as CategoryFilter[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategoryFilter(option)}
              className={cn(
                "rounded-lg border px-3 py-1 text-xs transition-colors",
                categoryFilter === option
                  ? "border-[var(--accent)] bg-white/10 text-white"
                  : "border-[var(--border)] bg-white/5 text-[var(--muted-foreground)] hover:text-white"
              )}
            >
              {option === "all" ? "Any kind" : CATEGORY_LABELS[option]}{" "}
              <span className="text-[var(--muted-foreground)]">
                {option === "all" ? Object.values(categoryCounts).reduce((sum, value) => sum + value, 0) : categoryCounts[option]}
              </span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="mt-5 text-sm text-[var(--muted-foreground)]">
            {results.length === 0 ? "Nothing yet. Press Scan now, or wait for the next automatic scan." : "Nothing matches this filter."}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {visible.map((result) => {
              const intents = intentOfTerms(groups, result.matchedTerms);
              const note = noteDrafts[result.id] ?? result.note;
              const mood = moodOf(result.sentiment);
              const open = result.status === "new";
              return (
                <div
                  key={result.id}
                  className={cn(
                    "rounded-lg border p-3",
                    open ? "border-[var(--border)] bg-[var(--surface-2)]" : "border-[var(--border)] bg-white/[0.02] opacity-80",
                    isHighLead(result) && "border-[var(--accent)]"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-start gap-1.5 text-sm font-medium text-white hover:underline"
                      >
                        {result.title}
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
                      </a>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {SOURCE_LABELS[result.source]} · {result.author || "unknown"} · {ago(result.createdAt)}
                        {result.alsoOn.length > 0 ? ` · also on ${[...new Set(result.alsoOn.map((other) => SOURCE_LABELS[other.source]))].join(", ")}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone={CATEGORY_TONE[result.category]}>{CATEGORY_LABELS[result.category]}</Badge>
                      <Badge tone={result.score >= HIGH_LEAD_SCORE ? "accent" : "neutral"}>Score {result.score}</Badge>
                      <Badge tone={mood.tone}>{mood.label}</Badge>
                      {intents.map((intent) => (
                        <Badge key={intent} tone={INTENT_TONE[intent]}>
                          {INTENT_LABELS[intent]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {result.reason ? <p className="mt-2 text-xs text-[var(--muted-foreground)]">{result.reason}</p> : null}
                  {result.excerpt ? <p className="mt-2 text-sm text-[var(--muted-foreground)]">{result.excerpt}</p> : null}
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">Matched: {result.matchedTerms.join(", ")}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {result.status === "sent-to-outreach" ? (
                      <Link href="/outreach" className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-[var(--accent)] hover:underline">
                        In Outreach
                      </Link>
                    ) : (
                      <Button variant="success" className="h-8 px-3 text-xs" disabled={sendingId === result.id} onClick={() => void sendToOutreach(result)}>
                        {sendingId === result.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                        Send to Outreach
                      </Button>
                    )}
                    {TRIAGE_STATUSES.map((status) => (
                      <Button
                        key={status}
                        variant={result.status === status ? "secondary" : "ghost"}
                        className="h-8 px-3 text-xs"
                        onClick={() => void setResult(result.id, { status })}
                      >
                        {status === "new" ? "Back to new" : STATUS_LABELS[status]}
                      </Button>
                    ))}
                    <Input
                      className="h-8 min-w-48 flex-1 text-xs"
                      placeholder="Note (what you said, or why not)"
                      value={note}
                      onChange={(event) => setNoteDrafts((current) => ({ ...current, [result.id]: event.target.value }))}
                      onBlur={() => {
                        if (note === result.note) return;
                        void setResult(result.id, { note }).then(() =>
                          setNoteDrafts((current) => {
                            const next = { ...current };
                            delete next[result.id];
                            return next;
                          })
                        );
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card>
          <h2 className="text-lg font-semibold text-white">Keywords and topics</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Every term is searched on each source. A hit is kept only when its text contains the phrase or all of its words. Saved in data/listening/config.json.
          </p>
          <div className="mt-4 space-y-4">
            {groups.map((group) => (
              <div key={group.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{group.name}</p>
                    <Badge tone={INTENT_TONE[group.intent]}>{INTENT_LABELS[group.intent]}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    aria-label={`Remove ${group.name}`}
                    onClick={() => {
                      if (!window.confirm(`Remove the ${group.name} group and its ${group.terms.length} terms?`)) return;
                      void saveGroups(groups.filter((entry) => entry.id !== group.id), "Group removed");
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group.terms.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => removeTerm(group, term)}
                      title="Remove this term"
                      className="rounded-md border border-[var(--border)] bg-white/5 px-2 py-0.5 text-xs text-white transition-colors hover:border-[var(--border-strong)] hover:line-through"
                    >
                      {term}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder="Add a term"
                    value={termDrafts[group.id] ?? ""}
                    onChange={(event) => setTermDrafts((current) => ({ ...current, [group.id]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addTerm(group);
                    }}
                  />
                  <Button variant="secondary" className="h-8" onClick={() => addTerm(group)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Input
              className="h-9 min-w-48 flex-1"
              placeholder="New topic name"
              value={newGroup.name}
              onChange={(event) => setNewGroup((current) => ({ ...current, name: event.target.value }))}
            />
            <Select
              className="h-9 w-40"
              aria-label="Intent"
              value={newGroup.intent}
              onChange={(event) => setNewGroup((current) => ({ ...current, intent: event.target.value as ListeningIntent }))}
            >
              {LISTENING_INTENTS.map((intent) => (
                <option key={intent} value={intent}>
                  {INTENT_LABELS[intent]}
                </option>
              ))}
            </Select>
            <Button variant="secondary" className="h-9" onClick={addGroup} disabled={!newGroup.name.trim()}>
              Add topic
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-white">Sources</h2>
          <div className="mt-3 space-y-3">
            {LISTENING_SOURCES.map((source) => {
              const note = SOURCE_NOTES[source];
              const report = lastScan?.sources.find((entry) => entry.source === source);
              return (
                <div key={source}>
                  <label className={cn("flex items-center justify-between gap-3 text-sm text-white", note && "opacity-60")}>
                    {SOURCE_LABELS[source]}
                    <input
                      type="checkbox"
                      disabled={Boolean(note)}
                      checked={note ? false : (store?.sources[source] ?? true)}
                      onChange={(event) => void setSources({ [source]: event.target.checked })}
                    />
                  </label>
                  {note ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{note}</p> : null}
                  {!note && report && (report.skipped || report.note) ? (
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{report.error ?? report.note}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <label className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4 text-sm text-white">
            Scan every two hours
            <input type="checkbox" checked={store?.autoScan ?? true} onChange={(event) => void setAutoScan(event.target.checked)} />
          </label>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{store ? nextScanLabel(store) : ""}</p>
          <p className="mt-4 text-xs text-[var(--muted-foreground)]">
            Reddit allows only a few unauthenticated requests a minute, so its queries are spaced out and a full scan takes about a minute. YouTube costs 100 quota units per search and shares the
            channel&apos;s daily quota with uploads, so it makes at most two searches per scan and stops at a daily budget. Bluesky search needs no sign-in.
          </p>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            From a terminal: <span className="text-white">npm run listening:scan</span>
          </p>
          <div className={labelClass + " mt-4"}>Last scan</div>
          <p className="mt-1 text-sm text-white">{lastScan ? new Date(lastScan.at).toLocaleString() : "Never"}</p>
          {lastScan?.classified ? (
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Sorted by the model: {lastScan.classified.ai}, by keywords: {lastScan.classified.heuristic}
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
