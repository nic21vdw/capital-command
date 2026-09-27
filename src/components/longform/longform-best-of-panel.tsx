"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/clipping/editor";
import { editedDurationSec } from "@/lib/longform/plan";
import { formatRuntime } from "@/lib/longform/length";
import type { LongformHighlightPassage, LongformProject } from "@/lib/longform/types";
import { cn } from "@/lib/utils";

// The Best-of panel: cut a long stream down to its strongest passages at a
// target runtime, open it on a cold open, and read off the chapters. The
// server does the choosing (the planner and the editor pass); this panel is
// where the result is checked and adjusted: swap a passage in or out, rename
// a chapter, rebuild at another length, or go back to the whole stream.

const TARGETS = [12, 20, 30] as const;

type Chapter = { time: string; label: string };

type HighlightResponse = {
  project?: LongformProject;
  chapters?: Chapter[];
  error?: string;
};

export function BestOfPanel({
  project,
  setProject,
  skipDirtyRef,
  seek
}: {
  project: LongformProject;
  setProject: React.Dispatch<React.SetStateAction<LongformProject>>;
  skipDirtyRef: React.MutableRefObject<boolean>;
  seek: (t: number) => void;
}) {
  const highlight = project.highlight;
  const [targetMinutes, setTargetMinutes] = useState<number>(
    highlight ? Math.round(highlight.targetSec / 60) : 20
  );
  const [busy, setBusy] = useState<"build" | "clear" | string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const apply = useCallback(
    (data: HighlightResponse) => {
      if (data.project) {
        skipDirtyRef.current = true;
        setProject(data.project);
      }
      setChapters(data.chapters ?? []);
    },
    [setProject, skipDirtyRef]
  );

  // Chapters are timed on the edit as it stands, which the timeline can move,
  // so they are read fresh whenever the panel opens or the cut plan changes.
  const segmentsKey = project.segments.length;
  useEffect(() => {
    if (!project.highlight) return;
    let cancelled = false;
    void fetch(`/api/longform/projects/${project.id}/highlight`, { cache: "no-store" })
      .then((response) => response.json())
      .then((data: HighlightResponse) => {
        if (!cancelled) setChapters(data.chapters ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id, project.highlight, segmentsKey]);

  const request = async (method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<boolean> => {
    try {
      const response = await fetch(`/api/longform/projects/${project.id}/highlight`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const data = (await response.json()) as HighlightResponse;
      if (!response.ok) {
        toast.error(data.error ?? "Could not change the best-of edit.");
        return false;
      }
      apply(data);
      return true;
    } catch {
      toast.error("Could not reach the server.");
      return false;
    }
  };

  const build = async () => {
    setBusy("build");
    const ok = await request("POST", { targetMinutes });
    setBusy(null);
    if (ok) toast.success("Best-of edit built. Check the opening and the chapters, then export.");
  };

  const clear = async () => {
    if (!window.confirm("Go back to the whole stream? The best-of selection is removed and the cut plan is rebuilt.")) return;
    setBusy("clear");
    const ok = await request("DELETE");
    setBusy(null);
    if (ok) toast("Back to the whole stream with its dead space cut.");
  };

  const changePassage = async (passage: LongformHighlightPassage, change: { enabled?: boolean; label?: string }) => {
    setBusy(passage.id);
    await request("PATCH", { passages: [{ id: passage.id, ...change }] });
    setBusy(null);
  };

  const copyChapters = async () => {
    try {
      await navigator.clipboard.writeText(chapterList.map((chapter) => `${chapter.time} ${chapter.label}`).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  };

  const runtime = useMemo(() => editedDurationSec(project.segments, project.hook), [project.segments, project.hook]);
  const passages = highlight?.passages ?? [];
  const chapterList = highlight ? chapters : [];
  const keptCount = passages.filter((passage) => passage.enabled).length;
  const visible = showAll ? passages : passages.filter((passage) => passage.enabled);
  const longStream = project.durationSec > 30 * 60;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Best-of edit</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Reads the whole stream, keeps the passages that carry it and cuts the rest: setup, waiting, tech trouble and
          repeats. The video opens on the strongest line as a cold open and gets YouTube chapters that follow the cut.
          The next export of the whole edit is this video.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-[var(--border)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
          <span>Target length</span>
          <div className="flex gap-1">
            {TARGETS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setTargetMinutes(minutes)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                  targetMinutes === minutes
                    ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-white"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
                )}
              >
                {minutes} min
              </button>
            ))}
          </div>
        </div>
        <Button className="w-full gap-2" disabled={busy !== null} onClick={() => void build()}>
          {busy === "build" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {highlight ? "Rebuild the best-of edit" : "Build the best-of edit"}
        </Button>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          {highlight
            ? "Rebuilding re-reads the stream and resets any passages you swapped by hand."
            : longStream
              ? `This recording runs ${formatRuntime(project.durationSec)}. The Stream Pipeline builds this edit on its own for streams this long.`
              : "Works best on streams well over the target length."}
        </p>
      </div>

      {highlight && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Runtime" value={formatRuntime(runtime)} note={`target ${formatRuntime(highlight.targetSec)}`} />
            <Stat label="Passages" value={`${keptCount}`} note={`of ${passages.length}`} />
            <Stat label="Chosen by" value={highlight.selectedBy === "ai" ? "AI" : "Scorer"} note={highlight.selectedBy === "ai" ? "editor pass" : "offline"} />
          </div>

          <div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white">
                {highlight.opening === "cold-open" ? "Cold open" : "Opens on the first passage"}
              </p>
              <button
                type="button"
                onClick={() => seek(project.hook.start ?? 0)}
                className="text-[11px] tabular-nums text-[var(--accent)] transition hover:opacity-80"
              >
                {formatClock(project.hook.start ?? 0)} – {formatClock(project.hook.end)} · jump here
              </button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              {highlight.coldOpen
                ? `"${highlight.coldOpen.text}"`
                : "No line later in the edit beats the natural opening, so the video starts where the first passage does."}
            </p>
            <p className="text-[11px] text-[var(--muted-foreground)]">Fine-tune the window and its look in the Hook tab.</p>
          </div>

          <div className="space-y-1.5 rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white">Chapters</p>
              {chapterList.length > 0 && (
                <button
                  type="button"
                  onClick={() => void copyChapters()}
                  className="flex items-center gap-1 text-[11px] text-[var(--accent)] transition hover:opacity-80"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            {chapterList.length > 0 ? (
              <ol className="space-y-0.5 text-xs">
                {chapterList.map((chapter) => (
                  <li key={`${chapter.time}-${chapter.label}`} className="flex gap-2">
                    <span className="w-14 shrink-0 tabular-nums text-[var(--muted-foreground)]">{chapter.time}</span>
                    <span className="text-white">{chapter.label}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                YouTube needs at least 3 chapters of 10 seconds or more. Keep more passages, or give them different labels.
              </p>
            )}
            <p className="text-[11px] text-[var(--muted-foreground)]">
              These go into the description when you generate it in the Publish tab. Rename a chapter by editing the
              label of the passage it starts on.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-white">Passages</p>
              <div className="flex gap-1">
                {[
                  { value: false, label: "In the edit" },
                  { value: true, label: "All" }
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => setShowAll(option.value)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                      showAll === option.value
                        ? "border-[var(--accent)]/60 bg-[var(--accent)]/10 text-white"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {visible.map((passage) => (
                <PassageRow
                  // Keyed on the label too, so a rename from the server resets the field.
                  key={`${passage.id}:${passage.label}`}
                  passage={passage}
                  busy={busy === passage.id}
                  disabled={busy !== null}
                  seek={seek}
                  onToggle={() => void changePassage(passage, { enabled: !passage.enabled })}
                  onRename={(label) => void changePassage(passage, { label })}
                />
              ))}
            </div>
          </div>

          <Button variant="ghost" className="w-full gap-2 text-xs" disabled={busy !== null} onClick={() => void clear()}>
            {busy === "clear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Back to the whole stream
          </Button>
        </>
      )}

      {!highlight && (
        <p className="flex items-start gap-2 text-[11px] text-[var(--muted-foreground)]">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
          The pick comes from the AI editor pass when a model is connected, and from the offline scorer (delivery,
          energy, whether a stretch stands on its own) when it is not.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] px-2 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-white">{value}</p>
      <p className="text-[10px] text-[var(--muted-foreground)]">{note}</p>
    </div>
  );
}

function PassageRow({
  passage,
  busy,
  disabled,
  seek,
  onToggle,
  onRename
}: {
  passage: LongformHighlightPassage;
  busy: boolean;
  disabled: boolean;
  seek: (t: number) => void;
  onToggle: () => void;
  onRename: (label: string) => void;
}) {
  const [label, setLabel] = useState(passage.label);
  const commit = () => {
    const next = label.trim();
    if (next && next !== passage.label) onRename(next);
    else setLabel(passage.label);
  };
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border p-2.5",
        passage.enabled ? "border-[var(--accent)]/40 bg-[var(--accent)]/5" : "border-[var(--border)] opacity-70"
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={passage.enabled}
          aria-label={passage.enabled ? "Cut this passage" : "Keep this passage"}
          disabled={disabled}
          onClick={onToggle}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition",
            passage.enabled ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]" : "border-[var(--border-strong)]"
          )}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : passage.enabled ? <Check className="h-3 w-3" /> : null}
        </button>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
          maxLength={60}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-white outline-none focus:border-[var(--border-strong)]"
        />
        {passage.picked && (
          <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--muted-foreground)]">
            AI pick
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10" title={`Score ${passage.score}`}>
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${passage.score}%` }} />
        </div>
        <button
          type="button"
          onClick={() => seek(passage.start)}
          className="shrink-0 text-[11px] tabular-nums text-[var(--accent)] transition hover:opacity-80"
        >
          {formatClock(passage.start)} · {formatRuntime(passage.end - passage.start)}
        </button>
      </div>
      <p className="line-clamp-2 text-[11px] text-[var(--muted-foreground)]">{passage.opening}…</p>
    </div>
  );
}
