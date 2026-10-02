import type { ClipProject } from "@/types/domain";
import type { ExportUiState } from "./types";
import { browserStorage } from "./browser-storage";
import { writeDraftProject } from "./drafts";

export type TrackedExport = ExportUiState & { jobId: string };
const STORAGE_PREFIX = "capital-command:clip-export:";

export function loadPersistedExports(): Record<string, TrackedExport> {
  const out: Record<string, TrackedExport> = Object.create(null);
  const storage = browserStorage("localStorage");
  if (!storage) return out;
  try {
    // Enumerate once; malformed records cannot hide later recovery entries.
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      try {
        const parsed = JSON.parse(storage.getItem(key) ?? "null");
        const projectId = key.slice(STORAGE_PREFIX.length);
        if (!projectId || typeof parsed?.exportId !== "string" || !parsed.exportId || typeof parsed?.jobId !== "string" || !parsed.jobId) continue;
        const progress = typeof parsed.progress === "number" && Number.isFinite(parsed.progress) ? Math.max(1, Math.min(99, parsed.progress)) : 1;
        out[projectId] = { status: "processing", progress, exportId: parsed.exportId, jobId: parsed.jobId };
      } catch {
        // A broken entry or unavailable store must not prevent other restores.
      }
    }
  } catch {
    // Storage can become unavailable between obtaining it and enumerating it.
  }
  return out;
}

function persist(projectId: string, tracked: TrackedExport): void {
  try {
    const storage = browserStorage("localStorage");
    if (!storage) return;
    const key = `${STORAGE_PREFIX}${projectId}`;
    if ((tracked.status === "processing" || tracked.status === "starting") && tracked.exportId) {
      storage.setItem(key, JSON.stringify({ jobId: tracked.jobId, exportId: tracked.exportId, progress: tracked.progress }));
    } else {
      storage.removeItem(key);
    }
  } catch {
    // Recovery caching is best effort; it cannot turn a successful render into
    // an error or suppress the live progress and download link.
  }
}

type TrackerOptions = {
  saveProject: (project: ClipProject, signal: AbortSignal) => Promise<void>;
  changed: (exports: Record<string, TrackedExport>) => void;
  notify: (message: string, error?: boolean) => void;
  request?: typeof fetch;
};

type SaveMutation = (action: string, payload?: unknown, options?: { rethrow?: boolean; signal?: AbortSignal }) => Promise<void>;

/** Keep the editor's save on the normal mutation path, with opt-in cancellation. */
export function saveProjectForExport(mutate: SaveMutation, project: ClipProject, signal: AbortSignal): Promise<void> {
  return mutate("upsertClipProject", project, { rethrow: true, signal });
}

type StartAttempt = { controller: AbortController; phase: "saving" | "posting" };

/** Owns async render operations independently of React render/effect timing. */
export class ClipExportTracker {
  private entries: Record<string, TrackedExport> = Object.create(null);
  private starting = new Map<string, StartAttempt>();
  private stopping = new Set<string>();
  private polling = false;
  private active = true;

  constructor(private readonly options: TrackerOptions) {}

  setActive(active: boolean): void { this.active = active; }

  restore(): void {
    this.entries = { ...loadPersistedExports(), ...this.entries };
    if (this.active) this.options.changed(this.entries);
  }

  private update(projectId: string, state: TrackedExport): void {
    this.entries = { ...this.entries, [projectId]: state };
    persist(projectId, state);
    if (this.active) this.options.changed(this.entries);
  }

  private notify(message: string, error = false): void {
    if (this.active) this.options.notify(message, error);
  }

  private request(url: string, init?: RequestInit): Promise<Response> {
    return (this.options.request ?? fetch)(url, {
      ...init, signal: AbortSignal.timeout(20_000)
    });
  }

  private url(state: TrackedExport): string {
    return `/api/clips/${encodeURIComponent(state.jobId)}/export/${encodeURIComponent(state.exportId!)}`;
  }

  private async cancel(state: TrackedExport): Promise<TrackedExport> {
    const response = await this.request(this.url(state), { method: "DELETE" });
    // A restart can expire the record. That is not confirmation that Stop
    // killed a job; show the same recoverable outcome as the status poll.
    if (response.status === 404) return { ...state, status: "error", progress: 0, error: "Export expired after a server restart. Re-render to try again." };
    if (!response.ok) throw new Error("Could not stop the render.");
    const data = await response.json() as { export?: { status?: string; file?: string; error?: string } };
    const record = data.export;
    // The job may finish just before Stop reaches the server. Keep its actual
    // finished result rather than hiding the download and claiming cancellation.
    if (record?.status === "done" && record.file) return { ...state, status: "done", progress: 100, file: record.file, error: undefined };
    if (record?.status === "error") return { ...state, status: "error", progress: 0, error: record.error ?? "Export failed." };
    if (record?.status === "canceled") return { ...state, status: "canceled", progress: 0, error: undefined };
    throw new Error("The server did not confirm cancellation.");
  }

  private cancellationResult(projectId: string, state: TrackedExport): void {
    this.update(projectId, state);
    this.notify(state.status === "done" ? "Export complete." : state.status === "error" ? state.error! : "Render stopped.", state.status === "error");
  }

  private async save(project: ClipProject, attempt: StartAttempt): Promise<void> {
    const signal = attempt.controller.signal;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      // Bound the wait even if an adapter neglects to reject on abort. Both the
      // real mutation fetch and this required-save wait use the same signal.
      await new Promise<void>((resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        timeout = setTimeout(() => attempt.controller.abort(new DOMException("Project save timed out.", "TimeoutError")), 20_000);
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return this.options.saveProject(project, signal);
        }).then(resolve, reject);
      });
    } finally {
      clearTimeout(timeout);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private startFailure(projectId: string, attempt: StartAttempt, starting: TrackedExport, message: string): void {
    // Stop can change the visible state while this POST still owns the start.
    // Match that ownership rather than its original state object, and never
    // leave a canceled request showing an indefinite "starting" state.
    if (this.starting.get(projectId) !== attempt) return;
    const cancellationRequested = attempt.phase === "posting" && this.entries[projectId] !== starting;
    this.update(projectId, {
      ...starting, status: "error",
      error: cancellationRequested
        ? "The server did not confirm whether the render started or stopped. Retry Export; an earlier render may still be running."
        : message
    });
  }

  async start(project: ClipProject): Promise<void> {
    const existing = this.entries[project.id];
    if (this.starting.has(project.id) || this.stopping.has(project.id) || existing?.status === "starting" || existing?.status === "processing") return;
    const starting: TrackedExport = { status: "starting", progress: 0, jobId: project.jobId };
    const attempt: StartAttempt = { controller: new AbortController(), phase: "saving" };
    this.starting.set(project.id, attempt);
    this.update(project.id, starting);
    try {
      if (project.captionsOmitted) {
        this.update(project.id, { ...starting, status: "error", error: "The full project is still loading. Wait for its captions before exporting." });
        return;
      }
      const savedProject = { ...project, updatedAt: new Date().toISOString() };
      writeDraftProject(savedProject);
      try {
        await this.save(savedProject, attempt);
      } catch (error) {
        if (this.starting.get(project.id) === attempt && this.entries[project.id] === starting) this.update(project.id, {
          ...starting, status: "error", error: error instanceof Error && error.name === "TimeoutError"
            ? "Project save timed out. Keep this editor open and retry before exporting."
            : "Project could not be saved. Keep this editor open and retry before exporting."
        });
        return;
      }
      // Stop during the save means no render request should be made.
      if (this.starting.get(project.id) !== attempt || this.entries[project.id] !== starting) return;
      attempt.phase = "posting";
      const response = await this.request(`/api/clips/${encodeURIComponent(project.jobId)}/export`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(savedProject)
      });
      const data = await response.json() as { export?: { id?: string }; error?: string };
      if (!response.ok || typeof data.export?.id !== "string" || !data.export.id) {
        this.startFailure(project.id, attempt, starting, data.error ?? "Export could not start.");
        return;
      }
      const processing: TrackedExport = { status: "processing", progress: 1, exportId: data.export.id, jobId: project.jobId };
      if (this.entries[project.id] !== starting) {
        // Stop arrived while POST was in flight; cancel the returned id rather
        // than reviving the render the user just stopped.
        this.update(project.id, { ...processing, error: "Stopping render…" });
        this.stopping.add(project.id);
        try {
          this.cancellationResult(project.id, await this.cancel(processing));
        } catch {
          this.update(project.id, { ...processing, error: "The render could not be stopped. Retry Stop to cancel it." });
          this.notify("The render could not be stopped. Retry Stop.", true);
        } finally {
          this.stopping.delete(project.id);
        }
        return;
      }
      this.update(project.id, processing);
    } catch {
      this.startFailure(project.id, attempt, starting, "Export request failed.");
    } finally {
      // An old canceled save may settle after a retry has taken ownership.
      // It must not unlock or otherwise interfere with that newer operation.
      if (this.starting.get(project.id) === attempt) this.starting.delete(project.id);
    }
  }

  async stop(projectId: string): Promise<void> {
    const current = this.entries[projectId];
    if (!current || this.stopping.has(projectId) || (current.status !== "processing" && current.status !== "starting")) return;
    if (!current.exportId) {
      const attempt = this.starting.get(projectId);
      if (attempt?.phase === "saving") {
        this.update(projectId, { ...current, status: "canceled", progress: 0 });
        this.starting.delete(projectId);
        attempt.controller.abort(new DOMException("Project save canceled.", "AbortError"));
        this.notify("Render stopped.");
      } else {
        this.update(projectId, { ...current, error: "Stopping render…" });
        this.notify("Cancel requested.");
      }
      return;
    }
    this.stopping.add(projectId);
    // Until DELETE confirms a terminal result the render is still running.
    // Retain its known id so a reload can recover it while Stop is pending.
    const stopping: TrackedExport = { ...current, error: "Stopping render…" };
    this.update(projectId, stopping);
    this.notify("Stopping render…");
    try {
      this.cancellationResult(projectId, await this.cancel(current));
    } catch {
      if (this.entries[projectId] === stopping) this.update(projectId, { ...current, error: "The render could not be stopped. Retry Stop to cancel it." });
      this.notify("The render could not be stopped. Retry Stop.", true);
    } finally {
      this.stopping.delete(projectId);
    }
  }

  async poll(): Promise<void> {
    if (this.polling || !this.active) return;
    this.polling = true;
    try {
      for (const [projectId, current] of Object.entries(this.entries)) {
        if (!this.active) break;
        if (current.status !== "processing" || !current.exportId || this.starting.has(projectId) || this.stopping.has(projectId) || this.entries[projectId] !== current) continue;
        try {
          const response = await this.request(this.url(current), { cache: "no-store" });
          // A late response for a canceled or replaced export is never allowed
          // to overwrite the newer operation, even if it reports completion.
          if (this.entries[projectId] !== current) continue;
          if (response.status === 404) {
            this.update(projectId, { ...current, status: "error", error: "Export expired after a server restart. Re-render to try again." });
            continue;
          }
          if (!response.ok) continue;
          const data = await response.json() as { export?: { status: string; progress: number; file?: string; error?: string } };
          if (this.entries[projectId] !== current || !data.export) continue;
          const record = data.export;
          if (record.status === "done") {
            if (!record.file) {
              this.update(projectId, { ...current, status: "error", error: "Export completed without a download file. Re-render to try again." });
            } else {
              this.update(projectId, { ...current, status: "done", progress: 100, file: record.file, error: undefined });
              this.notify("Export complete.");
            }
          } else if (record.status === "error" || record.status === "canceled") {
            this.update(projectId, { ...current, status: record.status, progress: 0, error: record.status === "error" ? record.error ?? "Export failed." : undefined });
          } else if (record.status === "processing" && Number.isFinite(record.progress)) {
            this.update(projectId, { ...current, progress: Math.max(0, Math.min(99, record.progress)) });
          }
        } catch {
          // Transient failures leave the render available for the next poll.
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
