"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CONNECTIONS } from "@/lib/publisher/connections";

/**
 * Connecting an account, in the app.
 *
 * Every platform key used to live in `.env` only, so a new install's first
 * task was to open a file in an editor and restart the server before any of
 * the sign-in buttons did anything. This is the same values, entered here.
 *
 * A field shows whether it is SET, never what it is: the server answers with
 * presence booleans and nothing else, so an entered secret cannot come back
 * out through this screen. Typing over a set field replaces it; clearing a set
 * field and saving disconnects it.
 */
export function ConnectionsSettings() {
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections");
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { present?: Record<string, boolean> };
      setPresent(body.present ?? {});
    } catch {
      toast.error("Could not read which accounts are connected.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Deferred by a tick for the same reason the app provider defers its first
    // refresh: the fetch resolves into setState, and starting it inside the
    // effect body is a synchronous state write on mount.
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const save = async (connectionId: string, names: string[]) => {
    const values: Record<string, string> = {};
    for (const name of names) {
      if (name in drafts) values[name] = drafts[name];
    }
    if (!Object.keys(values).length) {
      toast.message("Nothing changed.");
      return;
    }

    setSaving(connectionId);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values })
      });
      const body = (await response.json()) as { present?: Record<string, boolean>; error?: string };
      if (!response.ok) throw new Error(body.error ?? String(response.status));
      setPresent(body.present ?? {});
      setDrafts((current) => {
        const next = { ...current };
        for (const name of names) delete next[name];
        return next;
      });
      toast.success("Saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold text-white">Connected accounts</h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Where this app is allowed to post. Nothing is posted to an account that is not connected here, and what you
        enter stays on this machine — it is written beside your data and is never shown back to you.
      </p>

      <div className="mt-5 space-y-5">
        {CONNECTIONS.map((connection) => {
          const ready = connection.fields.every((field) => present[field.name]);
          const oauthReady =
            connection.oauth &&
            connection.fields
              .filter((field) => !field.hint?.startsWith("Optional"))
              .every((field) => present[field.name]);

          return (
            <div
              key={connection.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">{connection.label}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">{connection.purpose}</p>
                </div>
                <Badge className={ready ? "text-emerald-300" : "text-amber-200"}>
                  {loaded ? (ready ? "Connected" : "Not connected") : "Checking"}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {connection.fields.map((field) => (
                  <label key={field.name} className="block text-xs text-[var(--muted-foreground)]">
                    <span className="mb-1 block text-white/90">{field.label}</span>
                    <Input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={drafts[field.name] ?? ""}
                      placeholder={present[field.name] ? "Set — type to replace" : "Not set"}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                    />
                    {field.hint ? <span className="mt-1 block">{field.hint}</span> : null}
                  </label>
                ))}
              </div>

              {connection.manualNote ? (
                <p className="mt-3 text-xs text-amber-300/90">{connection.manualNote}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => void save(connection.id, connection.fields.map((field) => field.name))}
                  disabled={saving === connection.id}
                >
                  {saving === connection.id ? "Saving…" : "Save"}
                </Button>
                {connection.oauth ? (
                  oauthReady ? (
                    <a href={connection.oauth.href}>
                      <Button variant="secondary">{connection.oauth.label}</Button>
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--muted-foreground)]">
                      Save the fields above, then sign in.
                    </span>
                  )
                ) : null}
                {connection.console ? (
                  <a
                    href={connection.console}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    Where these come from
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
