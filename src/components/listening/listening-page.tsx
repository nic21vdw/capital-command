"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, Ear, Loader2, Plus, Radar, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import {
  LISTENING_INTENTS,
  REPLY_CHECKLIST,
  RESULT_STATUSES,
  SOURCE_LABELS,
  intentOfTerms,
  type KeywordGroup,
  type ListeningIntent,
  type ListeningSource,
  type ListeningStore,
  type ResultStatus,
  type ScanReport
} from "@/lib/listening/model";
import { cn } from "@/lib/utils";

const INTENT_LABELS: Record<ListeningIntent, string> = { pain: "Pain", comparison: "Comparison", pricing: "Pricing" };
const INTENT_TONE: Record<ListeningIntent, BadgeTone> = { pain: "warning", comparison: "info", pricing: "accent" };
const STATUS_LABELS: Record<ResultStatus, string> = { new: "New", replied: "Replied", ignored: "Ignored" };

type StatusFilter = ResultStatus | "all";

const labelClass = "text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]";

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function call(method: "POST" | "PATCH", body: unknown) {
  const response = await fetch("/api/listening", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = (await response.json().catch(() => ({}))) as ListeningStore & { error?: string; report?: ScanReport };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

function scanSummary(report: ScanReport | undefined): string {
  if (!report) return "Never scanned";
  if (report.sources.length === 0) return "No sources switched on";
  return report.sources
    .map((source) =>
      source.ok
        ? `${SOURCE_LABELS[source.source]}: ${source.added} new of ${source.matched}`
        : `${SOURCE_LABELS[source.source]}: failed${source.httpStatus ? ` (HTTP ${source.httpStatus})` : ""}`
    )
    .join(" · ");
}

async function fetchListening(): Promise<ListeningStore> {
  const response = await fetch("/api/listening", { cache: "no-store" });
  const json = (await response.json().catch(() => ({}))) as ListeningStore & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

export function ListeningPage() {
  const [store, setStore] = useState<ListeningStore | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");
  const [sourceFilter, setSourceFilter] = useState<ListeningSource | "all">("all");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [termDrafts, setTermDrafts] = useState<Record<string, string>>({});
  const [newGroup, setNewGroup] = useState<{ name: string; intent: ListeningIntent }>({ name: "", intent: "pain" });

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

  const run = async (action: () => Promise<ListeningStore>, success?: string) => {
    try {
      setStore(await action());
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
      const failed = result.report?.sources.filter((source) => !source.ok) ?? [];
      const added = result.report?.sources.reduce((sum, source) => sum + source.added, 0) ?? 0;
      if (failed.length > 0) {
        toast.error(failed.map((source) => `${SOURCE_LABELS[source.source]}: ${source.error}`).join(" | "));
      } else {
        toast.success(added === 0 ? "Scan finished - nothing new" : `Scan finished - ${added} new`);
      }
    } catch (error) {
      toast.error(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setScanning(false);
    }
  };

  const setResult = (resultId: string, patch: { status?: ResultStatus; note?: string }) =>
    run(() => call("PATCH", { resultId, ...patch }));
  const saveGroups = (groups: KeywordGroup[], success?: string) => run(() => call("PATCH", { groups }), success);
  const setSources = (sources: ListeningStore["sources"]) => run(() => call("PATCH", { sources }));

  const results = useMemo(() => store?.results ?? [], [store]);
  const groups = useMemo(() => store?.groups ?? [], [store]);
  const visible = useMemo(
    () =>
      results.filter(
        (result) => (statusFilter === "all" || result.status === statusFilter) && (sourceFilter === "all" || result.source === sourceFilter)
      ),
    [results, statusFilter, sourceFilter]
  );
  const counts = useMemo(() => {
    const out: Record<ResultStatus, number> = { new: 0, replied: 0, ignored: 0 };
    for (const result of results) out[result.status] += 1;
    return out;
  }, [results]);
  const lastScan = store?.lastScan;
  const failedSources = lastScan?.sources.filter((source) => !source.ok) ?? [];

  const surfaceResults = visible.slice(0, 40);
  useColateralSurface({
    route: "/listening",
    title: "Listening",
    summary:
      "Public Hacker News and Reddit threads matching the keyword groups, to triage and answer by hand. Scan now queries both sources; nothing is ever posted from here.",
    fields: [
      { id: "statusFilter", label: "Show", value: statusFilter, kind: "select", options: ["all", ...RESULT_STATUSES] },
      { id: "sourceFilter", label: "Source", value: sourceFilter, kind: "select", options: ["all", "hn", "reddit"] },
      { id: "sourceHn", label: "Scan Hacker News", value: store?.sources.hn ?? true, kind: "boolean" },
      { id: "sourceReddit", label: "Scan Reddit", value: store?.sources.reddit ?? true, kind: "boolean" },
      ...surfaceResults.map((result) => ({
        id: `status:${result.id}`,
        label: `${result.title.slice(0, 80)} status`,
        value: result.status,
        kind: "select" as const,
        options: [...RESULT_STATUSES]
      }))
    ],
    controls: [{ id: "scan", label: scanning ? "Scanning…" : "Scan now", group: "Scan", disabled: scanning }],
    readings: [
      { label: "Results", value: `${results.length} (${counts.new} new, ${counts.replied} replied, ${counts.ignored} ignored)` },
      { label: "Last scan", value: lastScan ? `${lastScan.at} - ${scanSummary(lastScan)}` : "Never scanned" },
      ...failedSources.map((source) => ({ label: `${SOURCE_LABELS[source.source]} error`, value: source.error ?? "failed" })),
      {
        label: "Keyword groups",
        value: groups.map((group) => `${group.name} (${group.intent}): ${group.terms.join(", ")}`).join(" | ") || "None"
      },
      {
        label: "Listed results",
        value: surfaceResults.map((result) => `[${result.id}] ${result.title} - ${result.url} - ${result.status}`).join("; ") || "None"
      },
      { label: "Reply checklist", value: REPLY_CHECKLIST.join(" ") }
    ],
    setField: (id, value) => {
      if (id === "statusFilter") {
        if (value !== "all" && !RESULT_STATUSES.includes(value as ResultStatus)) return false;
        setStatusFilter(value as StatusFilter);
        return true;
      }
      if (id === "sourceFilter") {
        if (value !== "all" && value !== "hn" && value !== "reddit") return false;
        setSourceFilter(value);
        return true;
      }
      if (id === "sourceHn" || id === "sourceReddit") {
        if (typeof value !== "boolean" || !store) return false;
        void setSources({ ...store.sources, [id === "sourceHn" ? "hn" : "reddit"]: value });
        return true;
      }
      if (id.startsWith("status:")) {
        const resultId = id.slice("status:".length);
        if (!RESULT_STATUSES.includes(value as ResultStatus) || !results.some((result) => result.id === resultId)) return false;
        void setResult(resultId, { status: value as ResultStatus });
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
    if (group.terms.includes(term)) {
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
        description="Hacker News and Reddit threads from the last week where someone describes the problem CoLateral solves. Read them, answer the ones you genuinely can help with, and mark the rest ignored. Nothing is posted from here."
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
        <StatCard label="Waiting for triage" value={String(counts.new)} detail={`${results.length} on the list`} icon={<Ear className="h-5 w-5" />} />
        <StatCard label="Replied" value={String(counts.replied)} detail={`${counts.ignored} ignored`} icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Last scan" value={lastScan ? ago(lastScan.at) || "—" : "Never"} detail={scanSummary(lastScan)} />
        <StatCard
          label="Search terms"
          value={String(groups.reduce((sum, group) => sum + group.terms.length, 0))}
          detail={`${groups.length} keyword groups`}
        />
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
          {(["new", "replied", "ignored", "all"] as StatusFilter[]).map((option) => (
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
            <option value="hn">Hacker News</option>
            <option value="reddit">Reddit</option>
          </Select>
        </div>

        {visible.length === 0 ? (
          <p className="mt-5 text-sm text-[var(--muted-foreground)]">
            {results.length === 0 ? "Nothing yet. Press Scan now, or run npm run listening:scan." : "Nothing matches this filter."}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {visible.map((result) => {
              const intents = intentOfTerms(groups, result.matchedTerms);
              const note = noteDrafts[result.id] ?? result.note;
              return (
                <div
                  key={result.id}
                  className={cn(
                    "rounded-lg border p-3",
                    result.status === "new" ? "border-[var(--border)] bg-[var(--surface-2)]" : "border-[var(--border)] bg-white/[0.02] opacity-80"
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
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {intents.map((intent) => (
                        <Badge key={intent} tone={INTENT_TONE[intent]}>
                          {INTENT_LABELS[intent]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {result.excerpt ? <p className="mt-2 text-sm text-[var(--muted-foreground)]">{result.excerpt}</p> : null}
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">Matched: {result.matchedTerms.join(", ")}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {RESULT_STATUSES.map((status) => (
                      <Button
                        key={status}
                        variant={result.status === status ? (status === "replied" ? "success" : "secondary") : "ghost"}
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
          <h2 className="text-lg font-semibold text-white">Keyword groups</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Every term is searched on each source. A hit is kept only when its text contains the phrase or all of its words.
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
              placeholder="New group name"
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
              Add group
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-white">Sources</h2>
          <div className="mt-3 space-y-3">
            {(["hn", "reddit"] as const).map((source) => (
              <label key={source} className="flex items-center justify-between gap-3 text-sm text-white">
                {SOURCE_LABELS[source]}
                <input
                  type="checkbox"
                  checked={store?.sources[source] ?? true}
                  onChange={(event) => store && void setSources({ ...store.sources, [source]: event.target.checked })}
                />
              </label>
            ))}
          </div>
          <p className="mt-4 text-xs text-[var(--muted-foreground)]">
            Reddit allows only a few unauthenticated requests a minute, so its queries are spaced out and a full scan takes about
            half a minute. If it answers 403 or 429 the scan stops asking and says so above.
          </p>
          <p className="mt-3 text-xs text-[var(--muted-foreground)]">
            From a terminal: <span className="text-white">npm run listening:scan</span>
          </p>
          <div className={labelClass + " mt-4"}>Last scan</div>
          <p className="mt-1 text-sm text-white">{lastScan ? new Date(lastScan.at).toLocaleString() : "Never"}</p>
        </Card>
      </div>
    </div>
  );
}
