"use client";

import { useCallback, useEffect, useState } from "react";
import { AtSign, ChevronDown, ExternalLink, Music2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PlatformIcon, type PlatformIconKey } from "@/components/ui/platform-icon";
import { CONNECTIONS, type Connection } from "@/lib/publisher/connections";

type ConnectionState = {
  present: Record<string, boolean>;
  connected: Record<string, boolean>;
};

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "text-[#ff6262] bg-[#ff0000]/15",
  tiktok: "text-[#4ce2de] bg-[#25f4ee]/15",
  spotify: "text-[#75dc91] bg-[#1db954]/15",
  instagram: "text-[#f58fbd] bg-[#e1306c]/15",
  facebook: "text-[#7fb4ff] bg-[#1877f2]/15",
  threads: "text-white bg-white/10"
};

function ConnectionIcon({ id }: { id: string }) {
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${PLATFORM_COLORS[id]}`}>
      {id === "spotify" ? <Music2 className="h-5 w-5" aria-hidden="true" /> :
        id === "threads" ? <AtSign className="h-5 w-5" aria-hidden="true" /> :
          <PlatformIcon platform={id as PlatformIconKey} className="h-5 w-5" />}
    </span>
  );
}

function requiredFields(connection: Connection) {
  return connection.fields.filter((field) => !field.optional);
}

export function ConnectionsSettings() {
  const [state, setState] = useState<ConnectionState>({ present: {}, connected: {} });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections");
      if (!response.ok) throw new Error(String(response.status));
      setState((await response.json()) as ConnectionState);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      toast.error("Could not check account setup.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async (connection: Connection) => {
    const values: Record<string, string> = {};
    for (const field of connection.fields) {
      if (field.name in drafts) values[field.name] = drafts[field.name];
    }
    if (!Object.keys(values).length) return;

    setSaving(connection.id);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      const body = (await response.json()) as ConnectionState & { error?: string };
      if (!response.ok) throw new Error(body.error ?? String(response.status));
      setState({ present: body.present, connected: body.connected });
      setDrafts((current) => {
        const next = { ...current };
        for (const field of connection.fields) delete next[field.name];
        return next;
      });
      toast.success(connection.oauth && !state.connected[connection.id] ? "Credentials saved. Sign in to finish connecting." : "Credentials saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save credentials.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card id="accounts" className="scroll-mt-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
          <AtSign className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">Accounts</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Choose a platform to connect or update. Credentials stay on this machine and are never displayed again.
          </p>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-[var(--border)]">
        {CONNECTIONS.map((connection) => {
          const ready = requiredFields(connection).every((field) => state.present[field.name]);
          const hasSome = connection.fields.some((field) => state.present[field.name]);
          const connected = ready && state.connected[connection.id];
          const open = expanded === connection.id;
          const dirty = connection.fields.some((field) => field.name in drafts);
          const status = !loaded ? "Checking" : loadFailed ? "Unavailable" : connected ? "Connected" :
            ready ? connection.oauth ? "Sign in needed" : "Credentials saved" : hasSome ? "Finish setup" : "Not set up";

          return (
            <div key={connection.id} className="border-b border-[var(--border)] last:border-b-0">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`connection-${connection.id}`}
                onClick={() => setExpanded(open ? null : connection.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
              >
                <ConnectionIcon id={connection.id} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{connection.label}</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">{connection.purpose}</span>
                  <span className="mt-1 block text-xs text-[var(--accent)] sm:hidden">{status}</span>
                </span>
                <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${connected || (ready && !connection.oauth) ? "bg-emerald-400/10 text-emerald-200" : "bg-white/5 text-[var(--muted-foreground)]"}`}>
                  {status}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>

              {open ? (
                <div id={`connection-${connection.id}`} className="border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-5 sm:pl-[4.5rem]">
                  <p className="mb-4 text-sm text-[var(--muted-foreground)]">
                    {connected ? "Account signed in. Update credentials here only if they change." :
                      ready && connection.oauth ? "Credentials are saved. Sign in to finish connecting this account." :
                        connection.oauth ? "Add your app credentials, save them, then sign in." :
                          "Add the credentials for this account and save them."}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {requiredFields(connection).map((field) => (
                      <label key={field.name} className="block text-xs text-[var(--muted-foreground)]">
                        <span className="mb-1 block font-medium text-white/90">{field.label}</span>
                        <Input
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={drafts[field.name] ?? ""}
                          placeholder={state.present[field.name] ? "Saved" : "Enter value"}
                          onChange={(event) => setDrafts((current) => ({ ...current, [field.name]: event.target.value }))}
                        />
                        {field.hint ? <span className="mt-1 block">{field.hint}</span> : null}
                        {state.present[field.name] ? (
                          <button type="button" className="mt-1 text-[var(--accent)] hover:underline" onClick={() => setDrafts((current) => ({ ...current, [field.name]: "" }))}>
                            {field.name in drafts && !drafts[field.name] ? "Will remove when saved" : "Remove saved value"}
                          </button>
                        ) : null}
                      </label>
                    ))}
                  </div>
                  {connection.fields.some((field) => field.optional) ? (
                    <details className="mt-4 text-sm text-[var(--muted-foreground)]">
                      <summary className="cursor-pointer text-white/90">Optional fields</summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {connection.fields.filter((field) => field.optional).map((field) => (
                          <label key={field.name} className="block text-xs">
                            <span className="mb-1 block font-medium text-white/90">{field.label}</span>
                            <Input type="password" autoComplete="off" value={drafts[field.name] ?? ""} placeholder={state.present[field.name] ? "Saved" : "Enter value"} onChange={(event) => setDrafts((current) => ({ ...current, [field.name]: event.target.value }))} />
                            <span className="mt-1 block">{field.hint}</span>
                            {state.present[field.name] ? (
                              <button type="button" className="mt-1 text-[var(--accent)] hover:underline" onClick={() => setDrafts((current) => ({ ...current, [field.name]: "" }))}>
                                {field.name in drafts && !drafts[field.name] ? "Will remove when saved" : "Remove saved value"}
                              </button>
                            ) : null}
                          </label>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {connection.manualNote ? <p className="mt-4 text-xs text-amber-200/90">{connection.manualNote}</p> : null}
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button onClick={() => void save(connection)} disabled={!dirty || saving === connection.id}>
                      {saving === connection.id ? "Saving..." : "Save credentials"}
                    </Button>
                    {connection.oauth && ready ? (
                      <a href={connection.oauth.href} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10">
                        {connected ? "Reconnect" : connection.oauth.label}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                    {connection.console ? (
                      <a href={connection.console} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-2 text-xs text-[var(--accent)] hover:underline">
                        Find credentials <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
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
