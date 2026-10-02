"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import type { ClipProject } from "@/types/domain";
import type { ExportUiState } from "@/components/editor/types";
import { ClipExportTracker, saveProjectForExport, type TrackedExport } from "./export-tracker";

const IDLE: ExportUiState = { status: "idle", progress: 0 };

type ExportsContextValue = {
  exportStateFor: (projectId: string) => ExportUiState;
  startExport: (project: ClipProject) => Promise<void>;
  stopExport: (projectId: string) => Promise<void>;
};

const ExportsContext = createContext<ExportsContextValue | null>(null);

/** Keeps live progress and reload recovery independent of the open editor. */
export function EditorExportsProvider({ children }: { children: React.ReactNode }) {
  const { mutate } = useAppData();
  const [exportsMap, setExportsMap] = useState<Record<string, TrackedExport>>({});
  const tracker = useMemo(() => new ClipExportTracker({
    saveProject: (project, signal) => saveProjectForExport(mutate, project, signal),
    changed: setExportsMap,
    notify: (message, error) => {
      if (error) toast.error(message);
      else if (message === "Export complete.") toast.success(message);
      else toast(message);
    }
  }), [mutate]);

  useEffect(() => {
    tracker.setActive(true);
    tracker.restore();
    const timer = setInterval(() => { void tracker.poll(); }, 1200);
    return () => {
      tracker.setActive(false);
      clearInterval(timer);
    };
  }, [tracker]);

  const startExport = useCallback((project: ClipProject) => tracker.start(project), [tracker]);
  const stopExport = useCallback((projectId: string) => tracker.stop(projectId), [tracker]);
  const exportStateFor = useCallback((projectId: string): ExportUiState => {
    const entry = exportsMap[projectId];
    if (!entry) return IDLE;
    return { status: entry.status, progress: entry.progress, exportId: entry.exportId, file: entry.file, error: entry.error };
  }, [exportsMap]);
  const value = useMemo(() => ({ exportStateFor, startExport, stopExport }), [exportStateFor, startExport, stopExport]);
  return <ExportsContext.Provider value={value}>{children}</ExportsContext.Provider>;
}

export function useEditorExports(): ExportsContextValue {
  const context = useContext(ExportsContext);
  if (!context) throw new Error("useEditorExports must be used within an EditorExportsProvider");
  return context;
}
