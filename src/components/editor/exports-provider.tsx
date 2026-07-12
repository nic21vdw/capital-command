"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import type { ClipProject } from "@/types/domain";
import type { ExportUiState } from "@/components/editor/types";

/** An export we are tracking, plus the job id the poller needs to reach it. */
type TrackedExport = ExportUiState & { jobId: string };

const IDLE: ExportUiState = { status: "idle", progress: 0 };
const STORAGE_PREFIX = "capital-command:clip-export:";

type PersistedExport = { jobId: string; exportId: string; progress: number };

/** In-flight exports remembered across a reload, keyed by project id. */
function loadPersisted(): Record<string, TrackedExport> {
  if (typeof window === "undefined") return {};
  const out: Record<string, TrackedExport> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const projectId = key.slice(STORAGE_PREFIX.length);
    try {
      const parsed = JSON.parse(localStorage.getItem(key) as string) as PersistedExport;
      if (parsed?.exportId && parsed?.jobId) {
        out[projectId] = { status: "processing", progress: parsed.progress || 1, exportId: parsed.exportId, jobId: parsed.jobId };
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
  return out;
}

function persist(projectId: string, tracked: TrackedExport | null) {
  if (typeof window === "undefined") return;
  const key = `${STORAGE_PREFIX}${projectId}`;
  // Only in-flight renders are worth resuming after a reload. A done/errored
  // export's server record lives in an in-memory map that a restart wipes, so
  // persisting it would only resurrect a panel pointing at a missing file.
  if (tracked && (tracked.status === "processing" || tracked.status === "starting") && tracked.exportId) {
    localStorage.setItem(key, JSON.stringify({ jobId: tracked.jobId, exportId: tracked.exportId, progress: tracked.progress }));
  } else {
    localStorage.removeItem(key);
  }
}

type ExportsContextValue = {
  /** Live export state for a clip, or an idle placeholder if none is running. */
  exportStateFor: (projectId: string) => ExportUiState;
  /** Kick off a render and track it in the background from here on. */
  startExport: (project: ClipProject) => Promise<void>;
  /** Stop an in-flight render safely (kills the server-side ffmpeg job). */
  stopExport: (projectId: string) => Promise<void>;
};

const ExportsContext = createContext<ExportsContextValue | null>(null);

/** Tracks clip renders independently of which clip is open in the editor.
 *
 *  The render itself runs on the server (keyed by an export id), so the only
 *  thing that used to break when you switched clips was the client-side
 *  progress state — it lived in the editor, which remounts per clip. Holding it
 *  here, above those remounts, lets a render keep reporting progress while you
 *  edit another clip, and lets you return to find it still going (or finished).
 */
export function EditorExportsProvider({ children }: { children: React.ReactNode }) {
  const { mutate } = useAppData();
  const [exportsMap, setExportsMap] = useState<Record<string, TrackedExport>>({});
  // Mirror for the poll loop so it always reads the latest map without being
  // torn down and rebuilt on every progress tick.
  const mapRef = useRef(exportsMap);
  useEffect(() => {
    mapRef.current = exportsMap;
  }, [exportsMap]);

  const update = useCallback((projectId: string, next: TrackedExport) => {
    persist(projectId, next);
    setExportsMap((prev) => ({ ...prev, [projectId]: next }));
  }, []);

  // Resume any renders that were still going when the page last unloaded. This
  // hydrates from localStorage (an external store) on mount, so a setState here
  // is the intended pattern rather than a cascading render.
  useEffect(() => {
    const persisted = loadPersisted();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Object.keys(persisted).length) setExportsMap((prev) => ({ ...persisted, ...prev }));
  }, []);

  // One shared poll loop covering every in-flight export at once.
  useEffect(() => {
    const timer = setInterval(async () => {
      const entries = Object.entries(mapRef.current).filter(([, e]) => e.status === "processing" && e.exportId);
      for (const [projectId, e] of entries) {
        try {
          const res = await fetch(`/api/clips/${e.jobId}/export/${e.exportId}`, { cache: "no-store" });
          const data = (await res.json()) as { export?: { status: string; progress: number; file?: string; error?: string } };
          const rec = data.export;
          if (!rec) {
            // A 404 means the server forgot this export (typically a restart).
            // Anything else is transient — keep polling.
            if (res.status === 404) update(projectId, { ...e, status: "error", error: "Export expired after a server restart. Re-render to try again." });
            continue;
          }
          if (rec.status === "done") {
            update(projectId, { ...e, status: "done", progress: 100, file: rec.file });
            toast.success("Export complete.");
          } else if (rec.status === "error") {
            update(projectId, { ...e, status: "error", progress: 0, error: rec.error });
          } else if (rec.status === "canceled") {
            update(projectId, { ...e, status: "canceled", progress: 0 });
          } else {
            update(projectId, { ...e, progress: rec.progress });
          }
        } catch {
          /* transient network blip — keep polling */
        }
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [update]);

  const startExport = useCallback(
    async (project: ClipProject) => {
      update(project.id, { status: "starting", progress: 0, jobId: project.jobId });
      try {
        // Persist first so the saved project reflects the edits being exported.
        await mutate("upsertClipProject", { ...project, updatedAt: new Date().toISOString() });
        const res = await fetch(`/api/clips/${project.jobId}/export`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(project)
        });
        const data = (await res.json()) as { export?: { id: string }; error?: string };
        if (!res.ok || !data.export) {
          update(project.id, { status: "error", progress: 0, jobId: project.jobId, error: data.error ?? "Export could not start." });
          return;
        }
        // If Stop was pressed while the POST was in flight there was no export
        // id to cancel yet — the render just started server-side, so cancel it
        // now instead of tracking it as running.
        if (mapRef.current[project.id]?.status === "canceled") {
          void fetch(`/api/clips/${project.jobId}/export/${data.export.id}`, { method: "DELETE" }).catch(() => undefined);
          return;
        }
        update(project.id, { status: "processing", progress: 1, exportId: data.export.id, jobId: project.jobId });
      } catch {
        update(project.id, { status: "error", progress: 0, jobId: project.jobId, error: "Export request failed." });
      }
    },
    [mutate, update]
  );

  const stopExport = useCallback(
    async (projectId: string) => {
      const e = mapRef.current[projectId];
      if (!e || (e.status !== "processing" && e.status !== "starting")) return;
      // Flip the UI immediately, then tell the server to kill the ffmpeg job.
      // When we're still "starting" there's no export id yet — startExport sees
      // this "canceled" flag once its POST returns and cancels the new render.
      update(projectId, { ...e, status: "canceled", progress: 0 });
      if (e.exportId) {
        try {
          await fetch(`/api/clips/${e.jobId}/export/${e.exportId}`, { method: "DELETE" });
        } catch {
          /* the poll loop is stopped now; nothing else to do */
        }
      }
      toast("Render stopped.");
    },
    [update]
  );

  const exportStateFor = useCallback(
    (projectId: string): ExportUiState => {
      const e = exportsMap[projectId];
      if (!e) return IDLE;
      // The editor only needs ExportUiState; the jobId is an internal detail.
      return { status: e.status, progress: e.progress, exportId: e.exportId, file: e.file, error: e.error };
    },
    [exportsMap]
  );

  const value = useMemo(
    () => ({ exportStateFor, startExport, stopExport }),
    [exportStateFor, startExport, stopExport]
  );
  return <ExportsContext.Provider value={value}>{children}</ExportsContext.Provider>;
}

export function useEditorExports(): ExportsContextValue {
  const ctx = useContext(ExportsContext);
  if (!ctx) throw new Error("useEditorExports must be used within an EditorExportsProvider");
  return ctx;
}
