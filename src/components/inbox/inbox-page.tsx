"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCheck, CheckCircle2, ExternalLink, Inbox as InboxIcon, Loader2, MessageSquareReply, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { setInboxUnread } from "@/components/inbox/unread";
import { filterItems, groupByPost, surfaceLine, timeAgo, type PlatformFilter, type StatusFilter } from "@/components/inbox/view";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Textarea } from "@/components/ui/textarea";
import {
  INBOX_PLATFORMS,
  INBOX_PLATFORM_LABEL,
  type InboxItem,
  type InboxPlatform,
  type InboxStatus,
  type PlatformSyncState
} from "@/lib/inbox/types";
import { REPLY_LIMITS } from "@/lib/inbox/limits";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { RECONNECT_URL } from "@/lib/platform-health/types";
import { cn } from "@/lib/utils";

type InboxResponse = {
  items: InboxItem[];
  counts: Record<InboxStatus, number>;
  unread: number;
  unreadByPlatform: Record<InboxPlatform, number>;
  platforms: Record<string, PlatformSyncState>;
  lastSyncAt: string | null;
};

const STATUS_TONE: Record<InboxStatus, BadgeTone> = { new: "accent", seen: "neutral", replied: "success", done: "neutral" };
const STATUS_LABEL: Record<InboxStatus, string> = { new: "New", seen: "Seen", replied: "Replied", done: "Done" };
const STATUS_FILTERS: StatusFilter[] = ["open", "new", "seen", "replied", "done", "all"];
const SURFACE_LIST = 25;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function InboxPage() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<{ refresh: boolean; drafting: string | null; sending: string | null }>({
    refresh: false,
    drafting: null,
    sending: null
  });

  const load = useCallback(async () => {
    try {
      const next = await api<InboxResponse>("/api/inbox?limit=2000");
      setData(next);
      setInboxUnread(next.unread);
      setLoadError(null);
    } catch (error) {
      setLoadError(messageOf(error));
    }
  }, []);

  useEffect(() => {
    let live = true;
    api<InboxResponse>("/api/inbox?limit=2000").then(
      (next) => {
        if (!live) return;
        setData(next);
        setInboxUnread(next.unread);
      },
      (error: unknown) => {
        if (live) setLoadError(messageOf(error));
      }
    );
    return () => {
      live = false;
    };
  }, []);

  const items = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => filterItems(items, { platform: platformFilter, status: statusFilter }), [items, platformFilter, statusFilter]);
  const groups = useMemo(() => groupByPost(visible), [visible]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible.find((item) => item.status === "new") ?? null;
  const draftFor = (id: string) => drafts[id] ?? "";

  const refresh = async () => {
    setBusy((current) => ({ ...current, refresh: true }));
    try {
      const report = await api<{ added: number }>("/api/inbox", { method: "POST", body: JSON.stringify({ action: "sync" }) });
      await load();
      toast.success(report.added === 0 ? "Checked every platform - nothing new" : `${report.added} new in the inbox`);
    } catch (error) {
      toast.error(`Refresh failed: ${messageOf(error)}`);
    } finally {
      setBusy((current) => ({ ...current, refresh: false }));
    }
  };

  const setStatus = async (item: InboxItem, status: InboxStatus) => {
    try {
      await api("/api/inbox", { method: "PATCH", body: JSON.stringify({ id: item.id, status }) });
      await load();
    } catch (error) {
      toast.error(messageOf(error));
    }
  };

  const markAllSeen = async () => {
    try {
      await api("/api/inbox", {
        method: "POST",
        body: JSON.stringify({ action: "markAllSeen", ...(platformFilter === "all" ? {} : { platform: platformFilter }) })
      });
      await load();
      toast.success(platformFilter === "all" ? "Everything marked seen" : `${INBOX_PLATFORM_LABEL[platformFilter]} marked seen`);
    } catch (error) {
      toast.error(messageOf(error));
    }
  };

  const draft = async (item: InboxItem) => {
    setSelectedId(item.id);
    setBusy((current) => ({ ...current, drafting: item.id }));
    try {
      const result = await api<{ draft: string }>("/api/inbox/draft", { method: "POST", body: JSON.stringify({ id: item.id }) });
      setDrafts((current) => ({ ...current, [item.id]: result.draft }));
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      setBusy((current) => ({ ...current, drafting: null }));
    }
  };

  const send = async (item: InboxItem) => {
    const text = draftFor(item.id).trim();
    if (!text) return false;
    setBusy((current) => ({ ...current, sending: item.id }));
    try {
      await api("/api/inbox/send", { method: "POST", body: JSON.stringify({ id: item.id, text, confirm: true }) });
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load();
      toast.success(`Reply sent on ${INBOX_PLATFORM_LABEL[item.platform]}`);
      return true;
    } catch (error) {
      toast.error(messageOf(error));
      return false;
    } finally {
      setBusy((current) => ({ ...current, sending: null }));
    }
  };

  const needsAttention = INBOX_PLATFORMS.filter((platform) => data?.platforms[platform]?.needs);
  const unreadItems = items.filter((item) => item.status === "new");
  const canSend = Boolean(selected && selected.status !== "replied" && draftFor(selected.id).trim() && busy.sending === null);

  useColateralSurface({
    route: "/inbox",
    title: "Inbox",
    summary:
      "Comments and replies on published YouTube, Instagram, Facebook and Threads posts. Draft a reply in the house voice, edit it, and send it on an explicit click. Nothing is ever sent automatically.",
    fields: [
      { id: "platformFilter", label: "Platform", value: platformFilter, kind: "select", options: ["all", ...INBOX_PLATFORMS] },
      { id: "statusFilter", label: "Show", value: statusFilter, kind: "select", options: STATUS_FILTERS },
      {
        id: "selected",
        label: "Selected comment",
        value: selected?.id ?? null,
        kind: "select",
        options: visible.slice(0, SURFACE_LIST).map((item) => item.id)
      },
      {
        id: "draft",
        label: "Reply draft for the selected comment",
        value: selected ? draftFor(selected.id) : "",
        kind: "longtext",
        readOnly: !selected || selected.status === "replied",
        hint: "Press Draft reply to have one written, or type your own. Send reply posts it."
      }
    ],
    controls: [
      { id: "refresh", label: busy.refresh ? "Refreshing…" : "Refresh", group: "Inbox", disabled: busy.refresh },
      { id: "markAllSeen", label: "Mark all seen", group: "Inbox", disabled: unreadItems.length === 0 },
      {
        id: "draftReply",
        label: busy.drafting ? "Drafting…" : "Draft reply",
        group: "Reply",
        disabled: !selected || selected.status === "replied" || busy.drafting !== null
      },
      { id: "markDone", label: "Mark done", group: "Reply", disabled: !selected || selected.status === "done" },
      {
        id: "send",
        label: "Send reply",
        group: "Reply",
        destructive: true,
        disabled: !canSend,
        hint: "Posts the draft publicly from Nic's account."
      }
    ],
    readings: [
      { label: "Unread", value: String(data?.unread ?? 0) },
      {
        label: "Unread by platform",
        value: INBOX_PLATFORMS.map((platform) => `${INBOX_PLATFORM_LABEL[platform]} ${data?.unreadByPlatform[platform] ?? 0}`).join(", ")
      },
      { label: "Last sync", value: data?.lastSyncAt ?? "Never" },
      ...needsAttention.map((platform) => ({
        label: `${INBOX_PLATFORM_LABEL[platform]} connection`,
        value: data?.platforms[platform]?.message ?? "Needs reconnecting"
      })),
      { label: "Unread comments", value: unreadItems.slice(0, SURFACE_LIST).map(surfaceLine).join(" | ") || "None" }
    ],
    setField: (id, value) => {
      if (id === "platformFilter") {
        if (value !== "all" && !INBOX_PLATFORMS.includes(value as InboxPlatform)) return false;
        setPlatformFilter(value as PlatformFilter);
        return true;
      }
      if (id === "statusFilter") {
        if (!STATUS_FILTERS.includes(value as StatusFilter)) return false;
        setStatusFilter(value as StatusFilter);
        return true;
      }
      if (id === "selected") {
        if (typeof value !== "string" || !items.some((item) => item.id === value)) return false;
        setSelectedId(value);
        return true;
      }
      if (id === "draft") {
        if (!selected || selected.status === "replied" || typeof value !== "string") return false;
        setDrafts((current) => ({ ...current, [selected.id]: value }));
        return true;
      }
      return false;
    },
    click: (id) => {
      if (id === "refresh") {
        if (busy.refresh) return false;
        void refresh();
        return true;
      }
      if (id === "markAllSeen") {
        void markAllSeen();
        return true;
      }
      if (!selected) return false;
      if (id === "draftReply") {
        if (selected.status === "replied" || busy.drafting !== null) return false;
        void draft(selected);
        return true;
      }
      if (id === "markDone") {
        void setStatus(selected, "done");
        return true;
      }
      if (id === "send") {
        if (!canSend) return false;
        void send(selected);
        return true;
      }
      return false;
    }
  });

  if (!data && !loadError) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Studio"
        title="Inbox"
        description="Comments and replies on your published posts, from YouTube, Instagram, Facebook and Threads in one place. Draft a reply in your voice, edit it, and send it yourself. Nothing is sent until you press Send."
        actions={
          <Button onClick={() => void refresh()} disabled={busy.refresh}>
            {busy.refresh ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {busy.refresh ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {loadError ? (
        <Card className="tone-danger tone-edge tone-soft mb-5">
          <p className="text-sm text-white">Could not load the inbox: {loadError}</p>
        </Card>
      ) : null}

      {needsAttention.map((platform) => (
        <Card key={platform} className="tone-warning tone-edge tone-soft mb-5">
          <div className="flex flex-wrap items-center gap-3">
            <TriangleAlert className="tone-text h-5 w-5 shrink-0" />
            <p className="text-sm font-medium text-white">{data?.platforms[platform]?.message ?? `Reconnect ${INBOX_PLATFORM_LABEL[platform]}`}</p>
            <Link href={RECONNECT_URL} className="text-sm text-[var(--accent)] hover:underline">
              Open Settings
            </Link>
          </div>
        </Card>
      ))}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Unread" value={String(data?.unread ?? 0)} detail={`${data?.counts.seen ?? 0} seen, waiting for a reply`} icon={<InboxIcon className="h-5 w-5" />} />
        <StatCard label="Replied" value={String(data?.counts.replied ?? 0)} detail={`${data?.counts.done ?? 0} marked done`} icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard
          label="Last sync"
          value={data?.lastSyncAt ? timeAgo(data.lastSyncAt) || "—" : "Never"}
          detail="Checks every 30 minutes while the app runs"
        />
        <StatCard
          label="By platform"
          value={String(data?.unread ?? 0)}
          detail={INBOX_PLATFORMS.map((platform) => `${INBOX_PLATFORM_LABEL[platform]} ${data?.unreadByPlatform[platform] ?? 0}`).join(" · ")}
        />
      </div>

      <Card className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((option) => (
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
              {option === "open" ? "Open" : option === "all" ? "All" : STATUS_LABEL[option]}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              className="h-9 w-44"
              aria-label="Platform"
              value={platformFilter}
              onChange={(event) => setPlatformFilter(event.target.value as PlatformFilter)}
            >
              <option value="all">All platforms</option>
              {INBOX_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {INBOX_PLATFORM_LABEL[platform]}
                </option>
              ))}
            </Select>
            <Button variant="secondary" className="h-9" onClick={() => void markAllSeen()} disabled={unreadItems.length === 0}>
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all seen
            </Button>
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="mt-5 text-sm text-[var(--muted-foreground)]">
            {items.length === 0
              ? "Nothing yet. Press Refresh, or run npm run inbox:sync. Comments appear here after a post has gone live."
              : "Nothing matches this filter."}
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {groups.map((group) => (
              <section key={group.key}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="info">{INBOX_PLATFORM_LABEL[group.platform]}</Badge>
                  {group.url ? (
                    <a href={group.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-white hover:underline">
                      {group.title}
                      <ExternalLink className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-white">{group.title}</span>
                  )}
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {group.items.length} {group.items.length === 1 ? "comment" : "comments"}
                    {group.unread > 0 ? `, ${group.unread} unread` : ""}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {group.items.map((item) => {
                    const active = selected?.id === item.id;
                    const text = draftFor(item.id);
                    const limit = REPLY_LIMITS[item.platform];
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          "rounded-lg border p-3",
                          active ? "border-[var(--accent)]" : "border-[var(--border)]",
                          item.status === "new" ? "bg-[var(--surface-2)]" : "bg-white/[0.02] opacity-90"
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                          <span className="font-medium text-white">{item.authorName}</span>
                          <span>{timeAgo(item.at)}</span>
                          {item.kind !== "comment" ? <span>{item.kind}</span> : null}
                          <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                          {item.permalink ? (
                            <a
                              href={item.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto inline-flex items-center gap-1 hover:text-white"
                              onClick={(event) => event.stopPropagation()}
                            >
                              Open <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-white">{item.text}</p>

                        {item.reply ? (
                          <p className="mt-2 rounded-md border border-[var(--border)] bg-white/[0.03] p-2 text-sm text-[var(--muted-foreground)]">
                            <span className="font-medium text-white">You replied</span> {timeAgo(item.reply.sentAt)}: {item.reply.text}
                          </p>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {active || text ? (
                              <>
                                <Textarea
                                  className="min-h-20"
                                  aria-label={`Reply to ${item.authorName}`}
                                  placeholder="Press Draft reply, or write your own"
                                  value={text}
                                  onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                                />
                                <p className={cn("text-xs", text.length > limit ? "text-red-300" : "text-[var(--muted-foreground)]")}>
                                  {text.length} of {limit}
                                </p>
                              </>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                variant="secondary"
                                className="h-8 px-3 text-xs"
                                disabled={busy.drafting !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void draft(item);
                                }}
                              >
                                {busy.drafting === item.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MessageSquareReply className="mr-1.5 h-3.5 w-3.5" />}
                                Draft reply
                              </Button>
                              <Button
                                className="h-8 px-3 text-xs"
                                disabled={!text.trim() || text.length > limit || busy.sending !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void send(item);
                                }}
                              >
                                {busy.sending === item.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                                Send reply
                              </Button>
                              {item.status === "new" ? (
                                <Button
                                  variant="ghost"
                                  className="h-8 px-3 text-xs"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void setStatus(item, "seen");
                                  }}
                                >
                                  Mark seen
                                </Button>
                              ) : null}
                              {item.status !== "done" ? (
                                <Button
                                  variant="ghost"
                                  className="h-8 px-3 text-xs"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void setStatus(item, "done");
                                  }}
                                >
                                  Mark done
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  className="h-8 px-3 text-xs"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void setStatus(item, "seen");
                                  }}
                                >
                                  Reopen
                                </Button>
                              )}
                            </div>
                          </div>
                        )}
                        {item.reply && item.status !== "done" ? (
                          <div className="mt-2">
                            <Button
                              variant="ghost"
                              className="h-8 px-3 text-xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                void setStatus(item, "done");
                              }}
                            >
                              Mark done
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
