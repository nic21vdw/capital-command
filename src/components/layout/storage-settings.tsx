"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Cloud, FolderSync, HardDrive } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CloudRoot = { provider: string; path: string };

type WorkspaceStatus = {
  root: string;
  isDefault: boolean;
  defaultRoot: string;
  markerPresent: boolean;
  cloudRoots: CloudRoot[];
  syncedVia: string | null;
  conflictFiles: string[];
};

async function fetchStatus(): Promise<WorkspaceStatus | null> {
  try {
    const response = await fetch("/api/storage", { cache: "no-store" });
    return response.ok ? ((await response.json()) as WorkspaceStatus) : null;
  } catch {
    // Settings page still renders without storage status.
    return null;
  }
}

/**
 * Bring-your-own-storage settings. The workspace is a plain folder; pointing
 * it at a folder the user's Dropbox/OneDrive/Google Drive client already
 * syncs gives cross-device sync with no cloud account on our side.
 */
export function StorageSettings() {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [targetPath, setTargetPath] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then((loaded) => {
      if (!cancelled && loaded) setStatus(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const act = async (body: Record<string, string>, successMessage: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json()) as WorkspaceStatus & { error?: string; filesCopied?: number };
      if (!response.ok) {
        toast.error(payload.error ?? "Storage operation failed.");
        return;
      }
      setStatus(payload);
      setTargetPath("");
      toast.success(typeof payload.filesCopied === "number" ? `${successMessage} ${payload.filesCopied} files copied.` : successMessage);
    } catch {
      toast.error("Storage operation failed.");
    } finally {
      setBusy(false);
    }
  };

  const moveTo = (target: string) => {
    if (!target.trim()) {
      toast.error("Enter a folder path first.");
      return;
    }
    if (
      !window.confirm(
        `Move the workspace to:\n\n${target}\n\nYour data is copied there and the app switches over. The old copy is kept in place until you delete it yourself.`
      )
    ) {
      return;
    }
    void act({ action: "move", targetPath: target }, "Workspace moved.");
  };

  const adopt = (target: string) => {
    if (!target.trim()) {
      toast.error("Enter a folder path first.");
      return;
    }
    void act({ action: "adopt", targetPath: target }, "Workspace opened.");
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">Storage & sync</h2>
        {status &&
          (status.syncedVia ? (
            <Badge className="text-emerald-300">
              <Cloud className="mr-1 h-3 w-3" /> Syncing via {status.syncedVia}
            </Badge>
          ) : (
            <Badge>
              <HardDrive className="mr-1 h-3 w-3" /> This device only
            </Badge>
          ))}
      </div>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Your workspace is a normal folder on this computer; nothing is stored on our side. To use it on all your devices,
        move it into a folder your own Dropbox, OneDrive, or Google Drive app already syncs.
      </p>

      {status && status.conflictFiles.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Sync conflicts detected
          </p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Your cloud client found the same file edited on two devices and kept both copies. Review these in the workspace
            folder and delete the copy you don&apos;t want:
          </p>
          <ul className="mt-2 list-inside list-disc text-sm text-amber-100/90">
            {status.conflictFiles.slice(0, 8).map((file) => (
              <li key={file} className="break-all">{file}</li>
            ))}
          </ul>
          {status.conflictFiles.length > 8 && (
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">…and {status.conflictFiles.length - 8} more.</p>
          )}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
        <p className="text-sm text-white">Current workspace folder</p>
        <p className="mt-1 break-all font-mono text-sm text-[var(--muted-foreground)]">{status ? status.root : "Loading…"}</p>
      </div>

      {status && status.cloudRoots.length > 0 && (
        <div className="mt-4">
          <p className="text-sm text-white">Cloud folders found on this computer</p>
          <div className="mt-2 space-y-2">
            {status.cloudRoots.map((cloud) => {
              const suggestion = `${cloud.path.replace(/[\\/]+$/, "")}${cloud.path.includes("\\") ? "\\" : "/"}Capital Command`;
              return (
                <div
                  key={cloud.path}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-white">
                      <FolderSync className="h-4 w-4 shrink-0 text-[var(--accent)]" /> {cloud.provider}
                    </p>
                    <p className="mt-0.5 break-all font-mono text-xs text-[var(--muted-foreground)]">{suggestion}</p>
                  </div>
                  <Button variant="secondary" disabled={busy} onClick={() => moveTo(suggestion)}>
                    Move workspace here
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="text-sm text-white">Custom folder</p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Paste any folder path. Use <span className="text-white">Move</span> to copy this workspace into an empty folder, or{" "}
          <span className="text-white">Open existing</span> to switch to a workspace folder synced from another computer.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={targetPath}
            onChange={(event) => setTargetPath(event.target.value)}
            placeholder="e.g. C:\Users\you\Dropbox\Capital Command"
            className="max-w-xl flex-1"
          />
          <Button disabled={busy} onClick={() => moveTo(targetPath)}>
            Move
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => adopt(targetPath)}>
            Open existing
          </Button>
        </div>
      </div>

      {status && !status.isDefault && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            Stop using the synced folder and go back to the app&apos;s built-in location. Nothing is copied or deleted.
          </p>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act({ action: "reset" }, "Workspace reset to the default folder.")}
          >
            Use default location
          </Button>
        </div>
      )}
    </Card>
  );
}
