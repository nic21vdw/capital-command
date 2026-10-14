"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Author = { urn: string; name: string; kind: "member" | "organization" };

type Authors = {
  connected: boolean;
  author: string | null;
  options: Author[];
  canPostAsPage: boolean;
  expiresAt: string | null;
  renews: boolean;
};

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function LinkedinAuthorPicker() {
  const [authors, setAuthors] = useState<Authors | null>(null);
  const [pageId, setPageId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/linkedin/author", { cache: "no-store" });
      if (response.ok) setAuthors((await response.json()) as Authors);
    } catch {
      setAuthors(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const send = async (body: { author?: string; organizationId?: string }, success: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/linkedin/author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as Authors & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? String(response.status));
      setAuthors(payload);
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update LinkedIn.");
    } finally {
      setBusy(false);
    }
  };

  if (!authors?.connected) return null;

  return (
    <fieldset className="mt-5 rounded-lg border border-[var(--border)] bg-black/20 p-3">
      <legend className="px-1 text-xs font-medium text-white/90">Who LinkedIn posts as</legend>
      <div className="space-y-1.5">
        {authors.options.map((option) => (
          <label key={option.urn} className="flex items-center gap-2 text-sm text-white">
            <input
              type="radio"
              name="linkedin-author"
              checked={authors.author === option.urn}
              disabled={busy}
              onChange={() => void send({ author: option.urn }, `LinkedIn will post as ${option.name}.`)}
            />
            <span>{option.name}</span>
            <span className="text-xs text-[var(--muted-foreground)]">{option.kind === "member" ? "your profile" : "company page"}</span>
          </label>
        ))}
      </div>
      {!authors.canPostAsPage ? (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Company pages need the Community Management API on your LinkedIn app. Once it is approved, use Connect with company pages below.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted-foreground)]">
            <span className="mb-1 block font-medium text-white/90">Add a page by its ID</span>
            <Input value={pageId} inputMode="numeric" placeholder="The number in the page's admin address" onChange={(event) => setPageId(event.target.value)} />
          </label>
          <Button
            variant="secondary"
            disabled={busy || !pageId.trim()}
            onClick={() => void send({ organizationId: pageId.trim() }, "Page added.").then(() => setPageId(""))}
          >
            Add page
          </Button>
        </div>
      )}
      {authors.expiresAt ? (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          {authors.renews
            ? `Signed in until ${dateLabel(authors.expiresAt)}; LinkedIn renews it for you before then.`
            : `Signed in until ${dateLabel(authors.expiresAt)}. LinkedIn does not renew this by itself - connect again before then. A banner warns you 7 days ahead.`}
        </p>
      ) : null}
    </fieldset>
  );
}
