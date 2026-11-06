"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldInput, type ConnectionState } from "@/components/layout/connections-settings";
import { SERVICES, serviceReady, type SetupService } from "@/lib/setup/services";

export function ServicesSettings() {
  const [state, setState] = useState<ConnectionState>({ present: {}, connected: {} });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      setState((await response.json()) as ConnectionState);
    } catch {
      toast.error("Could not check which services are set up.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requested = new URLSearchParams(window.location.search).get("service");
      if (!requested || !SERVICES.some((service) => service.id === requested)) return;
      setExpanded(requested);
      window.history.replaceState({}, "", `${window.location.pathname}#services`);
      window.setTimeout(() => document.getElementById(`service-row-${requested}`)?.scrollIntoView({ block: "start" }), 1500);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const save = async (service: SetupService) => {
    const values: Record<string, string> = {};
    for (const field of service.fields) {
      if (field.name in drafts) values[field.name] = drafts[field.name];
    }
    if (!Object.keys(values).length) return;
    setSaving(service.id);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      const body = (await response.json()) as ConnectionState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? String(response.status));
      setState(body);
      setDrafts((current) => {
        const next = { ...current };
        for (const field of service.fields) delete next[field.name];
        return next;
      });
      toast.success(`${service.label} saved. It is used straight away.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card id="services" className="scroll-mt-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">AI and services</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Optional keys for the tools that run on a paid service. Each one is only needed by the screen named next to it. Keys stay on this machine and are never displayed again.
          </p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
        {SERVICES.map((service) => {
          const open = expanded === service.id;
          const ready = serviceReady(service, state.present);
          const optionalOnly = service.fields.every((field) => field.optional);
          const anySet = service.fields.some((field) => state.present[field.name]);
          const status = !loaded ? "Checking" : optionalOnly ? (anySet ? "Key saved" : "Works without a key") : ready ? "Set up" : "Not set up";
          const good = loaded && (optionalOnly || ready);
          const dirty = service.fields.some((field) => field.name in drafts);
          return (
            <div key={service.id} id={`service-row-${service.id}`} className="scroll-mt-6 border-b border-[var(--border)] last:border-b-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`service-${service.id}`}
                onClick={() => setExpanded(open ? null : service.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{service.label}</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">{service.purpose}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${good ? "bg-emerald-400/10 text-emerald-200" : "bg-white/5 text-[var(--muted-foreground)]"}`}>
                  {status}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {open ? (
                <div id={`service-${service.id}`} className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {service.fields.map((field) => (
                      <FieldInput key={field.name} field={field} state={state} drafts={drafts} setDrafts={setDrafts} />
                    ))}
                  </div>
                  {service.notes?.map((note) => (
                    <p key={note} className="mt-2 text-xs text-[var(--muted-foreground)]">{note}</p>
                  ))}
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button onClick={() => void save(service)} disabled={!dirty || saving === service.id}>
                      {saving === service.id ? "Saving..." : "Save"}
                    </Button>
                    {service.console ? (
                      <a href={service.console} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-2 text-xs text-[var(--accent)] hover:underline max-sm:min-h-10">
                        Get a key <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
