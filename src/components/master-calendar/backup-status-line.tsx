"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { describeBackup, type BackupStatus, type BackupView } from "@/lib/backup/status";

const UNREADABLE: BackupView = { text: "Last backup: unknown (the backup status could not be read)", warning: true };

export function useBackupView(): BackupView | null {
  const [view, setView] = useState<BackupView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/backup/status", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { status: BackupStatus | null }) => setView(describeBackup(json.status, new Date())))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setView(UNREADABLE);
      });
    return () => controller.abort();
  }, []);

  return view;
}

export function BackupStatusLine({ view }: { view: BackupView | null }) {
  if (!view) return null;
  const Icon = view.warning ? AlertTriangle : ShieldCheck;
  return (
    <div className="mb-4">
      <Badge tone={view.warning ? "warning" : "success"} className="gap-1.5 whitespace-normal text-left">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {view.text}
      </Badge>
    </div>
  );
}
