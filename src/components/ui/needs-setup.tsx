"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, PlugZap } from "lucide-react";
import { cn } from "@/lib/utils";

export type SetupStatus = {
  present: Record<string, boolean>;
  connected: Record<string, boolean>;
};

let pending: Promise<SetupStatus | null> | null = null;

function loadSetupStatus(): Promise<SetupStatus | null> {
  pending ??= fetch("/api/connections", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((json: Partial<SetupStatus> | null) => (json ? { present: json.present ?? {}, connected: json.connected ?? {} } : null))
    .catch(() => null)
    .finally(() => {
      window.setTimeout(() => { pending = null; }, 5000);
    });
  return pending;
}

export function useSetupStatus(): SetupStatus | null {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  useEffect(() => {
    let live = true;
    void loadSetupStatus().then((next) => {
      if (live) setStatus(next);
    });
    return () => { live = false; };
  }, []);
  return status;
}

export function anyAccountConnected(status: SetupStatus): boolean {
  return Boolean(
    status.connected.youtube ||
      status.connected.tiktok ||
      status.connected.linkedin ||
      (status.present.IG_USER_ID && status.present.IG_ACCESS_TOKEN) ||
      (status.present.FB_PAGE_ID && status.present.FB_PAGE_ACCESS_TOKEN) ||
      status.present.THREADS_ACCESS_TOKEN
  );
}

export function NeedsSetup({
  title,
  children,
  href,
  action,
  className
}: {
  title: string;
  children: ReactNode;
  href: string;
  action: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      data-needs-setup
      className={cn("glass tone-warning tone-edge tone-soft mb-6 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center", className)}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/20">
        <PlugZap className="tone-warning tone-text h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <div className="mt-0.5 text-sm text-[var(--muted-foreground)]">{children}</div>
      </div>
      <Link
        href={href}
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 self-start rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-strong)] sm:self-center"
      >
        {action}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
