"use client";

import { useMemo, useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PipelinePost, PipelineReview } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";

const POST_PLATFORM_LABELS: Record<PipelinePost["platform"], string> = {
  x: "X",
  threads: "Threads",
  facebook: "FB / LinkedIn"
};

/** Everything the Approve button will send. */
export type ReviewSubmission = {
  clipTitles: Array<{ id: string; title: string }>;
  dropClips: string[];
  segmentTitles: Array<{ id: string; title: string }>;
  dropSegments: string[];
  postTexts: Array<{ id: string; text: string }>;
  dropPosts: string[];
};

function timestamp(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function minutes(start: number, end: number) {
  const total = Math.max(0, Math.round((end - start) / 60));
  return total >= 1 ? `${total} min` : `${Math.round(end - start)}s`;
}

function SectionHeading({ children, count }: { children: React.ReactNode; count?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h4 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{children}</h4>
      {count ? <span className="text-[11px] text-[var(--muted-foreground)]">{count}</span> : null}
    </div>
  );
}

function DropButton({ dropped, onToggle, label }: { dropped: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dropped ? `Keep ${label}` : `Drop ${label}`}
      title={dropped ? "Keep it after all" : "Leave it out"}
      className={cn(
        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition",
        dropped
          ? "border-[var(--border)] text-[var(--muted-foreground)] hover:text-white"
          : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-red-400/40 hover:text-red-300"
      )}
    >
      {dropped ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Gate two: everything the run decided from the transcript, before a frame has
 * been encoded — the topic segments, the clip moments, the slide headings and
 * the posts. Titles and copy are editable and anything can be dropped; the
 * renders only start when this is approved, which is the point of showing it.
 */
export function ReviewCard({
  review,
  busy,
  onApprove
}: {
  review: PipelineReview;
  busy: boolean;
  onApprove: (submission: ReviewSubmission) => void;
}) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [dropped, setDropped] = useState<Record<string, boolean>>({});

  const toggleDrop = (id: string) => setDropped((current) => ({ ...current, [id]: !current[id] }));

  const submission = useMemo<ReviewSubmission>(() => {
    const changedTitle = (id: string, original: string) => {
      const edited = titles[id];
      return edited !== undefined && edited.trim() && edited.trim() !== original;
    };
    return {
      clipTitles: review.clips
        .filter((clip) => !dropped[clip.id] && changedTitle(clip.id, clip.title))
        .map((clip) => ({ id: clip.id, title: titles[clip.id].trim() })),
      dropClips: review.clips.filter((clip) => dropped[clip.id]).map((clip) => clip.id),
      segmentTitles: review.segments
        .filter((segment) => !dropped[segment.id] && changedTitle(segment.id, segment.title))
        .map((segment) => ({ id: segment.id, title: titles[segment.id].trim() })),
      dropSegments: review.segments.filter((segment) => dropped[segment.id]).map((segment) => segment.id),
      postTexts: review.posts
        .filter((post) => !dropped[post.id] && texts[post.id]?.trim() && texts[post.id].trim() !== post.text)
        .map((post) => ({ id: post.id, text: texts[post.id].trim() })),
      dropPosts: review.posts.filter((post) => dropped[post.id]).map((post) => post.id)
    };
  }, [dropped, review, texts, titles]);

  const keptClips = review.clips.length - submission.dropClips.length;
  const keptSegments = review.segments.length - submission.dropSegments.length;

  if (review.approvedAt) {
    return (
      <p className="mt-3 text-xs text-[var(--muted-foreground)]">
        Approved — {keptClips} clip{keptClips === 1 ? "" : "s"} and {keptSegments} segment
        {keptSegments === 1 ? "" : "s"} went to render. Follow them in the rows above.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-5">
      {review.segments.length > 0 && (
        <div className="space-y-2">
          <SectionHeading count={`${keptSegments} of ${review.segments.length} kept`}>
            Topic segments — each becomes its own long-form video
          </SectionHeading>
          {review.segments.map((segment) => (
            <div
              key={segment.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border border-[var(--border)] bg-white/3 p-3",
                dropped[segment.id] && "opacity-40"
              )}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Input
                  value={titles[segment.id] ?? segment.title}
                  onChange={(event) => setTitles((current) => ({ ...current, [segment.id]: event.target.value }))}
                  disabled={dropped[segment.id]}
                  aria-label="Segment title"
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  {timestamp(segment.start)}–{timestamp(segment.end)} · {minutes(segment.start, segment.end)} ·{" "}
                  {segment.summary}
                </p>
              </div>
              <DropButton dropped={Boolean(dropped[segment.id])} onToggle={() => toggleDrop(segment.id)} label="segment" />
            </div>
          ))}
        </div>
      )}

      {review.clips.length > 0 && (
        <div className="space-y-2">
          <SectionHeading count={`${keptClips} of ${review.clips.length} kept`}>
            Short-form clips — the moments about to be rendered
          </SectionHeading>
          {review.clips.map((clip) => (
            <div
              key={clip.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border border-[var(--border)] bg-white/3 p-3",
                dropped[clip.id] && "opacity-40"
              )}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <Input
                  value={titles[clip.id] ?? clip.title}
                  onChange={(event) => setTitles((current) => ({ ...current, [clip.id]: event.target.value }))}
                  disabled={dropped[clip.id]}
                  aria-label="Clip title"
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  {timestamp(clip.start)}–{timestamp(clip.end)} · score {Math.round(clip.score)}
                  {clip.hookQuote ? ` · opens with “${clip.hookQuote}”` : ""}
                </p>
              </div>
              <DropButton dropped={Boolean(dropped[clip.id])} onToggle={() => toggleDrop(clip.id)} label="clip" />
            </div>
          ))}
        </div>
      )}

      {review.carouselHeadings.length > 0 && (
        <div className="space-y-2">
          <SectionHeading count={`${review.carouselHeadings.length} slides`}>Carousel slides</SectionHeading>
          <ol className="space-y-1 rounded-lg border border-[var(--border)] bg-white/3 p-3">
            {review.carouselHeadings.map((heading, index) => (
              <li key={`${index}-${heading}`} className="text-xs text-white/85">
                <span className="text-[var(--muted-foreground)]">{index + 1}.</span> {heading}
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Slide copy is edited in Carousels — the deck is already written, so nothing here is waiting on it.
          </p>
        </div>
      )}

      {review.posts.length > 0 && (
        <div className="space-y-2">
          <SectionHeading count={`${review.posts.length - submission.dropPosts.length} of ${review.posts.length} kept`}>
            Text posts
          </SectionHeading>
          {review.posts.map((post) => (
            <div
              key={post.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border border-[var(--border)] bg-white/3 p-3",
                dropped[post.id] && "opacity-40"
              )}
            >
              <span className="mt-2 shrink-0 rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                {POST_PLATFORM_LABELS[post.platform]}
              </span>
              <Textarea
                value={texts[post.id] ?? post.text}
                onChange={(event) => setTexts((current) => ({ ...current, [post.id]: event.target.value }))}
                disabled={dropped[post.id]}
                aria-label="Post text"
                className="min-h-16 flex-1 py-2 text-sm"
              />
              <DropButton dropped={Boolean(dropped[post.id])} onToggle={() => toggleDrop(post.id)} label="post" />
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        <Button onClick={() => onApprove(submission)} disabled={busy || !review.ready} className="px-4 py-2 text-xs">
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Approve and render
        </Button>
        <span className="text-[11px] text-[var(--muted-foreground)]">
          {review.ready
            ? `Renders ${keptClips} clip${keptClips === 1 ? "" : "s"} and the long-form edit. Nothing has been encoded yet.`
            : `Still writing: ${review.pending.join(", ")}.`}
        </span>
      </div>
    </div>
  );
}
