"use client";

import { useState } from "react";
import { ChevronDown, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_VIDEO_DESCRIPTION, DEFAULT_VIDEO_KEYWORDS } from "@/lib/video-description";

// A collapsible "Description" panel that sits under the editor title. It holds
// the video's full description plus its keywords, both editable and both
// seeded from the channel defaults so a fresh project is never blank. Shared by
// the Shorts (Clip) editor and the Long-Form editor.
export function DescriptionDropdown({
  description,
  keywords,
  onChange
}: {
  description: string | undefined;
  keywords: string | undefined;
  onChange: (partial: { description?: string; keywords?: string }) => void;
}) {
  const [open, setOpen] = useState(false);

  // Undefined means the project predates the field — fall back to the default
  // so the box always shows usable copy. An empty string is a deliberate clear.
  const descValue = description ?? DEFAULT_VIDEO_DESCRIPTION;
  const keywordsValue = keywords ?? DEFAULT_VIDEO_KEYWORDS;

  const keywordChips = keywordsValue
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const summary = descValue.trim().split("\n")[0] || "No description yet";

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white">Description</div>
          {!open && (
            <div className="truncate text-xs text-[var(--muted-foreground)]">{summary}</div>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-[var(--border)] px-4 py-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">
                Video description
              </label>
              <button
                type="button"
                onClick={() => onChange({ description: DEFAULT_VIDEO_DESCRIPTION })}
                className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] transition hover:text-white"
                title="Reset to the channel's default description"
              >
                <Sparkles className="h-3 w-3" /> Reset to default
              </button>
            </div>
            <textarea
              value={descValue}
              onChange={(e) => onChange({ description: e.target.value })}
              rows={8}
              placeholder="Write the video description shown when this video is posted…"
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm leading-relaxed text-white outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              Keywords <span className="opacity-60">(comma-separated)</span>
            </label>
            <input
              value={keywordsValue}
              onChange={(e) => onChange({ keywords: e.target.value })}
              placeholder="AI, vibe coding, Claude, ChatGPT…"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)]"
            />
            {keywordChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {keywordChips.map((chip, index) => (
                  <span
                    key={`${chip}-${index}`}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
