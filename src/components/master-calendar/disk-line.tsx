"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { describeDiskUsage, type DiskLineInput } from "@/lib/disk/format";

const REFRESH_MS = 60_000;
const MEASURING_REFRESH_MS = 5_000;

export function DiskLine() {
  const [usage, setUsage] = useState<DiskLineInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      let next: DiskLineInput | null = null;
      try {
        const response = await fetch("/api/disk", { cache: "no-store" });
        if (response.ok) next = (await response.json()) as DiskLineInput;
      } catch {
        next = null;
      }
      if (cancelled) return;
      if (next) setUsage(next);
      timer = setTimeout(() => void load(), next?.dataComputing ? MEASURING_REFRESH_MS : REFRESH_MS);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!usage) return null;
  const { summary, warning } = describeDiskUsage(usage);
  return (
    <Card className="mb-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <HardDrive className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        <p className="text-sm text-white">
          <span className="text-[var(--muted-foreground)]">Disk</span> {summary}
        </p>
        {warning ? (
          <Badge tone="warning" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {warning}
          </Badge>
        ) : null}
      </div>
    </Card>
  );
}
