"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, ExternalLink, Gauge, Handshake, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Textarea } from "@/components/ui/textarea";
import { useColateralSurface } from "@/lib/colateral/useSurface";
import { todayLocal } from "@/lib/execution/dates";
import {
  OUTREACH_PLATFORMS,
  OUTREACH_STATUSES,
  countByStatus,
  dueForFollowUp,
  paceLabel,
  renderOutreachTemplate,
  weeklyPace,
  type OutreachContact,
  type OutreachPlatform,
  type OutreachStatus,
  type OutreachStore
} from "@/lib/outreach/model";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<OutreachStatus, string> = {
  "to-contact": "To contact",
  contacted: "Contacted",
  replied: "Replied",
  deal: "Deal",
  declined: "Declined",
  "not-a-fit": "Not a fit"
};

const STATUS_TONE: Record<OutreachStatus, BadgeTone> = {
  "to-contact": "neutral",
  contacted: "info",
  replied: "accent",
  deal: "success",
  declined: "danger",
  "not-a-fit": "neutral"
};

const PLATFORM_LABELS: Record<OutreachPlatform, string> = {
  youtube: "YouTube",
  x: "X",
  newsletter: "Newsletter",
  podcast: "Podcast",
  other: "Other"
};

type Filter = OutreachStatus | "all" | "due";

interface Draft {
  id?: string;
  name: string;
  url: string;
  platform: OutreachPlatform;
  approxAudience: string;
  videoTitle: string;
  videoUrl: string;
  fit: string;
  angle: string;
  status: OutreachStatus;
  affiliateCode: string;
  licenceSent: boolean;
  lastContactedAt: string;
  nextFollowUpAt: string;
  notes: string;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  url: "",
  platform: "youtube",
  approxAudience: "",
  videoTitle: "",
  videoUrl: "",
  fit: "",
  angle: "",
  status: "to-contact",
  affiliateCode: "",
  licenceSent: false,
  lastContactedAt: "",
  nextFollowUpAt: "",
  notes: ""
};

function draftFrom(contact: OutreachContact): Draft {
  return {
    id: contact.id,
    name: contact.name,
    url: contact.url,
    platform: contact.platform,
    approxAudience: contact.approxAudience,
    videoTitle: contact.recentVideo?.title ?? "",
    videoUrl: contact.recentVideo?.url ?? "",
    fit: contact.fit,
    angle: contact.angle,
    status: contact.status,
    affiliateCode: contact.affiliateCode ?? "",
    licenceSent: contact.licenceSent,
    lastContactedAt: contact.lastContactedAt ?? "",
    nextFollowUpAt: contact.nextFollowUpAt ?? "",
    notes: contact.notes
  };
}

/** The fields a draft writes. An empty date, code or video is sent as null, which clears it on an edit. */
function payloadFrom(draft: Draft) {
  return {
    name: draft.name.trim(),
    url: draft.url.trim(),
    platform: draft.platform,
    approxAudience: draft.approxAudience.trim(),
    recentVideo: draft.videoTitle.trim() || draft.videoUrl.trim() ? { title: draft.videoTitle.trim(), url: draft.videoUrl.trim() } : null,
    fit: draft.fit.trim(),
    angle: draft.angle.trim(),
    status: draft.status,
    affiliateCode: draft.affiliateCode.trim() || null,
    licenceSent: draft.licenceSent,
    lastContactedAt: draft.lastContactedAt || null,
    nextFollowUpAt: draft.nextFollowUpAt || null,
    notes: draft.notes
  };
}

function copyToClipboard(label: string, text: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error("Could not copy to clipboard"));
}

const labelClass = "text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]";

async function send(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await response.json().catch(() => ({}))) as OutreachStore & {
    error?: string;
    added?: number | boolean;
    updated?: number | boolean;
    skipped?: { index: number; reason: string }[];
  };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

async function fetchOutreach(): Promise<OutreachStore> {
  const response = await fetch("/api/outreach", { cache: "no-store" });
  const json = (await response.json().catch(() => ({}))) as OutreachStore & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

export function OutreachPage() {
  const [store, setStore] = useState<OutreachStore | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(
    () =>
      fetchOutreach().then(
        (json) => {
          setStore(json);
          setLoadError(null);
        },
        (error: unknown) => setLoadError(error instanceof Error ? error.message : String(error))
      ),
    []
  );

  useEffect(() => {
    let live = true;
    fetchOutreach().then(
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

  const today = todayLocal();
  const contacts = useMemo(() => store?.contacts ?? [], [store]);
  const due = useMemo(() => dueForFollowUp(contacts, today), [contacts, today]);
  const pace = useMemo(() => weeklyPace(contacts, today), [contacts, today]);
  const counts = useMemo(() => countByStatus(contacts), [contacts]);
  const visible = useMemo(() => {
    if (filter === "all") return contacts;
    if (filter === "due") return due;
    return contacts.filter((contact) => contact.status === filter);
  }, [contacts, due, filter]);
  const selected = contacts.find((contact) => contact.id === selectedId) ?? visible[0] ?? null;
  const template = templateDraft ?? store?.template ?? "";
  const message = selected ? renderOutreachTemplate(template, selected) : "";

  const run = async (action: () => Promise<OutreachStore>, success?: string) => {
    try {
      setStore(await action());
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const setStatus = (id: string, status: OutreachStatus) => run(() => send("PATCH", "/api/outreach", { id, status }));
  const patchContact = (id: string, patch: Record<string, unknown>) => run(() => send("PATCH", "/api/outreach", { id, patch }));

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.url.trim()) {
      toast.error("A contact needs a name and a url.");
      return;
    }
    setSaving(true);
    const payload = payloadFrom(draft);
    const ok = draft.id
      ? await run(() => send("PATCH", "/api/outreach", { id: draft.id, patch: payload }), "Contact saved")
      : await run(async () => {
          // A new contact has nothing to clear, so the nulls are simply left out.
          const contact = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null));
          const result = await send("POST", "/api/outreach", { contact });
          if (result.updated) toast.message("That url was already on the list, so it was updated instead.");
          return result;
        }, "Contact added");
    setSaving(false);
    if (ok) setDraft(null);
  };

  const removeContact = (contact: OutreachContact) => {
    if (!window.confirm(`Remove ${contact.name} from Outreach?`)) return;
    void run(() => send("DELETE", `/api/outreach?id=${encodeURIComponent(contact.id)}`), "Contact removed");
  };

  const saveTemplate = () => {
    if (templateDraft === null || templateDraft === store?.template) return;
    void run(() => send("PATCH", "/api/outreach", { template: templateDraft }), "Template saved").then(() => setTemplateDraft(null));
  };

  const importJson = async () => {
    let rows: unknown;
    try {
      rows = JSON.parse(importText);
    } catch (error) {
      toast.error(`That is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setImporting(true);
    await run(async () => {
      const result = await send("POST", "/api/outreach/import", rows);
      const skipped = result.skipped ?? [];
      toast.success(`Imported: ${result.added ?? 0} added, ${result.updated ?? 0} updated`);
      if (skipped.length > 0) {
        toast.error(`${skipped.length} row(s) skipped: ${skipped.map((row) => `#${row.index} ${row.reason}`).join(" | ")}`);
      } else {
        setImportText("");
      }
      return result;
    });
    setImporting(false);
  };

  // The agent can read the whole list (as readings) and move any listed
  // contact's status (one select field per contact), plus edit the selected
  // contact's follow-up date, licence and notes.
  const surfaceContacts = visible.slice(0, 60);
  useColateralSurface({
    route: "/outreach",
    title: "Outreach",
    summary:
      "Creator and affiliate tracker: who to offer CoLateral to, where each conversation stands, who is due a follow-up and this week's pace. It never sends anything.",
    fields: [
      { id: "filter", label: "Show", value: filter, kind: "select", options: ["all", "due", ...OUTREACH_STATUSES] },
      {
        id: "selected",
        label: "Selected contact",
        value: selected?.id ?? "",
        kind: "select",
        options: contacts.map((contact) => contact.id)
      },
      { id: "selectedNextFollowUpAt", label: "Selected: next follow-up", value: selected?.nextFollowUpAt ?? "", kind: "date", readOnly: !selected },
      { id: "selectedLicenceSent", label: "Selected: licence sent", value: selected?.licenceSent ?? false, kind: "boolean", readOnly: !selected },
      { id: "selectedNotes", label: "Selected: notes", value: selected?.notes ?? "", kind: "longtext", readOnly: !selected },
      ...surfaceContacts.map((contact) => ({
        id: `status:${contact.id}`,
        label: `${contact.name} status`,
        value: contact.status,
        kind: "select" as const,
        options: [...OUTREACH_STATUSES]
      }))
    ],
    controls: [
      { id: "refresh", label: "Reload the list", group: "List" },
      { id: "newContact", label: "Add a contact", group: "List" },
      { id: "markContacted", label: "Mark selected as contacted", group: "Selected", disabled: !selected },
      { id: "copyMessage", label: "Copy the personalised message", group: "Selected", disabled: !selected }
    ],
    readings: [
      { label: "Contacts", value: String(contacts.length) },
      { label: "By status", value: OUTREACH_STATUSES.map((status) => `${STATUS_LABELS[status]} ${counts[status]}`).join(", ") },
      { label: "Weekly pace", value: paceLabel(pace) },
      {
        label: "Due for follow-up",
        value: due.length === 0 ? "Nobody" : due.map((contact) => `${contact.name} (${contact.nextFollowUpAt})`).join(", ")
      },
      {
        label: "Listed contacts",
        value:
          surfaceContacts.map((contact) => `${contact.name} [${contact.id}] - ${STATUS_LABELS[contact.status]}`).join("; ") || "None"
      },
      { label: "Selected message", value: message || "No contact selected" }
    ],
    setField: (id, value) => {
      if (id === "filter") {
        if (typeof value !== "string" || !(value === "all" || value === "due" || value in STATUS_LABELS)) return false;
        setFilter(value as Filter);
        return true;
      }
      if (id === "selected") {
        if (typeof value !== "string" || !contacts.some((contact) => contact.id === value)) return false;
        setSelectedId(value);
        return true;
      }
      if (id.startsWith("status:")) {
        const contactId = id.slice("status:".length);
        if (typeof value !== "string" || !(value in STATUS_LABELS) || !contacts.some((contact) => contact.id === contactId)) return false;
        void setStatus(contactId, value as OutreachStatus);
        return true;
      }
      if (!selected) return false;
      if (id === "selectedNextFollowUpAt") {
        if (value !== null && (typeof value !== "string" || (value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value)))) return false;
        void patchContact(selected.id, { nextFollowUpAt: value || null });
        return true;
      }
      if (id === "selectedLicenceSent") {
        if (typeof value !== "boolean") return false;
        void patchContact(selected.id, { licenceSent: value });
        return true;
      }
      if (id === "selectedNotes") {
        if (typeof value !== "string") return false;
        void patchContact(selected.id, { notes: value });
        return true;
      }
      return false;
    },
    click: (id) => {
      switch (id) {
        case "refresh":
          void load();
          return true;
        case "newContact":
          setDraft({ ...EMPTY_DRAFT });
          return true;
        case "markContacted":
          if (!selected) return false;
          void setStatus(selected.id, "contacted");
          return true;
        case "copyMessage":
          if (!selected) return false;
          copyToClipboard("Message", message);
          return true;
        default:
          return false;
      }
    }
  });

  if (!store && !loadError) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const field = <K extends keyof Draft>(key: K) => ({
    value: (draft?.[key] ?? "") as string,
    onChange: (event: { target: { value: string } }) => setDraft((current) => (current ? { ...current, [key]: event.target.value } : current))
  });

  return (
    <div>
      <PageHeader
        eyebrow="Studio"
        title="Outreach"
        description="The creators, newsletters and podcasts worth offering CoLateral to, and where each conversation stands. A tracker only: writing to someone stays something you do yourself."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              <Plus className="mr-2 h-4 w-4" />
              Add contact
            </Button>
          </div>
        }
      />

      {loadError ? (
        <Card className="tone-danger tone-edge tone-soft mb-5">
          <p className="text-sm text-white">Could not load the outreach list: {loadError}</p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Contacts" value={String(contacts.length)} detail={`${counts["to-contact"]} still to contact`} icon={<Users className="h-5 w-5" />} />
        <StatCard
          label="Due for follow-up"
          value={String(due.length)}
          detail={due[0] ? `Oldest: ${due[0].name}` : "Nobody waiting"}
          icon={<CalendarClock className="h-5 w-5" />}
          tone={due.length > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="This week's pace"
          value={`${pace.contacted}`}
          detail={`Contacted in the last 7 days · target ${pace.min}-${pace.max}`}
          icon={<Gauge className="h-5 w-5" />}
          tone={pace.state === "behind" ? "warning" : pace.state === "over" ? "info" : "success"}
        />
        <StatCard label="Deals" value={String(counts.deal)} detail={`${counts.replied} replied · ${counts.contacted} waiting`} icon={<Handshake className="h-5 w-5" />} />
      </div>

      {draft ? (
        <Card className="mt-5">
          <h2 className="text-lg font-semibold text-white">{draft.id ? `Edit ${draft.name || "contact"}` : "Add a contact"}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className={labelClass}>Name (channel)</span>
              <Input className="mt-1.5" placeholder="Agent Dev Weekly" {...field("name")} />
            </label>
            <label className="block">
              <span className={labelClass}>URL</span>
              <Input className="mt-1.5" placeholder="https://www.youtube.com/@channel" {...field("url")} />
            </label>
            <label className="block">
              <span className={labelClass}>Platform</span>
              <Select className="mt-1.5" {...field("platform")}>
                {OUTREACH_PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {PLATFORM_LABELS[platform]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className={labelClass}>Approx. audience</span>
              <Input className="mt-1.5" placeholder="40k subscribers" {...field("approxAudience")} />
            </label>
            <label className="block">
              <span className={labelClass}>Recent video title</span>
              <Input className="mt-1.5" placeholder="I ran five coding agents at once" {...field("videoTitle")} />
            </label>
            <label className="block">
              <span className={labelClass}>Recent video URL</span>
              <Input className="mt-1.5" {...field("videoUrl")} />
            </label>
            <label className="block">
              <span className={labelClass}>Status</span>
              <Select className="mt-1.5" {...field("status")}>
                {OUTREACH_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className={labelClass}>Last contacted</span>
              <Input className="mt-1.5" type="date" {...field("lastContactedAt")} />
            </label>
            <label className="block">
              <span className={labelClass}>Next follow-up</span>
              <Input className="mt-1.5" type="date" {...field("nextFollowUpAt")} />
            </label>
            <label className="block">
              <span className={labelClass}>Affiliate code</span>
              <Input className="mt-1.5" {...field("affiliateCode")} />
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm text-white">
              <input
                type="checkbox"
                checked={draft.licenceSent}
                onChange={(event) => setDraft((current) => (current ? { ...current, licenceSent: event.target.checked } : current))}
              />
              Licence sent
            </label>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <label className="block">
              <span className={labelClass}>Why they fit</span>
              <Textarea className="mt-1.5 min-h-20" placeholder="Runs Claude Code and Codex on camera every week" {...field("fit")} />
            </label>
            <label className="block">
              <span className={labelClass}>Angle</span>
              <Textarea className="mt-1.5 min-h-20" placeholder="Their terminal-juggling video is the exact problem" {...field("angle")} />
            </label>
            <label className="block">
              <span className={labelClass}>Notes</span>
              <Textarea className="mt-1.5 min-h-20" {...field("notes")} />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void saveDraft()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {draft.id ? "Save contact" : "Add contact"}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "due", ...OUTREACH_STATUSES] as Filter[]).map((option) => {
            const count = option === "all" ? contacts.length : option === "due" ? due.length : counts[option];
            const label = option === "all" ? "All" : option === "due" ? "Due" : STATUS_LABELS[option];
            return (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  filter === option
                    ? "border-[var(--accent)] bg-white/10 text-white"
                    : "border-[var(--border)] bg-white/5 text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {label} <span className="text-[var(--muted-foreground)]">{count}</span>
              </button>
            );
          })}
        </div>

        {visible.length === 0 ? (
          <p className="mt-5 text-sm text-[var(--muted-foreground)]">
            {contacts.length === 0
              ? "No contacts yet. Add one, paste a JSON list below, or run npm run outreach:import -- <file>."
              : "Nobody matches this filter."}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Contact</th>
                  <th className="py-2 pr-3 font-medium">Audience</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Last contact</th>
                  <th className="py-2 pr-3 font-medium">Follow-up</th>
                  <th className="py-2 pr-3 font-medium">Licence</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((contact) => {
                  const isDue = due.some((entry) => entry.id === contact.id);
                  return (
                    <tr
                      key={contact.id}
                      onClick={() => setSelectedId(contact.id)}
                      className={cn(
                        "cursor-pointer border-t border-[var(--border)] align-top",
                        selected?.id === contact.id ? "bg-white/5" : "hover:bg-white/[0.03]"
                      )}
                    >
                      <td className="py-2.5 pr-3">
                        <a
                          href={contact.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1 font-medium text-white hover:underline"
                        >
                          {contact.name}
                          <ExternalLink className="h-3 w-3 text-[var(--muted-foreground)]" />
                        </a>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {PLATFORM_LABELS[contact.platform]}
                          {contact.fit ? ` · ${contact.fit}` : ""}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3 text-[var(--muted-foreground)]">{contact.approxAudience || "—"}</td>
                      <td className="py-2.5 pr-3" onClick={(event) => event.stopPropagation()}>
                        <Select
                          className="h-9 w-36"
                          aria-label={`${contact.name} status`}
                          value={contact.status}
                          onChange={(event) => void setStatus(contact.id, event.target.value as OutreachStatus)}
                        >
                          {OUTREACH_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {STATUS_LABELS[status]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-2.5 pr-3 text-[var(--muted-foreground)]">{contact.lastContactedAt ?? "—"}</td>
                      <td className="py-2.5 pr-3">
                        {contact.nextFollowUpAt ? (
                          <span className={isDue ? "tone-warning tone-text" : "text-[var(--muted-foreground)]"}>{contact.nextFollowUpAt}</span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {contact.licenceSent ? <Badge tone="success">Sent</Badge> : <span className="text-[var(--muted-foreground)]">—</span>}
                        {contact.affiliateCode ? <p className="mt-1 text-xs text-[var(--muted-foreground)]">{contact.affiliateCode}</p> : null}
                      </td>
                      <td className="py-2.5" onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" aria-label={`Edit ${contact.name}`} onClick={() => setDraft(draftFrom(contact))}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" aria-label={`Remove ${contact.name}`} onClick={() => removeContact(contact)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Outreach message</h2>
            {selected ? <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABELS[selected.status]}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {"{name}"} and {"{video}"} are filled in from the selected contact. Edit the template below; it saves when you click away.
          </p>
          {selected ? (
            <>
              <div className="mt-4 flex items-baseline justify-between gap-3">
                <p className={labelClass}>For {selected.name}</p>
                <button
                  type="button"
                  onClick={() => copyToClipboard("Message", message)}
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-white"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm text-white">{message}</p>
              {selected.angle ? <p className="mt-2 text-xs text-[var(--muted-foreground)]">Your angle: {selected.angle}</p> : null}
              {selected.status === "to-contact" ? (
                <Button className="mt-3" variant="secondary" onClick={() => void setStatus(selected.id, "contacted")}>
                  I sent it - mark contacted
                </Button>
              ) : null}
            </>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">Select a contact to personalise the message.</p>
          )}
          <label className="mt-5 block">
            <span className={labelClass}>Template</span>
            <Textarea
              className="mt-1.5 min-h-56 font-mono text-xs"
              value={template}
              onChange={(event) => setTemplateDraft(event.target.value)}
              onBlur={saveTemplate}
            />
          </label>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-white">Import contacts</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Paste a JSON array of contacts. Each needs a name and a url; a url already on the list is updated with only the fields
            you supply, so statuses and notes are never wiped. From a terminal:{" "}
            <span className="text-white">npm run outreach:import -- contacts.json</span>
          </p>
          <Textarea
            className="mt-4 min-h-56 font-mono text-xs"
            placeholder={'[\n  { "name": "Agent Dev Weekly", "url": "https://www.youtube.com/@agentdev", "platform": "youtube",\n    "approxAudience": "40k", "recentVideo": { "title": "Five agents at once", "url": "https://..." },\n    "fit": "Runs Claude Code daily", "angle": "Terminal juggling" }\n]'}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
          <Button className="mt-3" onClick={() => void importJson()} disabled={importing || !importText.trim()}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Import
          </Button>
        </Card>
      </div>
    </div>
  );
}
